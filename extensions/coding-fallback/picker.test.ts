/**
 * Tests for the picker component.
 *
 * Run with:
 *   node --test extensions/coding-fallback/picker.test.ts
 *
 * The component imports the Pi SDK, which plain `node --test` has no way to
 * resolve — the repository ships no `node_modules`, and the extension is meant to
 * load inside Pi with the SDK supplied there. So this test builds a throwaway
 * copy of the component and the pure modules it imports, next to stub packages
 * for `@earendil-works/pi-tui` and `@earendil-works/pi-coding-agent`, and drives
 * the real component against them.
 *
 * The stubs are deliberately dumb — a list that filters on substrings, a text
 * field, the four keybindings the component asks about — because what is under
 * test is the picker's own key handling and rendering, not the SDK's. The keys
 * are the ones a terminal actually sends: `\x1b[B`, `\r`, `\x1b`, `" "`.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createModuleHarness } from "../../test-support/module-harness.ts";
import { pickerHint, pickerTitle } from "./catalog.ts";
import type { Candidate } from "./catalog.ts";
import type { PickerOutcome } from "./picker.ts";

type Component = {
  readonly markedCount: number;
  handleInput(data: string): void;
  render(width: number): string[];
};

type PickerClass = new (
  options: {
    readonly title: string;
    readonly hint: string;
    readonly candidates: readonly Candidate[];
    readonly maxVisible?: number;
  },
  theme: { fg: (color: string, text: string) => string; bold: (text: string) => string },
  done: (outcome: PickerOutcome) => void,
) => Component;

const MODULES = ["picker.ts", "catalog.ts", "chain.ts", "free-models.ts", "register.ts", "providers.ts", "scores.ts", "index.ts", "config.ts", "listing.ts", "free-fetch.ts"];

const PI_TUI_STUB = `
const down = "\\x1b[B";
const up = "\\x1b[A";
const confirm = "\\r";
const cancel = "\\x1b";

export function fuzzyFilter(items, query, getText) {
  const wanted = String(query).trim().toLowerCase();
  if (wanted === "") return items;
  return items.filter((item) => getText(item).toLowerCase().includes(wanted));
}

export function matchesKey(data, keyId) {
  return keyId === "space" && data === " ";
}

export function getKeybindings() {
  return {
    matches(data, binding) {
      if (binding === "tui.select.up") return data === up;
      if (binding === "tui.select.down") return data === down;
      if (binding === "tui.select.confirm") return data === confirm;
      if (binding === "tui.select.cancel") return data === cancel;
      return false;
    },
    getKeys() { return []; },
    getDefinition() { return { default: [], description: "" }; },
    getConflicts() { return []; },
    setUserBindings() {},
    getUserBindings() { return {}; },
    getResolvedBindings() { return {}; },
  };
}

export class SelectList {
  constructor(items, maxVisible, theme) {
    this.items = items;
    this.maxVisible = maxVisible;
    this.theme = theme;
    this.index = 0;
    this.filtered = items;
  }
  setFilter(filter) {
    this.filtered = fuzzyFilter(this.items, filter, (item) => item.label);
    this.index = 0;
  }
  setSelectedIndex(index) {
    this.index = Math.max(0, Math.min(index, this.filtered.length - 1));
  }
  getSelectedItem() {
    return this.filtered[this.index] ?? null;
  }
  invalidate() {}
  render() {
    return this.filtered.map((item, index) => {
      const prefix = index === this.index ? "→ " : "  ";
      return prefix + item.label + (item.description ? "   " + item.description : "");
    });
  }
  handleInput(data) {
    const kb = getKeybindings();
    if (kb.matches(data, "tui.select.up")) {
      if (this.filtered.length > 0) this.index = this.index === 0 ? this.filtered.length - 1 : this.index - 1;
      this.onSelectionChange?.(this.getSelectedItem());
      return;
    }
    if (kb.matches(data, "tui.select.down")) {
      if (this.filtered.length > 0) this.index = this.index === this.filtered.length - 1 ? 0 : this.index + 1;
      this.onSelectionChange?.(this.getSelectedItem());
      return;
    }
    if (kb.matches(data, "tui.select.confirm")) {
      const item = this.getSelectedItem();
      if (item) this.onSelect?.(item);
      return;
    }
    if (kb.matches(data, "tui.select.cancel")) this.onCancel?.();
  }
}

export class Input {
  constructor(options = {}) {
    this.options = options;
    this.value = "";
    this.focused = false;
  }
  getValue() { return this.value; }
  setValue(value) { this.value = value; }
  handleInput(data) {
    for (const character of data) {
      if (character === "\\x7f" || character === "\\b") this.value = this.value.slice(0, -1);
      else if (character >= " ") this.value += character;
    }
  }
  invalidate() {}
  render() { return [(this.options.prompt ?? "> ") + this.value]; }
}
`;

const SDK_STUB = `
export const getAgentDir = () => "unused-sdk-agent-directory";
export function getSelectListTheme() {
  const plain = (text) => text;
  return {
    selectedPrefix: plain,
    selectedText: plain,
    description: plain,
    scrollInfo: plain,
    noMatch: plain,
  };
}
`;

let dir: string;
let ModelPicker: PickerClass;

let moduleHarness: Awaited<ReturnType<typeof createModuleHarness>>;
after(async () => { await moduleHarness?.cleanup(); });

before(async () => {
  const harness = moduleHarness = await createModuleHarness(
    Object.fromEntries(MODULES.map((name) => [name, new URL(name, import.meta.url)])),
    () => Object.fromEntries([
      ["@earendil-works/pi-tui", PI_TUI_STUB],
      ["@earendil-works/pi-coding-agent", SDK_STUB],
    ].map(([name, body]) => [name, {
      "package.json": JSON.stringify({ name, type: "module", main: "index.js", exports: { ".": "./index.js" } }),
      "index.js": body,
    }])),
  );
  dir = harness.directory;
  ModelPicker = (await moduleHarness.importModule("picker.ts")).ModelPicker as PickerClass;
});

const THEME = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const TITLE = pickerTitle("host", { kind: "listing" }, 3, 1);
const CANDIDATES: readonly Candidate[] = [
  { id: "beta", score: 41.8 },
  { id: "alpha", score: 39.5 },
  { id: "gamma" },
];

const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

interface Harness {
  readonly picker: Component;
  readonly state: { outcome?: PickerOutcome };
  readonly text: () => string;
}

function open(candidates: readonly Candidate[] = CANDIDATES): Harness {
  const state: { outcome?: PickerOutcome } = {};
  const picker = new ModelPicker({ title: TITLE, hint: pickerHint(), candidates }, THEME, (outcome) => {
    state.outcome = outcome;
  });
  return { picker, state, text: () => picker.render(80).join("\n") };
}

test("draws the title, the hint and a row per candidate", () => {
  const { picker, text } = open();
  assert.match(text(), /add — host lists 3 to add \(1 already in model_list\)/);
  assert.match(text(), /space mark · enter add · esc cancel · type to filter/);
  assert.match(text(), /→ ☐ beta\s+AAII 41\.8/);
  assert.match(text(), /☐ alpha\s+AAII 39\.5/);
  assert.match(text(), /☐ gamma\s+no AAII score/);
  assert.equal(picker.markedCount, 0);
  assert.doesNotMatch(text(), /marked/, "nothing marked, nothing to report");
});

test("typing narrows the list without touching the marks", () => {
  const { picker, text } = open();
  picker.handleInput(" ");
  assert.match(text(), /☑ 1 marked/);
  assert.match(text(), /☑ beta/);

  picker.handleInput("g");
  assert.doesNotMatch(text(), /beta/, "the filter hides what it does not match");
  assert.match(text(), /☐ gamma/);
  assert.match(text(), /☑ 1 marked/);
  assert.equal(picker.markedCount, 1, "a hidden mark is still marked");

  picker.handleInput("\x7f");
  assert.match(text(), /☑ beta/, "clearing the filter brings the mark back");
});

test("space marks the row under the cursor, and unmarks it again", () => {
  const { picker, text } = open();
  picker.handleInput(DOWN);
  picker.handleInput(" ");
  assert.match(text(), /→ ☑ alpha/);
  assert.equal(picker.markedCount, 1);

  picker.handleInput(" ");
  assert.equal(picker.markedCount, 0);
  assert.match(text(), /→ ☐ alpha/);
  assert.doesNotMatch(text(), /marked/);
});

test("enter with nothing marked adds the row under the cursor", () => {
  const { picker, state } = open([{ id: "beta", score: 41.8 }, { id: "alpha", score: 39.5 }]);
  picker.handleInput(DOWN);
  picker.handleInput(ENTER);
  assert.deepEqual(state.outcome, [{ id: "alpha", score: 39.5 }]);
});

test("enter with marks adds them in the list's order, not the order they were pressed", () => {
  const { picker, state } = open();
  picker.handleInput(DOWN);
  picker.handleInput(DOWN);
  picker.handleInput(" "); // gamma
  picker.handleInput(DOWN); // wraps to the top
  picker.handleInput(" "); // beta, marked after gamma
  assert.equal(picker.markedCount, 2);

  picker.handleInput(ENTER);
  assert.deepEqual(state.outcome, [{ id: "beta", score: 41.8 }, { id: "gamma" }]);
});

test("enter adds a mark that the filter is currently hiding", () => {
  const { picker, state } = open();
  picker.handleInput(" "); // mark beta
  picker.handleInput("gamma"); // filter the list down to gamma
  picker.handleInput(ENTER);
  assert.deepEqual(state.outcome, [{ id: "beta", score: 41.8 }]);
});

test("escape adds nothing", () => {
  const { picker, state } = open();
  picker.handleInput(" ");
  picker.handleInput(ESC);
  assert.equal(state.outcome, null);
});

test("enter with an empty list does nothing", () => {
  const { picker, state } = open();
  picker.handleInput("zzz");
  picker.handleInput(ENTER);
  assert.equal(state.outcome, undefined);
  assert.equal(picker.markedCount, 0);
});


test("add score lookup propagates corrupt scores and uses the module-relative default", async (t) => {
  const envKeys = ["PI_CODING_FALLBACK_CONFIG", "PI_CODING_FALLBACK_SCORES", "PI_CODING_FALLBACK_FREE_REFRESH"];
  const saved = envKeys.map((key) => [key, process.env[key]] as const);
  t.after(() => { for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const config = join(dir, "command-fixture.yaml");
  const original = "model_list:\n- model_name: code-1-nvidia-base\n  litellm_params:\n    model: openai/base\n    api_base: https://integrate.api.nvidia.com/v1\n";
  await writeFile(config, original);
  process.env.PI_CODING_FALLBACK_CONFIG = config;
  process.env.PI_CODING_FALLBACK_FREE_REFRESH = "off";
  delete process.env.PI_CODING_FALLBACK_SCORES;
  await writeFile(join(dir, "aaii-scores.json"), '{"scores":{"new-model":{"score":87}}}');
  const register = (await moduleHarness.importModule("index.ts")).default;
  let command: (args: string, ctx: object) => Promise<void>;
  register({ registerCommand: (_name: string, definition: { handler: typeof command }) => { command = definition.handler; }, on: () => {} });
  let confirmation = "";
  const ctx = { hasUI: true, ui: { confirm: async (_title: string, text: string) => { confirmation = text; return false; }, notify: () => {} } };
  await command!("add new-model nvidia", ctx);
  assert.match(confirmation, /AAII 87/);
  await writeFile(join(dir, "aaii-scores.json"), "{broken");
  await assert.rejects(command!("add new-model nvidia", ctx), /invalid scores.*aaii-scores.json/);
  assert.equal(await readFile(config, "utf8"), original);
});
