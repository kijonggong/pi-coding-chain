import assert from "node:assert/strict";
import fs, { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { createModuleHarness } from "../../test-support/module-harness.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type registerRouterType from "./index.ts";
import type { RouterState } from "./index.ts";
import { DEFAULT_SETTINGS, SETTINGS, saveSettings } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { sdkStubPackages } from "./test-support.ts";

let moduleDirectory: string;
let registerRouter: typeof registerRouterType;

let moduleHarness: Awaited<ReturnType<typeof createModuleHarness>>;
after(async () => { await moduleHarness?.cleanup(); });

before(async () => {
  const modules = [
    ...["index.ts", "candidates.ts", "chain-order.ts", "cooldown.ts", "settings.ts", "fallback-editor.ts", "fallback-tui.ts"]
      .map((name) => [`aaii-router/${name}`, new URL(name, import.meta.url)] as const),
    ...["providers.ts", "scores.ts"]
      .map((name) => [`coding-fallback/${name}`, new URL(`../coding-fallback/${name}`, import.meta.url)] as const),
  ];
  const harness = moduleHarness = await createModuleHarness(Object.fromEntries(modules), sdkStubPackages);
  moduleDirectory = harness.directory;
  registerRouter = (await harness.importModule("aaii-router/index.ts")).default;
});

type Route = Parameters<ExtensionAPI["registerVirtualModel"]>[0]["route"];
type Request = Parameters<Route>[0];

async function harness(t: { after: (cleanup: () => Promise<void>) => void }, initial: Settings = DEFAULT_SETTINGS) {
  const directory = await mkdtemp(join(tmpdir(), "aaii-router-command-"));
  const envKeys = ["PI_AAII_ROUTER_SETTINGS", "PI_CODING_FALLBACK_SCORES", ...SETTINGS.map((entry) => entry.envVar)];
  const savedEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  process.env.PI_AAII_ROUTER_SETTINGS = join(directory, "settings.json");
  process.env.PI_CODING_FALLBACK_SCORES = join(directory, "scores.json");
  await saveSettings(process.env.PI_AAII_ROUTER_SETTINGS, initial);
  await writeFile(process.env.PI_CODING_FALLBACK_SCORES, JSON.stringify({ scores: {
    a: { score: 90 }, b: { score: 60 }, c: { score: 30 },
  } }));
  const models = [
    { provider: "one", id: "a", api: "test", input: ["text"], baseUrl: "https://one.example/v1" },
    { provider: "two", id: "b", api: "test", input: ["text"], baseUrl: "https://two.example/v1" },
    { provider: "three", id: "c", api: "test", input: ["text"], baseUrl: "https://three.example/v1" },
  ];
  let route!: Route;
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let sessionStart!: (event: unknown, ctx: ExtensionCommandContext) => void;
  registerRouter({
    registerVirtualModel: (definition) => { route = definition.route; },
    registerCommand: (_name, definition) => { command = definition.handler; },
    on: (event, handler) => { if (event === "session_start") sessionStart = handler; },
  } as ExtensionAPI);
  let choice = "Done";
  let answer = "";
  let keys: string[] = [];
  const notifications: { message: string; type?: string }[] = [];
  const statuses: (string | undefined)[] = [];
  const ctx = {
    cwd: directory, hasUI: true, mode: "tui", isProjectTrusted: () => false,
    sessionManager: { getBranch: () => [] },
    modelRegistry: {
      getModelsOfType: () => models, hasConfiguredAuth: () => true,
      find: (provider: string, id: string) => models.find((model) => model.provider === provider && model.id === id),
    },
    ui: {
      setStatus: (_key: string, text: string | undefined) => { statuses.push(text); }, notify: (message: string, type?: string) => notifications.push({ message, type }),
      select: async () => { const selected = choice; choice = "Done"; return selected; },
      input: async () => answer, confirm: async () => true,
      // Only the host TUI boundary is replaced; the real editor and onSave run.
      custom: (factory: Function) => new Promise((done) => {
        const editor = factory({ requestRender: () => {} }, {
          fg: (_color: string, text: string) => text, bold: (text: string) => text,
        }, {}, done);
        for (const key of keys) editor.handleInput(key);
      }),
    },
  } as unknown as ExtensionCommandContext;
  sessionStart({}, ctx);
  t.after(async () => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    sessionStart({}, ctx);
    await rm(directory, { recursive: true, force: true });
  });
  const request = (state?: RouterState, extra: object = {}) => route({
    reason: "turn", messages: [], thinkingLevel: "off", state, ...extra,
  } as Request, ctx);
  return {
    directory,
    request,
    remember: async (index: number) => (await request(undefined, {
      reason: "continuation", previous: { model: models[index] },
    })).state as RouterState,
    command: (args: string) => command(args, ctx),
    window: async (label: string, value: string) => {
      choice = label; answer = value; await command("settings", ctx);
    },
    fallback: async (...input: string[]) => { keys = input; await command("fallback", ctx); },
    notifications, statuses,
  };
}

test("set writes global settings in the SDK agent directory without a path override", async (t) => {
  const h = await harness(t);
  delete process.env.PI_AAII_ROUTER_SETTINGS;
  await h.command("set pinned three/c");
  const saved = JSON.parse(await readFile(join(moduleDirectory, "aaii-router.json"), "utf8"));
  assert.deepEqual(saved.pinned, ["three/c"]);
});

test("fallback save changes the next turn's candidate while continuation keeps its model", async (t) => {
  const h = await harness(t);
  const state = await h.remember(1);
  await h.fallback("j", "j", "p", "s");
  const continued = await h.request(state, { reason: "continuation", previous: { model: { provider: "two", id: "b" } } });
  assert.equal(continued.state.label, "two/b");
  assert.equal((await h.request(continued.state)).state.label, "three/c");
});

test("fallback save with no change preserves the remembered candidate", async (t) => {
  const h = await harness(t);
  const state = await h.remember(1);
  await h.fallback("s");
  assert.equal((await h.request(state)).state.label, "two/b");
});

test("legacy session state without a revision preserves its remembered candidate", async (t) => {
  const h = await harness(t);
  await h.command("set pinned three/c");
  assert.equal((await h.request({ label: "two/b" })).state.label, "two/b");
});

for (const [key, value, expected, remembered] of [
  ["pinned", "three/c", "three/c", 1],
  ["models", "one/a", "two/b", 2],
  ["providers", "one", "two/b", 2],
  ["origins", "https://one.example", "two/b", 2],
] as const) {
  test(`set ${key} redirects the next turn and an identical write preserves stickiness`, async (t) => {
    const h = await harness(t);
    const state = await h.remember(remembered);
    await h.command(`set ${key} ${value}`);
    assert.equal((await h.request(state)).state.label, expected);
    const sticky = await h.remember(remembered);
    await h.command(`set ${key} ${value}`);
    assert.equal((await h.request(sticky)).state.label, remembered === 1 ? "two/b" : "three/c");
  });
}

test("reset redirects the next turn to the default head only when routing settings changed", async (t) => {
  const h = await harness(t, { ...DEFAULT_SETTINGS, pinnedModels: ["three/c"] });
  const state = await h.remember(1);
  await h.command("reset");
  assert.equal((await h.request(state)).state.label, "one/a");
  const sticky = await h.remember(1);
  await h.command("reset");
  assert.equal((await h.request(sticky)).state.label, "two/b");
});

for (const [label, value, expected, remembered] of [
  ["Pinned models: current", "three/c", "three/c", 1],
  ["Excluded models: current", "one/a", "two/b", 2],
  ["Excluded providers: current", "one", "two/b", 2],
  ["Excluded origins: current", "https://one.example", "two/b", 2],
] as const) {
  test(`settings window ${label} redirects only on change`, async (t) => {
    const h = await harness(t);
    const state = await h.remember(remembered);
    await h.window(label, value);
    assert.equal((await h.request(state)).state.label, expected);
    const sticky = await h.remember(remembered);
    await h.window(label, value);
    assert.equal((await h.request(sticky)).state.label, remembered === 1 ? "two/b" : "three/c");
  });
}

test("settings window reset restores the head while operator preferences preserve stickiness", async (t) => {
  const h = await harness(t, { ...DEFAULT_SETTINGS, pinnedModels: ["three/c"] });
  const state = await h.remember(1);
  await h.window("Reset to defaults", "");
  assert.equal((await h.request(state)).state.label, "one/a");
  const sticky = await h.remember(1);
  await h.window("Reset to defaults", "");
  await h.window("Cooldown window: current", "123s");
  await h.command("set vision off");
  await h.command("set status off");
  assert.equal((await h.request(sticky)).state.label, "two/b");
});

test("routing refuses a chain with no eligible models", async (t) => {
  const h = await harness(t);
  await h.command("set models one/a,two/b,three/c");
  await assert.rejects(h.request(), /no eligible model/);
});


test("registry and routing reject corrupt or unreadable score files before choosing a model", async (t) => {
  const h = await harness(t);
  const path = process.env.PI_CODING_FALLBACK_SCORES!;
  await writeFile(path, "{broken");
  await assert.rejects(h.request(), /invalid scores.*scores.json/);
  await assert.rejects(h.command(""), /invalid scores.*scores.json/);
  process.env.PI_CODING_FALLBACK_SCORES = dirname(path);
  await assert.rejects(h.request(), /cannot read scores.*EISDIR/);
});

test("routing and the report surface an unreadable settings file instead of routing on defaults", async (t) => {
  const h = await harness(t);
  const path = process.env.PI_AAII_ROUTER_SETTINGS!;
  await rm(path);
  await mkdir(path);
  await assert.rejects(h.request(), /cannot read settings.*settings\.json.*EISDIR/);
  await assert.rejects(h.command(""), /cannot read settings.*settings\.json.*EISDIR/);
});

test("routing ignores an untrusted project settings directory and reports the trust boundary", async (t) => {
  const h = await harness(t, { ...DEFAULT_SETTINGS, pinnedModels: ["three/c"] });
  const path = join(h.directory, ".pi", "aaii-router.json");
  await mkdir(path, { recursive: true });
  assert.equal((await h.request()).state.label, "three/c");
  await h.command("");
  assert.ok(h.notifications.some(({ message }) => message.includes(`ignored ${path}: the project is not trusted`)));
});

test("routing reports an untrusted project existence-check error without refusing defaults", async (t) => {
  const h = await harness(t);
  const path = join(h.directory, ".pi", "aaii-router.json");
  const probe = t.mock.method(fs, "lstat", async () => {
    throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  });
  syncBuiltinESMExports();
  try {
    assert.equal((await h.request()).state.label, "one/a");
    await h.command("");
    assert.ok(h.notifications.some(({ message }) => message.includes(
      `ignored ${path}: the project is not trusted; could not check existence: EACCES: permission denied`,
    )));
  } finally {
    probe.mock.restore();
    syncBuiltinESMExports();
  }
});

test("router uses the score owner's module-relative default outside the working directory", async (t) => {
  const h = await harness(t);
  delete process.env.PI_CODING_FALLBACK_SCORES;
  await writeFile(join(moduleDirectory, "coding-fallback", "aaii-scores.json"), '{"scores":{"c":{"score":99}}}');
  assert.equal((await h.request()).state.label, "three/c");
});


test("session start clears status and routing publishes the chosen model through the SDK UI", async (t) => {
  const h = await harness(t);
  assert.deepEqual(h.statuses, [undefined]);
  await h.request();
  assert.deepEqual(h.statuses, [undefined, "aaii → one/a"]);
  await h.command("set status off");
  await h.request();
  assert.equal(h.statuses.at(-1), undefined);
});


test("set and reset refresh the status line and report environment overrides", async (t) => {
  const h = await harness(t);
  process.env.PI_AAII_ROUTER_VISION = "off";

  // First request sets status line
  await h.request();
  assert.equal(h.statuses.at(-1), "aaii → one/a");

  // `set` writes the setting, refreshes status line (clearing it), and warns about the env override
  h.notifications.length = 0;
  await h.command("set cooldown 10m");
  assert.equal(h.statuses.at(-1), undefined, "set must refresh the status line");
  assert.deepEqual(h.notifications, [
    { message: "aaii-router: Cooldown window = 10m", type: "info" },
    { message: "aaii-router: PI_AAII_ROUTER_VISION still override this session", type: "warning" },
  ]);

  // Request again to set status line back
  await h.request();
  assert.equal(h.statuses.at(-1), "aaii → one/a");

  // `reset` writes defaults, refreshes status line (clearing it), and warns about the env override
  h.notifications.length = 0;
  await h.command("reset");
  assert.equal(h.statuses.at(-1), undefined, "reset must refresh the status line");
  assert.deepEqual(h.notifications, [
    { message: `aaii-router: defaults written to ${process.env.PI_AAII_ROUTER_SETTINGS}`, type: "info" },
    { message: "aaii-router: PI_AAII_ROUTER_VISION still override this session", type: "warning" },
  ]);
});
