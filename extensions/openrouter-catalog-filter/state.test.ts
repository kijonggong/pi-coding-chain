/**
 * Tests for the allowlist on/off state.
 *
 * Run with:
 *   node --test extensions/openrouter-catalog-filter/state.test.ts
 *
 * The file-level tests use a throwaway directory, never the real agent
 * directory, so nothing here touches the operator's own state file.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_ENABLED,
  STATE_ENV,
  SUBCOMMANDS,
  completionsFor,
  describeState,
  loadState,
  parseState,
  parseSwitch,
  resolveState,
  saveState,
  serializeState,
} from "./state.ts";

test("a fresh install keeps the allowlist on", () => {
  // The switch was added to an extension that was already on for everyone, so
  // its default cannot be `off` without changing every existing install.
  assert.equal(DEFAULT_ENABLED, true);
  assert.deepEqual(resolveState({}), { enabled: true, source: "default", notes: [] });
});

test("reads a switch in the spellings a shell or a person would use", () => {
  for (const on of ["on", "ON", "true", "yes", "1", "enabled", " on "]) assert.equal(parseSwitch(on), true, on);
  for (const off of ["off", "false", "no", "0", "disabled", "Off"]) assert.equal(parseSwitch(off), false, off);
  assert.equal(parseSwitch("maybe"), undefined);
  assert.equal(parseSwitch(""), undefined);
});

test("distinguishes off from no opinion when the file is unreadable", () => {
  assert.deepEqual(parseState(serializeState(false)), { enabled: false, notes: [] });
  assert.deepEqual(parseState('{"enabled": "off"}'), { enabled: false, notes: [] });
  assert.deepEqual(parseState("{}").enabled, undefined, "a missing field is not an off switch");
  assert.match(parseState("{}").notes[0], /no "enabled" field/);
  assert.equal(parseState("{ not json").enabled, undefined);
  assert.match(parseState("{ not json").notes[0], /not valid JSON/);
  assert.equal(parseState("[]").enabled, undefined);
  assert.equal(parseState('{"enabled": 1}').enabled, undefined);
  // The note names every word the switch accepts, and that a JSON boolean is
  // also a file value.
  assert.equal(
    parseState('{"enabled": 1}').notes[0],
    'ignored "enabled": expected a JSON boolean or one of on, true, yes, 1, enable, enabled, off, false, no, 0, disable, disabled, got 1',
  );
});

test("the environment wins over the file, and a bad value is reported", () => {
  const off = serializeState(false);

  assert.deepEqual(resolveState({ file: off, env: { [STATE_ENV]: "on" } }), {
    enabled: true,
    source: "env",
    notes: [],
  });
  assert.deepEqual(resolveState({ file: serializeState(true), env: {} }), {
    enabled: true,
    source: "file",
    notes: [],
  });
  assert.deepEqual(resolveState({ file: off, env: { [STATE_ENV]: "sometimes" } }), {
    enabled: false,
    source: "file",
    notes: [
      'ignored PI_OPENROUTER_FILTER: expected one of on, true, yes, 1, enable, enabled, off, false, no, 0, disable, disabled, got "sometimes"',
    ],
  });
  // A blank variable is not an override.
  assert.deepEqual(resolveState({ file: off, env: { [STATE_ENV]: "  " } }).source, "file");

  // An unreadable file leaves the default in force, and says why.
  const broken = resolveState({ file: "{ not json" });
  assert.equal(broken.enabled, DEFAULT_ENABLED);
  assert.equal(broken.source, "default");
  assert.equal(broken.notes.length, 1);
});

test("the file form round-trips", () => {
  assert.deepEqual(parseState(serializeState(true)), { enabled: true, notes: [] });
  assert.deepEqual(parseState(serializeState(false)), { enabled: false, notes: [] });
  assert.equal(JSON.parse(serializeState(false)).enabled, false, "one field, so a hand edit is one line");
});

test("describes the state together with what decided it", () => {
  const path = "C:/Users/x/.pi/agent/openrouter-catalog-filter.json";
  assert.match(describeState({ enabled: true, source: "default", notes: [] }, path), /^allowlist on \(default\)$/);
  assert.equal(describeState({ enabled: false, source: "file", notes: [] }, path), `allowlist off (from ${path})`);
  assert.match(describeState({ enabled: false, source: "env", notes: [] }, path), new RegExp(`^allowlist off \\(${STATE_ENV} says so\\)$`));
});

test("completes the subcommands", () => {
  assert.deepEqual(completionsFor("").map((item) => item.value), SUBCOMMANDS.map((item) => item.value));
  assert.deepEqual(completionsFor("o").map((item) => item.value), ["on", "off"]);
  assert.deepEqual(completionsFor("off").map((item) => item.value), ["off"]);
  assert.deepEqual(completionsFor("  re"), [
    { value: "reload", description: SUBCOMMANDS.find((s) => s.value === "reload")?.description },
  ]);
  assert.deepEqual(completionsFor("nope"), []);
});

test("saves and loads through the real file, leaving no temporary behind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openrouter-filter-"));
  try {
    const path = join(dir, "openrouter-catalog-filter.json");

    // No file yet: the default, and no note that would alarm the operator.
    assert.deepEqual(await loadState(path, {}), { enabled: true, source: "default", notes: [] });

    await saveState(path, false);
    assert.deepEqual(await loadState(path, {}), { enabled: false, source: "file", notes: [] });
    assert.deepEqual(await readdir(dir), ["openrouter-catalog-filter.json"], "the write is atomic");

    await saveState(path, true);
    assert.deepEqual(await loadState(path, {}), { enabled: true, source: "file", notes: [] });

    // The environment still wins over what is on disk.
    const overridden = await loadState(path, { [STATE_ENV]: "off" });
    assert.equal(overridden.enabled, false);
    assert.equal(overridden.source, "env");

    // A hand-written file this module did not produce is read, not rejected.
    await writeFile(path, '{"enabled": "off"}\n', "utf8");
    assert.equal((await loadState(path, {})).enabled, false);

    // A read error other than ENOENT (e.g. attempting to read a directory) is
    // recorded as a note and leaves the default in force.
    const unreadable = await loadState(dir, {});
    assert.equal(unreadable.enabled, true);
    assert.equal(unreadable.source, "default");
    assert.equal(unreadable.notes.length, 1);
    assert.match(
      unreadable.notes[0],
      /^the state file could not be read: .*; its setting was ignored$/,
    );

    // An unreadable file does not prevent environment override, and the note is preserved.
    const unreadableWithEnv = await loadState(dir, { [STATE_ENV]: "off" });
    assert.equal(unreadableWithEnv.enabled, false);
    assert.equal(unreadableWithEnv.source, "env");
    assert.match(
      unreadableWithEnv.notes[0],
      /^the state file could not be read: .*; its setting was ignored$/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
