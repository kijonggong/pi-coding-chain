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
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
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

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES = ["picker.ts", "catalog.ts", "chain.ts", "free-models.ts", "register.ts", "providers.ts", "scores.ts"];

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

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "coding-fallback-picker-"));
  for (const name of MODULES) await copyFile(join(HERE, name), join(dir, name));

  const packages = [
    ["@earendil-works/pi-tui", PI_TUI_STUB],
    ["@earendil-works/pi-coding-agent", SDK_STUB],
  ] as const;
  for (const [pkg, body] of packages) {
    const root = join(dir, "node_modules", pkg);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: pkg, type: "module", main: "index.js", exports: { ".": "./index.js" } }),
      "utf8",
    );
    await writeFile(join(root, "index.js"), body, "utf8");
  }

  const loaded = await import(pathToFileURL(join(dir, "picker.ts")).href);
  ModelPicker = loaded.ModelPicker as PickerClass;
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const THEME = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const TITLE = pickerTitle("host", { kind: "listing" }, 3, 1);
const CANDIDATES: readonly Candidate[] = [
  { id: "beta", score: 41.8, router: "nvidia" },
  { id: "alpha", score: 39.5, router: "nvidia" },
  { id: "gamma", router: "explabs·nvidia" },
];

const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

interface Harness {
  readonly picker: Component;
  readonly state: { outcome?: PickerOutcome };
  readonly text: () => string;
}

/**
 * Render and insist that every element is a line of text. The TUI paints each
 * element with `String.replace`, so a nested array (a child's `render` result
 * spread nowhere) crashes the session rather than showing a wrong row — which
 * is how a missing `...` reached a user's terminal once.
 */
function linesOf(picker: Component, width = 80): string[] {
  const lines = picker.render(width);
  lines.forEach((line, index) => {
    assert.equal(typeof line, "string", `line ${index} is not a string: ${JSON.stringify(line)?.slice(0, 80)}`);
  });
  return lines;
}

function open(candidates: readonly Candidate[] = CANDIDATES): Harness {
  const state: { outcome?: PickerOutcome } = {};
  const picker = new ModelPicker({ title: TITLE, hint: pickerHint(), candidates }, THEME, (outcome) => {
    state.outcome = outcome;
  });
  return { picker, state, text: () => linesOf(picker).join("\n") };
}

test("every rendered line is a string, whatever the state", () => {
  const { picker } = open();

  assert.ok(linesOf(picker).length > 3, "the title, the filter, the rows and the hint are drawn");
  assert.ok(linesOf(picker, 20).every((line) => typeof line === "string"), "a narrow window too");

  picker.handleInput(" ");
  assert.ok(linesOf(picker).some((line) => line.includes("1 marked")), "the marked line is drawn");

  picker.handleInput("zzz");
  linesOf(picker);

  picker.handleInput("\x7f\x7f\x7f");
  picker.handleInput(DOWN);
  linesOf(picker);
});

test("draws the title, the hint and a row per candidate, with its router", () => {
  const { picker, text } = open();
  assert.match(text(), /add — host lists 3 to add \(1 already in model_list\)/);
  assert.match(text(), /space mark · enter add · esc cancel · type to filter/);
  assert.match(text(), /→ ☐ nvidia\/beta\s+AAII 41\.8/);
  assert.match(text(), /☐ nvidia\/alpha\s+AAII 39\.5/);
  assert.match(text(), /☐ explabs·nvidia\/gamma\s+no AAII score/);
  assert.equal(picker.markedCount, 0);
  assert.doesNotMatch(text(), /marked/, "nothing marked, nothing to report");
});

test("two ids that differ only by a path prefix read as two different rows", () => {
  const { picker, text } = open([
    { id: "z-ai/glm-5.3-flash", score: 41.8, router: "zai" },
    { id: "glm-5.3-flash", score: 41.8, router: "zai" },
  ]);
  assert.match(text(), /☐ zai\/z-ai\/glm-5\.3-flash/);
  assert.match(text(), /☐ zai\/glm-5\.3-flash/);
  assert.notEqual(
    linesOf(picker).filter((line) => line.includes("glm-5.3-flash")).length,
    1,
    "the pair is two rows, not one",
  );
});

test("typing narrows the list without touching the marks", () => {
  const { picker, text } = open();
  picker.handleInput(" ");
  assert.match(text(), /☑ 1 marked/);
  assert.match(text(), /☑ nvidia\/beta/);

  picker.handleInput("g");
  assert.doesNotMatch(text(), /beta/, "the filter hides what it does not match");
  assert.match(text(), /☐ explabs·nvidia\/gamma/);
  assert.match(text(), /☑ 1 marked/);
  assert.equal(picker.markedCount, 1, "a hidden mark is still marked");

  picker.handleInput("\x7f");
  assert.match(text(), /☑ nvidia\/beta/, "clearing the filter brings the mark back");
});

test("space marks the row under the cursor, and unmarks it again", () => {
  const { picker, text } = open();
  picker.handleInput(DOWN);
  picker.handleInput(" ");
  assert.match(text(), /→ ☑ nvidia\/alpha/);
  assert.equal(picker.markedCount, 1);

  picker.handleInput(" ");
  assert.equal(picker.markedCount, 0);
  assert.match(text(), /→ ☐ nvidia\/alpha/);
  assert.doesNotMatch(text(), /marked/);
});

test("enter with nothing marked adds the row under the cursor", () => {
  const { picker, state } = open([
    { id: "beta", score: 41.8, router: "nvidia" },
    { id: "alpha", score: 39.5, router: "nvidia" },
  ]);
  picker.handleInput(DOWN);
  picker.handleInput(ENTER);
  assert.deepEqual(state.outcome, [{ id: "alpha", score: 39.5, router: "nvidia" }]);
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
  assert.deepEqual(state.outcome, [
    { id: "beta", score: 41.8, router: "nvidia" },
    { id: "gamma", router: "explabs·nvidia" },
  ]);
});

test("enter adds a mark that the filter is currently hiding", () => {
  const { picker, state } = open();
  picker.handleInput(" "); // mark beta
  picker.handleInput("gamma"); // filter the list down to gamma
  picker.handleInput(ENTER);
  assert.deepEqual(state.outcome, [{ id: "beta", score: 41.8, router: "nvidia" }]);
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
