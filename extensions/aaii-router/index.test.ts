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
import { sdkStubPackages, VIRTUAL_MODEL_STATE_ENTRY } from "./test-support.ts";

let moduleDirectory: string;
let registerRouter: typeof registerRouterType;

let moduleHarness: Awaited<ReturnType<typeof createModuleHarness>>;
after(async () => { await moduleHarness?.cleanup(); });

before(async () => {
  const modules = [
    ...["index.ts", "candidates.ts", "chain-order.ts", "cooldown.ts", "groups.ts", "strategy.ts", "explain.ts", "settings.ts", "fallback-editor.ts", "fallback-tui.ts"]
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

async function harness(
  t: { after: (cleanup: () => Promise<void>) => void },
  initial: Settings = DEFAULT_SETTINGS,
  models: object[] = [
    { provider: "one", id: "a", api: "test", input: ["text"], baseUrl: "https://one.example/v1" },
    { provider: "two", id: "b", api: "test", input: ["text"], baseUrl: "https://two.example/v1" },
    { provider: "three", id: "c", api: "test", input: ["text"], baseUrl: "https://three.example/v1" },
  ],
) {
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
  const routes = new Map<string, Route>();
  const registeredIds: string[] = [];
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let sessionStart!: (event: unknown, ctx: ExtensionCommandContext) => void;
  await registerRouter({
    registerVirtualModel: (definition) => { registeredIds.push(definition.id); routes.set(definition.id, definition.route); },
    registerCommand: (_name, definition) => { command = definition.handler; },
    on: (event, handler) => { if (event === "session_start") sessionStart = handler; },
  } as ExtensionAPI);
  const route = routes.get("aaii")!;
  let choice = "Done";
  let answer = "";
  let keys: string[] = [];
  const notifications: { message: string; type?: string }[] = [];
  const statuses: (string | undefined)[] = [];
  // The branch the router records state on: one custom entry per returned
  // state, newest last, the way a session accumulates them.
  const branch: object[] = [];
  const ctx = {
    cwd: directory, hasUI: true, mode: "tui", isProjectTrusted: () => false,
    sessionManager: { getBranch: () => branch },
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
  /** Route a request against one virtual model, e.g. `deepseek-v4.1-flash`. */
  const requestOn = async (id: string, state?: RouterState, extra: object = {}) => {
    const routed = await routes.get(id)!(
      { reason: "turn", messages: [], thinkingLevel: "off", state, ...extra } as Request, ctx,
    );
    branch.push({ type: "custom", customType: VIRTUAL_MODEL_STATE_ENTRY, data: { provider: "fallback", modelId: id, state: routed.state } });
    return routed;
  };
  return {
    directory,
    /** The virtual-model ids the factory registered, in order. */
    registeredIds,
    request,
    requestOn,
    /** The session branch double, so a test can add a `model_change`. */
    branch,
    remember: async (index: number) => (await request(undefined, {
      reason: "continuation", previous: { model: models[index] },
    })).state as RouterState,
    command: (args: string) => command(args, ctx),
    window: async (label: string, value: string) => {
      choice = label; answer = value; await command("settings", ctx);
    },
    fallback: async (...input: string[]) => { keys = input; await command("fallback", ctx); },
    notifications, statuses,
    /** The host session double, so a test can switch it out of the TUI. */
    session: ctx as unknown as { mode: string },
  };
}

test("the extension registers the full chain and the seeded family groups as virtual models", async (t) => {
  const h = await harness(t);
  assert.deepEqual(h.registeredIds, ["aaii", "deepseek-v4.1-flash", "glm-5.3-flash"]);
});

test("explain reports the last routing decision, or says there is none yet", async (t) => {
  const h = await harness(t);
  await h.command("explain");
  assert.match(h.notifications.at(-1)!.message, /no routing decision yet/);

  await h.request();
  h.notifications.length = 0;
  await h.command("explain");
  const message = h.notifications.at(-1)!.message;
  assert.match(message, /^aaii-router: aaii: one\/a — fresh turn/);
  assert.match(message, /order: \*one\/a → two\/b → three\/c/);
});

test("affinity turn starts every new user turn from the head of the order", async (t) => {
  const h = await harness(t, { ...DEFAULT_SETTINGS, affinity: "turn" });
  assert.equal((await h.request()).state.label, "one/a");
  // A second new turn with remembered state still starts from the head.
  const remembered = await h.remember(2);
  assert.equal(remembered.label, "three/c");
  assert.equal((await h.request(remembered)).state.label, "one/a");
});

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
  ["excluded", "one/a", "two/b", 2],
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

test("fallback outside the TUI warns and names the scriptable keys instead of throwing", async (t) => {
  const h = await harness(t);
  h.session.mode = "rpc";
  await h.command("fallback");
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].type, "warning");
  assert.match(h.notifications[0].message, /the chain editor needs the TUI \(this session is "rpc"\)/);
  assert.match(h.notifications[0].message, /set pinned <provider\/id,\.\.\.>/);
  assert.match(h.notifications[0].message, /set excluded <provider\/id,\.\.\.>/);
});

test("routing refuses a chain with no eligible models", async (t) => {
  const h = await harness(t);
  await h.command("set excluded one/a,two/b,three/c");
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

test("a family route orders by the quota that replenishes soonest and steps past a failure", async (t) => {
  const models = [
    { provider: "explabs", id: "deepseek-v4.1-flash", api: "test", input: ["text"], baseUrl: "https://api.experientiallabs.ai/v1" },
    { provider: "hive", id: "deepseek-ai/deepseek-v4.1-flash-1017", api: "test", input: ["text"], baseUrl: "https://api.thehive.ai/api/v3" },
    { provider: "nvidia", id: "deepseek-ai/deepseek-v4.1-flash", api: "test", input: ["text"], baseUrl: "https://integrate.api.nvidia.com/v1" },
    { provider: "zcode", id: "GLM-5.3-Flash", api: "test", input: ["text"], baseUrl: "https://zcode.example/v1" },
  ];
  const h = await harness(t, DEFAULT_SETTINGS, models);
  // Tier order inside the family: daily (nvidia) < monthly (explabs) < unclassified (hive).
  const first = await h.requestOn("deepseek-v4.1-flash");
  assert.equal(first.state.label, "nvidia/deepseek-ai/deepseek-v4.1-flash");
  assert.equal(h.statuses.at(-1), "deepseek-v4.1-flash → nvidia/deepseek-ai/deepseek-v4.1-flash");
  // A failure steps to the next tier and cools the failed one for the next turn.
  const retried = await h.requestOn("deepseek-v4.1-flash", first.state, {
    reason: "retry",
    failed: { model: models[2], message: { stopReason: "error", errorMessage: "429 too many requests" } },
  });
  assert.equal(retried.state.label, "explabs/deepseek-v4.1-flash");
  const nextTurn = await h.requestOn("deepseek-v4.1-flash", retried.state);
  assert.equal(nextTurn.state.label, "explabs/deepseek-v4.1-flash");
  // The glm-5.3-flash route only sees the flash variant; GLM-5.3 proper is out.
  const glm = await h.requestOn("glm-5.3-flash");
  assert.equal(glm.state.label, "zcode/GLM-5.3-Flash");
});

test("a retry walks the order the failed turn started from, not the next turn's", async (t) => {
  const h = await harness(t, { ...DEFAULT_SETTINGS, strategy: "rotate" });
  // Fresh turn: rotate offset 0 serves the head and stores `{ turns: 1 }`.
  const first = await h.request();
  assert.equal(first.state.label, "one/a");
  // The stored state is fed back unchanged, exactly as a session retry does.
  // Without the rewind, recomputing rotate from `turns: 1` put one/a last and
  // the retry threw "chain is exhausted" with two candidates still alive.
  const retried = await h.request(first.state, {
    reason: "retry",
    failed: { model: { provider: "one", id: "a" }, message: { stopReason: "error", errorMessage: "429 too many requests" } },
  });
  assert.equal(retried.state.label, "two/b");
  // The retry does not move the rotation on: the next user turn does.
  assert.deepEqual(retried.state.strategy, { turns: 1 });
});

test("least-used counts the model that actually served, including one cooling moved into the seat", async (t) => {
  const h = await harness(t, { ...DEFAULT_SETTINGS, strategy: "least-used", affinity: "turn" });
  // All counts tie at zero, so the policy order stands and one/a serves; the
  // count lands on the responder, which `stick` records whatever put it there.
  const first = await h.request();
  assert.equal(first.state.label, "one/a");
  assert.deepEqual(first.state.strategy, { served: { "one/a": 1 } });
  // The served count moves one/a to the back of the order: the next fresh
  // turn serves two/b — the wiring the retry and continuation paths share.
  const second = await h.request(first.state);
  assert.equal(second.state.label, "two/b");
  // Cooling one/a out of the turn still counts the responder, two/b — not the
  // order head the cooling displaced.
  const cooled = { ...first.state, cooldowns: { "one/a": { until: Date.now() + 60_000, reason: "rate-limit" as const } } };
  const third = await h.request(cooled);
  assert.equal(third.state.label, "two/b");
  assert.deepEqual(third.state.strategy, { served: { "one/a": 1, "two/b": 1 } });
});

test("set strategy rotate rotates the next fresh turns without a reload", async (t) => {
  // Turn affinity keeps every fresh turn on the strategy order's head, so the
  // rotation is visible; auto affinity would resume the remembered candidate
  // and is a separate setting's contract.
  const h = await harness(t, { ...DEFAULT_SETTINGS, affinity: "turn" });
  const before = await h.request();
  assert.equal(before.state.label, "one/a");
  await h.command("set strategy rotate");
  // The first fresh turn under the new strategy starts the rotation at the
  // head; the second one walks it — the setting is read again every request.
  const first = await h.request(before.state);
  assert.equal(first.state.label, "one/a");
  assert.deepEqual(first.state.strategy, { turns: 1 });
  const second = await h.request(first.state);
  assert.equal(second.state.label, "two/b");
});

test("a group's own strategy rotates its route while the global order stays on the head", async (t) => {
  const models = [
    { provider: "one", id: "probe", api: "test", input: ["text"], baseUrl: "https://one.example/v1" },
    { provider: "two", id: "probe-fast", api: "test", input: ["text"], baseUrl: "https://two.example/v1" },
    { provider: "three", id: "other", api: "test", input: ["text"], baseUrl: "https://three.example/v1" },
  ];
  const h = await harness(t, {
    ...DEFAULT_SETTINGS,
    strategy: "order",
    affinity: "turn",
    groups: [{ id: "probe-rot", name: "probe rotate", match: "probe", strategy: "rotate", affinity: "turn" }],
  }, models);
  await writeFile(join(h.directory, "scores.json"), JSON.stringify({ scores: {
    probe: { score: 90 }, "probe-fast": { score: 60 }, other: { score: 30 },
  } }));
  // The full chain keeps the global order strategy: turn affinity always
  // returns to the head.
  const first = await h.request();
  assert.equal(first.state.label, "one/probe");
  assert.equal((await h.request(first.state)).state.label, "one/probe");
  // The group's own rotate strategy moves its route on, one turn later.
  const groupFirst = await h.requestOn("probe-rot");
  assert.equal(groupFirst.state.label, "one/probe");
  const groupSecond = await h.requestOn("probe-rot", groupFirst.state);
  assert.equal(groupSecond.state.label, "two/probe-fast");
});

test("a group's own affinity keeps the session where failure moved it while the global turn affinity returns to the head", async (t) => {
  const models = [
    { provider: "one", id: "probe", api: "test", input: ["text"], baseUrl: "https://one.example/v1" },
    { provider: "two", id: "probe-fast", api: "test", input: ["text"], baseUrl: "https://two.example/v1" },
    { provider: "three", id: "other", api: "test", input: ["text"], baseUrl: "https://three.example/v1" },
  ];
  const h = await harness(t, {
    ...DEFAULT_SETTINGS,
    cooldownMs: 0,
    strategy: "order",
    affinity: "turn",
    groups: [{ id: "probe-sess", name: "probe session", match: "probe", affinity: "session" }],
  }, models);
  await writeFile(join(h.directory, "scores.json"), JSON.stringify({ scores: {
    probe: { score: 90 }, "probe-fast": { score: 60 }, other: { score: 30 },
  } }));
  const groupFirst = await h.requestOn("probe-sess");
  assert.equal(groupFirst.state.label, "one/probe");
  // The failure steps the group to its second candidate; the window is off, so
  // nothing is cooling afterwards.
  const retried = await h.requestOn("probe-sess", groupFirst.state, {
    reason: "retry",
    failed: { model: models[0], message: { stopReason: "error", errorMessage: "429 too many requests" } },
  });
  assert.equal(retried.state.label, "two/probe-fast");
  // The group's session affinity resumes what failure moved; the inherited
  // turn affinity would have climbed back to the head.
  const nextTurn = await h.requestOn("probe-sess", retried.state);
  assert.equal(nextTurn.state.label, "two/probe-fast");
});

test("set groups reports the entries it dropped and keeps the valid ones", async (t) => {
  const h = await harness(t);
  const value = JSON.stringify([
    { id: "glm-x", name: "GLM X", match: "glm-5-3-flash" },
    { id: "aaii", match: "glm-5-3-flash" },
  ]);
  await h.command(`set groups ${value}`);
  const note = h.notifications.find(({ type }) => type === "warning");
  assert.ok(note, "a partially rejected groups value must be reported");
  assert.match(note!.message, /groups\[1\].*reserved for the full chain/);
  // The valid entry survived into the written file.
  const saved = JSON.parse(await readFile(process.env.PI_AAII_ROUTER_SETTINGS!, "utf8"));
  assert.deepEqual(saved.groups.map((group: { id: string }) => group.id), ["glm-x"]);
});

test("settings window reports the groups entries it dropped, like set does", async (t) => {
  const h = await harness(t);
  const value = JSON.stringify([
    { id: "qwen-x", match: "qwen3-8-max" },
    { id: "aaii", match: "glm-5-3-flash" },
  ]);
  await h.window("Routing groups: current", value);
  const note = h.notifications.find(({ type }) => type === "warning");
  assert.ok(note, "a partially rejected groups value must be reported");
  assert.match(note!.message, /groups\[1\].*reserved for the full chain/);
  // The valid entry survived into the written file.
  const saved = JSON.parse(await readFile(process.env.PI_AAII_ROUTER_SETTINGS!, "utf8"));
  assert.deepEqual(saved.groups.map((group: { id: string }) => group.id), ["qwen-x"]);
});

test("a family route with no candidate refuses rather than guessing a model", async (t) => {
  const h = await harness(t);
  await assert.rejects(h.requestOn("glm-5.3-flash"), /\[aaii-router\/glm-5.3-flash\] no eligible model/);
});

test("next steps past the head of the route the session is on, not the full chain's", async (t) => {
  const models = [
    { provider: "nvidia", id: "deepseek-ai/deepseek-v4.1-flash", api: "test", input: ["text"], baseUrl: "https://integrate.api.nvidia.com/v1" },
    { provider: "zcode", id: "GLM-5.3-Flash", api: "test", input: ["text"], baseUrl: "https://zcode.example/v1" },
    { provider: "explabs", id: "glm-5.3-flash-free", api: "test", input: ["text"], baseUrl: "https://api.experientiallabs.ai/v1" },
  ];
  const h = await harness(t, DEFAULT_SETTINGS, models);
  // No state yet: `next` falls back to the full chain's head (nvidia, daily tier).
  await h.command("next");
  assert.match(h.notifications.at(-1)!.message, /nvidia\/deepseek-ai\/deepseek-v4\.1-flash is out/);
  // A glm-5.3-flash session: the family's own head is explabs (monthly tier;
  // zcode is unclassified), so `next` names that, not the full chain's nvidia.
  const glm = await h.requestOn("glm-5.3-flash");
  assert.equal(glm.state.label, "explabs/glm-5.3-flash-free");
  await h.command("next");
  assert.match(h.notifications.at(-1)!.message, /explabs\/glm-5\.3-flash-free is out/);
  // The manual cooldown moved the family route to its second candidate.
  assert.equal((await h.requestOn("glm-5.3-flash", glm.state)).state.label, "zcode/GLM-5.3-Flash");
});

test("a model_change away from a recorded state drops the stale label", async (t) => {
  const models = [
    { provider: "nvidia", id: "deepseek-ai/deepseek-v4.1-flash", api: "test", input: ["text"], baseUrl: "https://integrate.api.nvidia.com/v1" },
    { provider: "zcode", id: "GLM-5.3-Flash", api: "test", input: ["text"], baseUrl: "https://zcode.example/v1" },
  ];
  const h = await harness(t, DEFAULT_SETTINGS, models);
  const glm = await h.requestOn("glm-5.3-flash");
  // The operator switches the session to the deepseek route: the glm state
  // must not leak into `next`, which would cool a model deepseek never walks.
  h.branch.push({ type: "model_change", provider: "fallback", modelId: "deepseek-v4.1-flash" });
  await h.command("next");
  assert.match(h.notifications.at(-1)!.message, /nvidia\/deepseek-ai\/deepseek-v4\.1-flash is out/);
  // The deepseek route starts from its own head; the glm state did not leak.
  assert.equal((await h.requestOn("deepseek-v4.1-flash", glm.state)).state.label, "nvidia/deepseek-ai/deepseek-v4.1-flash");
});
