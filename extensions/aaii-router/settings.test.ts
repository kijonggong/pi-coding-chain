/**
 * Tests for the router settings.
 *
 * Run with:
 *   node --test extensions/aaii-router/settings.test.ts
 *
 * The file-level tests work on throwaway copies in the system temp directory.
 * Nothing here touches `~/.pi/agent/aaii-router.json`.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_EXCLUDED_PROVIDERS,
  DEFAULT_SETTINGS,
  PROJECT_KEYS,
  SETTINGS,
  SUBCOMMANDS,
  completionsFor,
  describeSettings,
  editSetting,
  loadSettings,
  milliseconds,
  parseGroupsValue,
  parseModelEntries,
  parseDuration,
  parseList,
  parseOrigins,
  parseSettings,
  parseToggle,
  readSettingsFile,
  resolveSettings,
  routingChanged,
  saveSettings,
  serializeSettings,
} from "./settings.ts";

test("a fresh install has every setting at its default", () => {
  assert.deepEqual(resolveSettings({}), { settings: DEFAULT_SETTINGS, notes: [], applied: [] });
  assert.equal(DEFAULT_SETTINGS.cooldownMs, DEFAULT_COOLDOWN_MS);
  assert.deepEqual(DEFAULT_SETTINGS.excludedOrigins, ["http://127.0.0.1:4000"]);
  // No provider is excluded by default: a gateway's ordinary entries are
  // ordinary models. The routing-feature *models* are dropped by id instead
  // (isRouterModelId, covered in candidates.test.ts).
  assert.deepEqual(DEFAULT_SETTINGS.excludedProviders, []);
  assert.equal(DEFAULT_SETTINGS.excludedProviders, DEFAULT_EXCLUDED_PROVIDERS);
});

test("reads a duration in the units an operator would write", () => {
  assert.equal(parseDuration("300000"), 300_000);
  assert.equal(parseDuration("300s"), 300_000);
  assert.equal(parseDuration("5m"), 300_000);
  assert.equal(parseDuration("1h"), 3_600_000);
  assert.equal(parseDuration("2m30s"), undefined, "one unit per value");
  assert.equal(parseDuration("off"), 0);
  assert.equal(parseDuration("0"), 0);
  assert.equal(parseDuration("-5m"), undefined);
  assert.equal(parseDuration("soon"), undefined);
  assert.equal(parseDuration(""), undefined);
});

test("reads a toggle the way a settings file would spell it", () => {
  for (const on of ["on", "true", "yes", "1", "enable", "enabled", "ON", "Enabled"]) assert.equal(parseToggle(on), true, on);
  for (const off of ["off", "false", "no", "0", "disable", "disabled", " Off ", "Disabled"]) assert.equal(parseToggle(off), false, off);
  assert.equal(parseToggle("maybe"), undefined);
  assert.equal(parseToggle(""), undefined);
});

test("normalizes an origin and refuses what is not one", () => {
  assert.deepEqual(parseOrigins("https://api.example.com/v1").origins, ["https://api.example.com"]);
  assert.deepEqual(parseOrigins("https://a.example.com, https://b.example.com").origins, [
    "https://a.example.com",
    "https://b.example.com",
  ]);
  assert.deepEqual(parseOrigins("https://a.example.com, https://a.example.com").origins, ["https://a.example.com"]);
  assert.deepEqual(parseOrigins("").origins, [], "an empty list is a list, not an error");
  assert.deepEqual(parseOrigins("ftp://files.example.com").origins, undefined);
  assert.deepEqual(parseOrigins("not a url").rejected, ["not a url"]);
  assert.deepEqual(parseList(" openrouter, cline ,, openrouter "), ["openrouter", "cline"]);
});

test("validates one setting at a time, so the wizard can refuse a typo", () => {
  const cooldown = editSetting(DEFAULT_SETTINGS, "cooldown", "2m");
  assert.equal(cooldown.ok, true);
  assert.equal(cooldown.ok && cooldown.settings.cooldownMs, 120_000);

  assert.deepEqual(editSetting(DEFAULT_SETTINGS, "cooldown", "soon"), {
    ok: false,
    reason: "not a duration: soon",
  });
  assert.deepEqual(editSetting(DEFAULT_SETTINGS, "status", "maybe"), {
    ok: false,
    reason: "expected on, true, yes, 1, enable, enabled, off, false, no, 0, disable, disabled, got: maybe",
  });
  assert.deepEqual(editSetting(DEFAULT_SETTINGS, "origins", "ftp://x"), {
    ok: false,
    reason: "not an http(s) origin: ftp://x",
  });
  assert.deepEqual(editSetting(DEFAULT_SETTINGS, "providers", "open router"), {
    ok: false,
    reason: "not a provider id: open router",
  });

  const vision = editSetting(DEFAULT_SETTINGS, "vision", "off");
  assert.equal(vision.ok && vision.settings.preferVision, false);
  const status = editSetting(DEFAULT_SETTINGS, "status", "disable");
  assert.equal(status.ok && status.settings.statusLine, false);
  const providers = editSetting(DEFAULT_SETTINGS, "providers", "openrouter, litellm");
  assert.deepEqual(providers.ok && providers.settings.excludedProviders, ["openrouter", "litellm"]);
  // The settings that were not named are not disturbed.
  assert.equal(providers.ok && providers.settings.cooldownMs, DEFAULT_COOLDOWN_MS);

  const models = editSetting(
    DEFAULT_SETTINGS,
    "models",
    "commandcode/deepseek/deepseek-v4.1-flash, skyautonet-local/qwen3.8-flash-next-iq3_s",
  );
  assert.deepEqual(models.ok && models.settings.allowedModels, [
    "commandcode/deepseek/deepseek-v4.1-flash",
    "skyautonet-local/qwen3.8-flash-next-iq3_s",
  ]);
  assert.deepEqual(editSetting(DEFAULT_SETTINGS, "models", "deepseek-v4.1-flash"), {
    ok: false,
    reason: "not provider/id: deepseek-v4.1-flash",
  });
  assert.deepEqual(editSetting(DEFAULT_SETTINGS, "models", "/deepseek-v4.1-flash").ok, false);
  assert.deepEqual(parseModelEntries("a/b, c").rejected, ["c"]);
});

test("reports what a file said that could not be used instead of guessing", () => {
  const parsed = parseSettings(
    JSON.stringify({
      cooldown: "5m",
      vision: false,
      status: "on",
      providers: ["openrouter"],
      mystery: 1,
      origins: { nested: 1 },
      wrong: "value",
    }),
  );

  assert.equal(parsed.settings.cooldownMs, 300_000);
  assert.equal(parsed.settings.preferVision, false);
  assert.equal(parsed.settings.statusLine, true);
  assert.deepEqual(parsed.settings.excludedProviders, ["openrouter"]);
  assert.deepEqual(parsed.notes, [
    'ignored unknown setting "mystery"',
    'ignored "origins": expected a number, a string, a boolean, or a list of strings',
    'ignored unknown setting "wrong"',
  ]);
  // Only the keys the file named are applied, so a merge can leave the rest alone.
  assert.deepEqual(parsed.applied, ["cooldown", "vision", "status", "providers"]);

  assert.match(parseSettings("{ not json").notes[0], /not valid JSON/);
  assert.match(parseSettings("[]").notes[0], /not a JSON object/);
  // A file that is broken does not take the defaults away from the router.
  assert.deepEqual(parseSettings("{ not json").settings, DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings("{ not json").applied, []);
});

test("the environment overrides the file, and a bad override is reported", () => {
  const global = JSON.stringify({ cooldown: 60_000, providers: ["openrouter"] });

  const fromEnv = resolveSettings({ global, env: { PI_AAII_ROUTER_COOLDOWN_MS: "10m" } });
  assert.equal(fromEnv.settings.cooldownMs, 600_000);
  assert.deepEqual(fromEnv.settings.excludedProviders, ["openrouter"], "the file still supplies the rest");

  const bad = resolveSettings({ global, env: { PI_AAII_ROUTER_COOLDOWN_MS: "soon" } });
  assert.equal(bad.settings.cooldownMs, 60_000, "a bad override must not erase the configured value");
  assert.deepEqual(bad.notes, ["ignored PI_AAII_ROUTER_COOLDOWN_MS: not a duration: soon"]);

  const blank = resolveSettings({ global, env: { PI_AAII_ROUTER_STATUS: "  " } });
  assert.equal(blank.settings.statusLine, true);
  assert.deepEqual(blank.notes, [], "an empty variable is not an override");
});

test("a project file is merged key by key, and cannot redirect the chain", () => {
  const global = JSON.stringify({ cooldown: 60_000, providers: ["relay"] });
  const project = JSON.stringify({ cooldown: "15m", providers: ["openrouter"], status: false });

  const merged = resolveSettings({ global, project });
  assert.equal(merged.settings.cooldownMs, 900_000, "the project changes how long a failure is remembered");
  assert.equal(merged.settings.statusLine, false);
  assert.deepEqual(
    merged.settings.excludedProviders,
    ["relay"],
    "a project must not be able to take a provider out of the chain",
  );
  assert.deepEqual(merged.notes, [
    'ignored project setting "providers": a project may not change where requests go',
  ]);
  assert.ok(PROJECT_KEYS.length > 0 && !PROJECT_KEYS.includes("providers"));

  // A project file that names one key leaves every other setting as the global
  // file left it, including one the global file set and the project did not.
  const narrow = resolveSettings({ global, project: JSON.stringify({ status: "off" }) });
  assert.equal(narrow.settings.cooldownMs, 60_000);
  assert.deepEqual(narrow.settings.excludedProviders, ["relay"]);
  assert.equal(narrow.settings.statusLine, false);
});

test("writes a file it can read back", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    cooldownMs: 90_000,
    excludedProviders: ["openrouter"],
    allowedModels: ["commandcode/deepseek/deepseek-v4.1-flash"],
  };
  const text = serializeSettings(settings);

  assert.deepEqual(parseSettings(text).settings, settings, "the file form is the parsed form");
  assert.deepEqual(parseSettings(text).notes, []);
  assert.deepEqual(Object.keys(JSON.parse(text)), [
    "cooldown",
    "vision",
    "status",
    "origins",
    "providers",
    "models",
    "pinned",
    "excluded",
    "strategy",
    "affinity",
    "groups",
  ]);
  assert.ok(text.endsWith("\n"));
});

test("an allowlist can be written as a partial file and read back", () => {
  const parsed = parseSettings(JSON.stringify({ models: ["commandcode/deepseek/deepseek-v4.1-flash"] }));

  assert.deepEqual(parsed.settings.allowedModels, ["commandcode/deepseek/deepseek-v4.1-flash"]);
  assert.deepEqual(parsed.notes, []);
  assert.deepEqual(parsed.applied, ["models"]);
  // Only the named key changed; every other setting stays at its default.
  assert.equal(parsed.settings.cooldownMs, DEFAULT_SETTINGS.cooldownMs);
  assert.deepEqual(parsed.settings.excludedOrigins, DEFAULT_SETTINGS.excludedOrigins);
});

test("the environment can hold the allowlist, and a bare model id is refused", () => {
  const fromEnv = resolveSettings({
    env: { PI_AAII_ROUTER_ALLOW_MODELS: "commandcode/deepseek/deepseek-v4.1-flash" },
  });
  assert.deepEqual(fromEnv.settings.allowedModels, ["commandcode/deepseek/deepseek-v4.1-flash"]);

  const bad = resolveSettings({ env: { PI_AAII_ROUTER_ALLOW_MODELS: "deepseek-v4.1-flash" } });
  assert.deepEqual(bad.notes, [
    "ignored PI_AAII_ROUTER_ALLOW_MODELS: not provider/id: deepseek-v4.1-flash",
  ]);
  assert.deepEqual(bad.settings.allowedModels, []);
});

test("model labels require both provider and id, deduplicate, and allow nested model ids", () => {
  for (const key of ["pinned", "excluded"] as const) {
    for (const invalid of ["model", "/model", "provider/", "provider/ ", " /model"]) {
      const edited = editSetting(DEFAULT_SETTINGS, key, invalid);
      assert.equal(edited.ok, false, `${key}: ${invalid}`);
      if (!edited.ok) assert.match(edited.reason, /not provider\/id/);
    }
    const edited = editSetting(DEFAULT_SETTINGS, key, "openrouter/anthropic/model, direct/model, openrouter/anthropic/model");
    assert.equal(edited.ok, true);
    assert.deepEqual(edited.ok && edited.settings[key === "pinned" ? "pinnedModels" : "excludedModels"], ["openrouter/anthropic/model", "direct/model"]);
    const empty = editSetting(DEFAULT_SETTINGS, key, "");
    assert.deepEqual(empty.ok && empty.settings[key === "pinned" ? "pinnedModels" : "excludedModels"], []);
  }
});

test("pins and model exclusions round-trip, describe their values, and accept environment overrides", () => {
  const settings = { ...DEFAULT_SETTINGS, pinnedModels: ["a/first", "b/second"], excludedModels: ["c/third"] };
  assert.deepEqual(parseSettings(serializeSettings(settings)).settings, settings);
  assert.deepEqual(parseSettings(serializeSettings(settings)).notes, []);
  const lines = describeSettings(settings);
  assert.ok(lines.includes("Pinned models: a/first, b/second"));
  assert.ok(lines.includes("Excluded models: c/third"));
  const resolved = resolveSettings({ global: serializeSettings(settings), env: {
    PI_AAII_ROUTER_PINNED: "d/fourth", PI_AAII_ROUTER_EXCLUDE_MODELS: "e/fifth",
  } });
  assert.deepEqual(resolved.settings.pinnedModels, ["d/fourth"]);
  assert.deepEqual(resolved.settings.excludedModels, ["e/fifth"]);
  assert.deepEqual(resolved.notes, []);
});

// Interactive edits, files and environment are three separate trust boundaries.
test("model labels reject internal whitespace through edits, files and environment", () => {
  for (const key of ["pinned", "excluded"] as const) {
    for (const invalid of ["open router/model", "provider/ model", "provider/model name", "a/b c/d", "provider/\tmodel", "provider /model"]) {
      assert.equal(editSetting(DEFAULT_SETTINGS, key, invalid).ok, false, `${key}: ${invalid}`);
      const parsed = parseSettings(JSON.stringify({ [key]: [invalid] }));
      assert.deepEqual(parsed.applied, []);
      assert.match(parsed.notes[0], /not provider\/id/);
      const envVar = key === "pinned" ? "PI_AAII_ROUTER_PINNED" : "PI_AAII_ROUTER_EXCLUDE_MODELS";
      const resolved = resolveSettings({ env: { [envVar]: invalid } });
      assert.deepEqual(resolved.settings, DEFAULT_SETTINGS);
      assert.match(resolved.notes[0], /not provider\/id/);
    }
    const edited = editSetting(DEFAULT_SETTINGS, key, " provider/nested/model \n other/model, provider/nested/model ");
    assert.deepEqual(edited.ok && edited.settings[key === "pinned" ? "pinnedModels" : "excludedModels"], ["provider/nested/model", "other/model"]);
  }
  assert.deepEqual(parseList("a/b c/d, e/f\ng/h"), ["a/b c/d", "e/f", "g/h"]);
});

test("project files cannot change pins or model exclusions and older files need no migration", () => {
  const settings = { ...DEFAULT_SETTINGS, pinnedModels: ["a/first"], excludedModels: ["b/second"] };
  const resolved = resolveSettings({ global: serializeSettings(settings), project: JSON.stringify({ pinned: ["c/third"], excluded: ["a/first"] }) });
  assert.deepEqual(resolved.settings, settings);
  assert.deepEqual(resolved.notes, [
    'ignored project setting "pinned": a project may not change where requests go',
    'ignored project setting "excluded": a project may not change where requests go',
  ]);
  assert.ok(!PROJECT_KEYS.includes("pinned") && !PROJECT_KEYS.includes("excluded"));
  const old = parseSettings(JSON.stringify({ cooldown: 300000, vision: true, status: true, origins: [], providers: [] }));
  assert.deepEqual(old.notes, []);
  assert.deepEqual(old.settings.pinnedModels, []);
  assert.deepEqual(old.settings.excludedModels, []);
});

test("strategy and affinity are word-validated everywhere a value can enter, and the environment overrides", () => {
  assert.deepEqual(editSetting(DEFAULT_SETTINGS, "strategy", "rotate"), {
    ok: true,
    settings: { ...DEFAULT_SETTINGS, strategy: "rotate" },
  });
  const badStrategy = editSetting(DEFAULT_SETTINGS, "strategy", "smart");
  assert.equal(badStrategy.ok, false);
  assert.match(!badStrategy.ok ? badStrategy.reason : "", /strategy is not one of/);
  const badAffinity = editSetting(DEFAULT_SETTINGS, "affinity", "strict");
  assert.equal(badAffinity.ok, false);
  assert.match(!badAffinity.ok ? badAffinity.reason : "", /affinity is not one of/);

  const file = JSON.stringify({ strategy: "least-used", affinity: "session" });
  assert.deepEqual(parseSettings(file).settings.strategy, "least-used");
  assert.equal(parseSettings(file).settings.affinity, "session");
  assert.deepEqual(parseSettings(file).notes, []);

  const fromEnv = resolveSettings({ global: file, env: { PI_AAII_ROUTER_STRATEGY: "free-first" } });
  assert.equal(fromEnv.settings.strategy, "free-first");
  const bad = resolveSettings({ global: file, env: { PI_AAII_ROUTER_AFFINITY: "off" } });
  assert.equal(bad.settings.affinity, "session", "a bad override must not erase the configured value");
  assert.match(bad.notes[0], /ignored PI_AAII_ROUTER_AFFINITY: affinity is not one of/);

  // The file form round-trips both words.
  const settings = { ...DEFAULT_SETTINGS, strategy: "manual" as const, affinity: "turn" as const };
  assert.deepEqual(parseSettings(serializeSettings(settings)).settings, settings);
});

test("groups parse from JSON: a bad entry is noted, the good entries survive", () => {
  const parsed = parseSettings(JSON.stringify({
    groups: [
      { id: "qwen", match: "qwen3-8-max" },
      { id: "aaii", match: "glm-5-3-flash" },
      { id: "bad id", match: "glm-5-3-flash" },
    ],
  }));
  // A file's groups value replaces the whole list — the file is the source.
  assert.deepEqual(parsed.settings.groups.map((group) => group.id), ["qwen"]);
  assert.deepEqual(parsed.notes, [
    'ignored "groups": groups[1]: the id "aaii" is reserved for the full chain',
    'ignored "groups": groups[2]: id is not a model id: bad id',
  ]);
  assert.deepEqual(parsed.applied, ["groups"]);
});

test("groups refuse a repeated id and groups that are not an array", () => {
  const duplicate = parseGroupsValue(JSON.stringify([
    { id: "glm", match: "glm-5-3-flash" },
    { id: "glm", match: "glm-5-2-flash" },
  ]));
  assert.deepEqual(duplicate.groups?.map((group) => group.id), ["glm"]);
  assert.deepEqual(duplicate.rejected, ['groups[1]: the id "glm" is already used by another group']);

  assert.match(parseGroupsValue("[not json").rejected[0], /not valid JSON/);
  assert.match(parseGroupsValue(JSON.stringify({ id: "glm", match: "glm-5-3-flash" })).rejected[0], /not a JSON array/);

  // Through parseSettings a groups object is not a shape the coercion can
  // even hand over; the message says so before validation runs.
  const refused = parseSettings(JSON.stringify({ groups: { id: "glm", match: "glm-5-3-flash" } }));
  assert.deepEqual(refused.settings.groups, DEFAULT_SETTINGS.groups);
  assert.match(refused.notes[0], /ignored "groups": expected a number, a string, a boolean, or a list of strings/);
});

test("groups are a redirect setting: a project file may not set them, the environment can", () => {
  const settings = { ...DEFAULT_SETTINGS, groups: [{ id: "qwen", name: "Qwen fallback", match: "qwen3-8-max" }] };
  const resolved = resolveSettings({
    global: serializeSettings(settings),
    project: JSON.stringify({ groups: [{ id: "own", match: "glm-5-3-flash" }] }),
  });
  assert.deepEqual(resolved.settings.groups, settings.groups, "the project's groups never land");
  assert.deepEqual(resolved.notes, ['ignored project setting "groups": a project may not change where requests go']);
  assert.ok(!PROJECT_KEYS.includes("groups"));

  const fromEnv = resolveSettings({ env: { PI_AAII_ROUTER_GROUPS: JSON.stringify([{ id: "qwen", match: "qwen3-8-max" }]) } });
  assert.deepEqual(fromEnv.settings.groups, [{ id: "qwen", name: "qwen3-8-max fallback", match: "qwen3-8-max" }]);
});

test("groups round-trip through the file, keeping a group's own strategy and affinity", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    strategy: "rotate" as const,
    groups: [
      { id: "glm", name: "GLM fallback", match: "glm-5-3-flash", strategy: "free-first" as const },
      { id: "qwen", name: "Qwen fallback", match: "qwen3-8-max", affinity: "turn" as const },
      { id: "deepseek", name: "DeepSeek fallback", match: "deepseek-v4-1-flash" },
    ],
  };
  const round = parseSettings(serializeSettings(settings));
  assert.deepEqual(round.settings, settings);
  assert.deepEqual(round.notes, []);
});

test("the same groups saved in a different key or array order do not bump the chain epoch", () => {
  const groups = [
    { id: "glm", name: "GLM fallback", match: "glm-5-3-flash", strategy: "free-first" as const },
    { id: "qwen", name: "Qwen fallback", match: "qwen3-8-max" },
  ];
  const settings = { ...DEFAULT_SETTINGS, groups };
  // Same content, every group's keys written in another order and the array
  // reversed: the comparison is over the tuples' content, not their spelling.
  const reordered = { ...DEFAULT_SETTINGS, groups: [
    { match: "qwen3-8-max", id: "qwen", name: "Qwen fallback" },
    { strategy: "free-first" as const, match: "glm-5-3-flash", id: "glm", name: "GLM fallback" },
  ] };
  assert.equal(routingChanged(settings, reordered), false);
  // The name is part of a group's content: renaming a group is a change, and
  // it resets the remembered candidate `auto` affinity would resume.
  const renamed = { ...DEFAULT_SETTINGS, groups: [
    { id: "glm", name: "GLM fallback renamed", match: "glm-5-3-flash", strategy: "free-first" as const },
    { id: "qwen", name: "Qwen fallback", match: "qwen3-8-max" },
  ] };
  assert.equal(routingChanged(settings, renamed), true);
});

test("shows one line per setting, marking the ones the environment holds", () => {
  const lines = describeSettings({ ...DEFAULT_SETTINGS, cooldownMs: 0, excludedProviders: [] });
  assert.equal(lines.length, SETTINGS.length);
  assert.ok(lines[0].startsWith("Cooldown window: off"), lines[0]);
  assert.ok(lines.some((line) => line === "Excluded providers: none"));
  assert.ok(lines.some((line) => line.includes("http://127.0.0.1:4000")));

  const marked = describeSettings(DEFAULT_SETTINGS, { PI_AAII_ROUTER_STATUS: "off", PI_AAII_ROUTER_VISION: "  " });
  assert.ok(marked.some((line) => line === "Footer status: on (env)"), "the window cannot write past the env");
  assert.ok(marked.some((line) => line === "Image-aware order: on"), "a blank variable is not a source");
});

test("completes the subcommands, then the setting keys, then the short values", () => {
  assert.deepEqual(completionsFor("").map((item) => item.value), SUBCOMMANDS.map((item) => item.value));
  assert.deepEqual(completionsFor("se").map((item) => item.value), ["settings", "set"]);
  assert.deepEqual(completionsFor("next"), [{ value: "next", description: SUBCOMMANDS.find((s) => s.value === "next")?.description }]);
  assert.deepEqual(completionsFor("nope"), []);

  const keys = completionsFor("set ").map((item) => item.value);
  assert.deepEqual(keys, SETTINGS.map((descriptor) => `set ${descriptor.key} `));
  assert.deepEqual(completionsFor("set co").map((item) => item.value), ["set cooldown "]);
  assert.deepEqual(completionsFor("set status ").map((item) => item.value), ["set status on", "set status off"]);
  assert.deepEqual(completionsFor("set status o").map((item) => item.value), ["set status on", "set status off"]);
  assert.deepEqual(completionsFor("set cooldown o").map((item) => item.value), ["set cooldown off"]);
  // A list setting's values come from the operator's configuration, not a table.
  assert.deepEqual(completionsFor("set providers "), []);
  assert.deepEqual(completionsFor("set mystery "), []);
});

test("saves and loads through the real file, and leaves no temporary behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aaii-router-settings-"));
  try {
    const path = join(dir, "aaii-router.json");

    // No file yet: the defaults, without a note that would alarm the operator.
    assert.deepEqual(await loadSettings({ global: path }, {}), { settings: DEFAULT_SETTINGS, notes: [], applied: [] });
    assert.equal(await readSettingsFile(path), undefined);

    const settings = { ...DEFAULT_SETTINGS, cooldownMs: 45_000, excludedOrigins: [] };
    await saveSettings(path, settings);
    assert.deepEqual(await loadSettings({ global: path }, {}), { settings, notes: [], applied: SETTINGS.map((d) => d.key) });
    assert.deepEqual(await readdir(dir), ["aaii-router.json"], "the write is atomic, not a leftover .tmp");

    // A hand edit that is wrong is reported, and the good values still apply.
    await writeFile(path, JSON.stringify({ cooldown: 30_000, vision: "sometimes" }), "utf8");
    const edited = await loadSettings({ global: path }, {});
    assert.equal(edited.settings.cooldownMs, 30_000);
    assert.equal(edited.settings.preferVision, true, "an unreadable value falls back rather than flipping a switch");
    assert.equal(edited.notes.length, 1);

    // The environment is read at load time, so it wins over the file on disk.
    const overridden = await loadSettings({ global: path }, { PI_AAII_ROUTER_VISION: "off" });
    assert.equal(overridden.settings.preferVision, false);
    assert.equal((await readFile(path, "utf8")) !== "", true, "loading never rewrites the file");

    // A project file is read only when the caller hands one over, which is how
    // trust is enforced: an untrusted project is simply never passed here.
    const project = join(dir, ".pi", "aaii-router.json");
    await writeFile(join(dir, "project.json"), JSON.stringify({ cooldown: 90_000 }), "utf8");
    const withProject = await loadSettings({ global: path, project: join(dir, "project.json") }, {});
    assert.equal(withProject.settings.cooldownMs, 90_000);
    assert.equal(await readSettingsFile(project), undefined, "a missing project file is not an error");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
