/**
 * Tests for the openrouter-catalog-filter extension.
 *
 * Covers:
 * - Fallback order remote -> store -> builtin, preserving skipped sources
 *   and reasons (missing file, broken JSON, no allowed models, remote failure, PI_OFFLINE=1)
 *   in status and on/off outputs, while keeping list output strictly to model IDs.
 * - Builtin models and filterModels accept readonly unknown[] without cast.
 * - A store read failure other than ENOENT (the store path is a directory) falls
 *   back to builtin and is reported with the path and EISDIR.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createModuleHarness } from "../../test-support/module-harness.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

let extensionEntry: (pi: ExtensionAPI) => Promise<void>;

const BUILTIN_FIXTURE_MODELS = [
  { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
  { id: "free-model:free", name: "Free Model" },
  { id: "minimax/minimax-m3:free", name: "Retired Free Model" },
  { id: "closed/paid-model", name: "Paid Model" },
];

let moduleHarness: Awaited<ReturnType<typeof createModuleHarness>>;
after(async () => { await moduleHarness?.cleanup(); });

before(async () => {
  const harness = moduleHarness = await createModuleHarness(
    Object.fromEntries(["index.ts", "state.ts"].map((name) => [`ext/${name}`, new URL(name, import.meta.url)])),
    () => ({
      "@earendil-works/pi-coding-agent": {
        "package.json": JSON.stringify({ name: "@earendil-works/pi-coding-agent", type: "module", exports: { ".": "./index.js" } }),
        "index.js": `export const getAgentDir = () => process.env.TEST_AGENT_DIR;\n`,
      },
      "@earendil-works/pi-ai": {
        "package.json": JSON.stringify({
          name: "@earendil-works/pi-ai", type: "module", exports: { "./providers/all": "./dist/providers/all.js" },
        }),
        "dist/providers/all.js": `export function getBuiltinModels(provider) {
      return ${JSON.stringify(BUILTIN_FIXTURE_MODELS)};
    }\n`,
      },
    }),
  );
  extensionEntry = (await harness.importModule("ext/index.ts")).default;
});

interface FakeExtensionContext {
  readonly agentDir: string;
  readonly notifications: { text: string; level: string }[];
  readonly ctx: ExtensionCommandContext;
  registeredProvider?: { name: string; options: any };
  registeredCommand?: { name: string; definition: any };
}

async function setupFakePi(t: { after: (fn: () => void | Promise<void>) => void }): Promise<FakeExtensionContext> {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-agent-test-"));
  process.env.TEST_AGENT_DIR = agentDir;

  const originalOffline = process.env.PI_OFFLINE;
  const originalState = process.env.PI_OPENROUTER_FILTER;
  const originalStatePath = process.env.PI_OPENROUTER_FILTER_STATE;
  delete process.env.PI_OFFLINE;
  delete process.env.PI_OPENROUTER_FILTER;
  delete process.env.PI_OPENROUTER_FILTER_STATE;

  const notifications: { text: string; level: string }[] = [];
  const ctx: ExtensionCommandContext = {
    ui: {
      notify: (text: string, level = "info") => {
        notifications.push({ text, level });
      },
    },
  } as unknown as ExtensionCommandContext;

  const fakeCtx: FakeExtensionContext = {
    agentDir,
    notifications,
    ctx,
  };

  t.after(async () => {
    delete process.env.TEST_AGENT_DIR;
    if (originalOffline !== undefined) process.env.PI_OFFLINE = originalOffline;
    else delete process.env.PI_OFFLINE;
    if (originalState !== undefined) process.env.PI_OPENROUTER_FILTER = originalState;
    else delete process.env.PI_OPENROUTER_FILTER;
    if (originalStatePath !== undefined) process.env.PI_OPENROUTER_FILTER_STATE = originalStatePath;
    else delete process.env.PI_OPENROUTER_FILTER_STATE;
    await rm(agentDir, { recursive: true, force: true });
  });

  return fakeCtx;
}

test("remote catalog loads and formats status with source remote", async (t) => {
  const fake = await setupFakePi(t);

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
        { id: "alpha-model-alpha", name: "Alpha Model" },
        { id: "ignored-model", name: "Ignored" },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const pi: ExtensionAPI = {
    registerProvider: (name, options) => {
      fake.registeredProvider = { name, options };
    },
    unregisterProvider: () => {},
    registerCommand: (name, definition) => {
      fake.registeredCommand = { name, definition };
    },
  } as unknown as ExtensionAPI;

  await extensionEntry(pi);

  assert.equal(fake.registeredProvider?.name, "openrouter");
  assert.equal(fake.registeredProvider?.options.models.length, 2);

  // Status check
  await fake.registeredCommand?.definition.handler("status", fake.ctx);
  assert.equal(fake.notifications.length, 1);
  assert.match(fake.notifications[0].text, /catalog: 2 of 3 models visible \(remote\)/);

  // List check (only model IDs, no source header)
  fake.notifications.length = 0;
  await fake.registeredCommand?.definition.handler("list", fake.ctx);
  assert.equal(fake.notifications.length, 1);
  assert.equal(fake.notifications[0].text, "deepseek/deepseek-v4.1-flash\nalpha-model-alpha");
});

test("when remote fails, falls back to store and records remote skipped reason", async (t) => {
  const fake = await setupFakePi(t);

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response("Service Unavailable", { status: 503 });

  // Create models-store.json in agent dir
  await writeFile(
    join(fake.agentDir, "models-store.json"),
    JSON.stringify({
      openrouter: [
        { id: "deepseek/deepseek-v4.1-flash" },
        { id: "test-model:free" },
        { id: "other-model" },
      ],
    }),
    "utf8",
  );

  const pi: ExtensionAPI = {
    registerProvider: (name, options) => {
      fake.registeredProvider = { name, options };
    },
    unregisterProvider: () => {},
    registerCommand: (name, definition) => {
      fake.registeredCommand = { name, definition };
    },
  } as unknown as ExtensionAPI;

  await extensionEntry(pi);

  assert.equal(fake.registeredProvider?.options.models.length, 2);

  // Status check
  await fake.registeredCommand?.definition.handler("status", fake.ctx);
  assert.equal(fake.notifications.length, 1);
  assert.match(
    fake.notifications[0].text,
    /catalog: 2 of 3 models visible \(store; remote skipped: OpenRouter catalog request failed: 503\)/,
  );

  // On subcommand check
  fake.notifications.length = 0;
  await fake.registeredCommand?.definition.handler("on", fake.ctx);
  assert.equal(fake.notifications.length, 1);
  assert.match(
    fake.notifications[0].text,
    /allowlist on — 2 of 3 OpenRouter models visible \(store; remote skipped: OpenRouter catalog request failed: 503\)/,
  );
});

test("when remote and store both fail (store file missing), falls back to builtin", async (t) => {
  const fake = await setupFakePi(t);

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response("Not Found", { status: 404 });

  // No models-store.json file created (ENOENT)

  const pi: ExtensionAPI = {
    registerProvider: (name, options) => {
      fake.registeredProvider = { name, options };
    },
    unregisterProvider: () => {},
    registerCommand: (name, definition) => {
      fake.registeredCommand = { name, definition };
    },
  } as unknown as ExtensionAPI;

  await extensionEntry(pi);

  // Builtin fixture has 4 models: 1 deepseek-v4.1-flash, 1 free-model:free, 1 unserved minimax, 1 closed.
  // Allowed: deepseek-v4.1-flash and free-model:free (2 models).
  assert.equal(fake.registeredProvider?.options.models.length, 2);

  await fake.registeredCommand?.definition.handler("status", fake.ctx);
  assert.equal(fake.notifications.length, 1);
  assert.match(
    fake.notifications[0].text,
    /catalog: 2 of 4 models visible \(builtin; remote skipped: OpenRouter catalog request failed: 404; store skipped: the file was missing\)/,
  );
});

test("when store JSON is broken, falls back to builtin and reports broken JSON", async (t) => {
  const fake = await setupFakePi(t);

  process.env.PI_OFFLINE = "1";

  await writeFile(join(fake.agentDir, "models-store.json"), "{ broken json", "utf8");

  const pi: ExtensionAPI = {
    registerProvider: (name, options) => {
      fake.registeredProvider = { name, options };
    },
    unregisterProvider: () => {},
    registerCommand: (name, definition) => {
      fake.registeredCommand = { name, definition };
    },
  } as unknown as ExtensionAPI;

  await extensionEntry(pi);

  await fake.registeredCommand?.definition.handler("status", fake.ctx);
  assert.equal(fake.notifications.length, 1);
  assert.match(
    fake.notifications[0].text,
    /catalog: 2 of 4 models visible \(builtin; remote skipped: PI_OFFLINE=1; store skipped: the JSON was broken\)/,
  );
});

test("when store contains no allowed models, falls back to builtin and reports no allowed models", async (t) => {
  const fake = await setupFakePi(t);

  process.env.PI_OFFLINE = "1";

  await writeFile(
    join(fake.agentDir, "models-store.json"),
    JSON.stringify({ openrouter: [{ id: "unallowed/model" }] }),
    "utf8",
  );

  const pi: ExtensionAPI = {
    registerProvider: (name, options) => {
      fake.registeredProvider = { name, options };
    },
    unregisterProvider: () => {},
    registerCommand: (name, definition) => {
      fake.registeredCommand = { name, definition };
    },
  } as unknown as ExtensionAPI;

  await extensionEntry(pi);

  await fake.registeredCommand?.definition.handler("status", fake.ctx);
  assert.equal(fake.notifications.length, 1);
  assert.match(
    fake.notifications[0].text,
    /catalog: 2 of 4 models visible \(builtin; remote skipped: PI_OFFLINE=1; store skipped: there were no allowed models\)/,
  );
});

// A store read failure that is not ENOENT keeps its path and its cause (here
// EISDIR, from pointing the store path at a directory), and routing still falls
// back to the builtin catalog.
test("when the store path is a directory, falls back to builtin and reports the read failure", async (t) => {
  const fake = await setupFakePi(t);

  process.env.PI_OFFLINE = "1";

  await mkdir(join(fake.agentDir, "models-store.json"));

  const pi: ExtensionAPI = {
    registerProvider: (name, options) => {
      fake.registeredProvider = { name, options };
    },
    unregisterProvider: () => {},
    registerCommand: (name, definition) => {
      fake.registeredCommand = { name, definition };
    },
  } as unknown as ExtensionAPI;

  await extensionEntry(pi);

  // The builtin fixture still answers, so an unreadable store costs the
  // operator the fallback, not the provider.
  assert.equal(fake.registeredProvider?.options.models.length, 2);

  await fake.registeredCommand?.definition.handler("status", fake.ctx);
  assert.equal(fake.notifications.length, 1);
  assert.match(
    fake.notifications[0].text,
    /catalog: 2 of 4 models visible \(builtin; remote skipped: PI_OFFLINE=1; store skipped: could not read .*models-store\.json: EISDIR/,
  );
});
