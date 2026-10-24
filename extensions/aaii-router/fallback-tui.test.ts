/**
 * Tests for the fallback chain editor component.
 *
 * Run with:
 *   node --test extensions/aaii-router/fallback-tui.test.ts
 *
 * The component imports the Pi SDK, which plain `node --test` has no way to
 * resolve directly from the workspace root. Following `picker.test.ts`, this
 * test sets up a lightweight test harness with stub packages for
 * `@earendil-works/pi-tui` and `@earendil-works/pi-coding-agent`. Literal key
 * sequences model this external boundary only; SDK protocol parsing is not
 * under test.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createModuleHarness } from "../../test-support/module-harness.ts";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Candidate } from "./candidates.ts";
import type { FallbackEditor as FallbackEditorType, FallbackEditorOptions, FallbackOutcome } from "./fallback-tui.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { sdkStubPackages } from "./test-support.ts";

const MODULES = [
  "fallback-tui.ts",
  "fallback-editor.ts",
  "chain-order.ts",
  "candidates.ts",
  "settings.ts",
];

let FallbackEditor: typeof FallbackEditorType;
let setCustomCancelBinding: (key?: string) => void;

let moduleHarness: Awaited<ReturnType<typeof createModuleHarness>>;
after(async () => { await moduleHarness?.cleanup(); });

before(async () => {
  const harness = moduleHarness = await createModuleHarness(
    Object.fromEntries(MODULES.map((name) => [name, new URL(name, import.meta.url)])),
    sdkStubPackages,
  );
  const tuiStub = await harness.importModule("node_modules/@earendil-works/pi-tui/index.js");
  setCustomCancelBinding = tuiStub.setCustomCancelBinding;
  FallbackEditor = (await harness.importModule("fallback-tui.ts")).FallbackEditor;
});

/** The theme as far as this component is concerned: colors are decoration. */
const THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const PATH = "/tmp/aaii-router.json";

const CANDIDATES: readonly Candidate[] = [
  { label: "openrouter/alpha", provider: "openrouter", id: "alpha", score: 41.8, tier: 1, supportsImages: true },
  { label: "commandcode/beta", provider: "commandcode", id: "beta", score: 39.5, tier: 2, supportsImages: false },
  { label: "dashscope/gamma", provider: "dashscope", id: "gamma", score: undefined, tier: 99, supportsImages: false },
];

const DOWN = "\x1b[B";
const UP = "\x1b[A";
const ENTER = "\r";
const ESC = "\x1b";

interface Harness {
  readonly editor: FallbackEditorType;
  /** `resolved` is separate from the value: cancelling resolves with `undefined`. */
  readonly outcome: { resolved: boolean; settings: FallbackOutcome };
  readonly text: (width?: number) => string;
  readonly lines: (width?: number) => string[];
}

function open(
  settings: Settings = DEFAULT_SETTINGS,
  candidates: readonly Candidate[] = CANDIDATES,
  options?: Partial<FallbackEditorOptions>,
): Harness {
  const outcome: { resolved: boolean; settings: FallbackOutcome } = { resolved: false, settings: undefined };
  const editor = new FallbackEditor(
    { candidates, settings, path: PATH, ...options },
    THEME,
    (value) => {
      outcome.resolved = true;
      outcome.settings = value;
    },
  );
  return {
    editor,
    outcome,
    lines: (width = 80) => editor.render(width),
    text: (width = 80) => editor.render(width).join("\n"),
  };
}

test("draws the header, the chain preview, a row per candidate and the key hints", () => {
  const { outcome, text } = open();
  const drawn = text();

  assert.match(drawn, /aaii-router fallback — \/tmp\/aaii-router\.json/);
  assert.match(drawn, /openrouter\/alpha → commandcode\/beta → dashscope\/gamma/);
  assert.match(drawn, /openrouter\/alpha.*AAII 41\.8/);
  assert.match(drawn, /commandcode\/beta.*AAII 39\.5/);
  assert.match(drawn, /dashscope\/gamma.*no AAII score/, "an unranked candidate says so");
  assert.match(drawn, /s save/, "the footer carries the save action");
  assert.match(drawn, /q cancel/, "the footer carries the cancel action");
  assert.doesNotMatch(drawn, /pinned|excluded|missing/, "nothing is tagged until a key says so");
  assert.equal(outcome.resolved, false, "opening the editor does not resolve it");
});

test("j/k and the arrows move the cursor without changing the draft", () => {
  const { editor, outcome, text } = open();

  editor.handleInput(DOWN);
  assert.match(text(), /▸ 2.*commandcode\/beta/);
  assert.doesNotMatch(text(), /▸ 1.*openrouter\/alpha/, "the cursor left the first row");

  editor.handleInput("j");
  assert.match(text(), /▸ 3.*dashscope\/gamma/);

  editor.handleInput(UP);
  editor.handleInput(UP);
  assert.match(text(), /▸ 1.*openrouter\/alpha/);

  editor.handleInput(UP);
  assert.match(text(), /▸ 1.*openrouter\/alpha/, "the cursor stops at the top");
  assert.equal(outcome.resolved, false, "moving the cursor is not a save");
});

test("p pins the row under the cursor, and save hands the pin order back", () => {
  const { editor, outcome, text } = open();

  editor.handleInput("j");
  editor.handleInput("p");

  assert.match(text(), /commandcode\/beta.*pinned/);
  assert.match(
    text(),
    /commandcode\/beta → openrouter\/alpha → dashscope\/gamma/,
    "the preview follows the chain settings before the per-request image adjustment",
  );

  editor.handleInput("s");
  assert.equal(outcome.resolved, true);
  assert.deepEqual(outcome.settings?.pinnedModels, ["commandcode/beta"]);
  assert.deepEqual(outcome.settings?.excludedModels, []);
  assert.equal(outcome.settings?.cooldownMs, DEFAULT_SETTINGS.cooldownMs, "only the two chain lists are the editor's to write");
});

test("enter saves as well as s", () => {
  const { editor, outcome } = open();
  editor.handleInput("p");
  editor.handleInput(ENTER);
  assert.equal(outcome.resolved, true);
  assert.deepEqual(outcome.settings?.pinnedModels, ["openrouter/alpha"]);
});

test("x leaves the row out of the preview and sorts it last", () => {
  const { editor, outcome, text } = open();

  editor.handleInput("j");
  editor.handleInput("j");
  editor.handleInput("x");

  assert.match(text(), /openrouter\/alpha → commandcode\/beta/, "an excluded row is not in the preview");
  assert.match(
    text(),
    /▸ 3.*dashscope\/gamma.*excluded/,
    "the cursor follows the row it excluded, to the end of the list",
  );

  editor.handleInput("s");
  assert.deepEqual(outcome.settings?.excludedModels, ["dashscope/gamma"]);
  assert.deepEqual(outcome.settings?.pinnedModels, []);
});

test("J reorders in place and pins the rows it moved past", () => {
  const { editor, outcome, text } = open();

  editor.handleInput("J");

  assert.match(text(), /commandcode\/beta → openrouter\/alpha → dashscope\/gamma/);
  editor.handleInput("s");
  assert.deepEqual(
    outcome.settings?.pinnedModels,
    ["commandcode/beta", "openrouter/alpha"],
    "a pin is how an order is stored",
  );
});

test("d asks for a second press before it takes a pin out", () => {
  const { editor, outcome, text } = open({ ...DEFAULT_SETTINGS, pinnedModels: ["openrouter/alpha"] });
  assert.match(text(), /▸ 1.*openrouter\/alpha.*pinned/);

  editor.handleInput("d");
  assert.match(text(), /press d again to remove the pin on openrouter\/alpha/);
  assert.equal(outcome.resolved, false, "the first press only arms");

  editor.handleInput("d");
  assert.doesNotMatch(text(), /pinned/);
  assert.match(text(), /openrouter\/alpha → commandcode\/beta → dashscope\/gamma/, "unpinned, score order is back");

  editor.handleInput("s");
  assert.deepEqual(outcome.settings?.pinnedModels, []);
});

test("any other key cancels the armed delete", () => {
  const { editor, text } = open({ ...DEFAULT_SETTINGS, pinnedModels: ["openrouter/alpha"] });

  editor.handleInput("d");
  editor.handleInput("j");
  assert.doesNotMatch(text(), /press d again/, "moving the cursor disarms the delete");

  editor.handleInput("d");
  assert.match(text(), /no pin on commandcode\/beta/);
});

test("q closes a clean draft at once, and a dirty one after a second press", () => {
  const clean = open();
  clean.editor.handleInput("q");
  assert.equal(clean.outcome.resolved, true);
  assert.equal(clean.outcome.settings, undefined, "cancel writes nothing");

  const dirty = open();
  dirty.editor.handleInput("p");
  dirty.editor.handleInput(ESC);
  assert.match(dirty.text(), /press q again to discard/);
  assert.equal(dirty.outcome.resolved, false, "the first escape only warns");

  dirty.editor.handleInput("q");
  assert.equal(dirty.outcome.resolved, true);
  assert.equal(dirty.outcome.settings, undefined);
});

test("a pin that matches no candidate is shown as missing and can be dropped", () => {
  const { editor, outcome, text } = open({ ...DEFAULT_SETTINGS, pinnedModels: ["ghost/removed"] });

  assert.match(text(), /▸ 1.*ghost\/removed.*pinned.*missing/);
  assert.match(text(), /openrouter\/alpha → commandcode\/beta → dashscope\/gamma/);

  editor.handleInput("p");
  assert.match(text(), /press d twice to drop the missing pin ghost\/removed/, "p on missing row warns");

  editor.handleInput("d");
  editor.handleInput("d");
  assert.doesNotMatch(text(), /ghost\/removed/, "dropping a missing row leaves the row list");

  editor.handleInput("s");
  assert.deepEqual(outcome.settings?.pinnedModels, []);
});

test("r clears the pins and the model exclusions", () => {
  const { editor, outcome, text } = open({
    ...DEFAULT_SETTINGS,
    pinnedModels: ["commandcode/beta"],
    excludedModels: ["dashscope/gamma"],
  });
  assert.match(text(), /pinned/);
  assert.match(text(), /excluded/);

  editor.handleInput("r");
  assert.doesNotMatch(text(), /pinned|excluded/);

  editor.handleInput("s");
  assert.deepEqual(outcome.settings?.pinnedModels, []);
  assert.deepEqual(outcome.settings?.excludedModels, []);
});

test("the render is clamped to the width it is given", () => {
  const { lines } = open();
  for (const line of lines(24)) {
    assert.ok([...line].length <= 24, `line is wider than 24 columns: ${JSON.stringify(line)}`);
  }
});

test("a pinned badge survives a long label at width 16", () => {
  const { lines } = open({ ...DEFAULT_SETTINGS, pinnedModels: ["openrouter/alpha"] });
  const row = lines(16).find((line) => line.startsWith("▸ 1"));
  assert.match(row ?? "", /\[P\]/);
});

test("pending saves request a render and show saving while ignoring further keys", async () => {
  let release!: () => void;
  let attempts = 0;
  let resolved = false;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const editor = new FallbackEditor(
    {
      candidates: CANDIDATES, settings: DEFAULT_SETTINGS, path: PATH,
      onSave: () => { attempts++; return pending; },
    },
    THEME,
    () => { resolved = true; },
  );
  editor.render(80);
  editor.handleInput("s");
  const savingText = editor.render(80).join("\n");
  editor.handleInput("s");
  editor.handleInput("q");
  editor.handleInput("j");
  editor.handleInput(ESC);
  assert.equal(attempts, 1);
  assert.equal(resolved, false);
  assert.match(editor.render(80).join("\n"), /▸ 1.*openrouter\/alpha/);
  release();
  await pending;
  assert.equal(resolved, true);
  assert.match(savingText, /saving…/);
});

test("onSave failure keeps editor open with error message and prevents double-save", async () => {
  let attempts = 0;
  let shouldFail = true;
  let save!: Promise<void>;

  const harness = open(DEFAULT_SETTINGS, CANDIDATES, {
    onSave: () => save = (async () => {
      attempts++;
      if (shouldFail) {
        throw new Error("EACCES: permission denied");
      }
    })(),
  });

  harness.editor.handleInput("p");
  harness.editor.handleInput("s");

  await assert.rejects(save, /EACCES: permission denied/);

  assert.equal(harness.outcome.resolved, false, "editor must not resolve on save failure");
  assert.match(harness.text(), /save failed: EACCES: permission denied/, "shows save failure in status");
  assert.match(harness.text(), /▸ 1.*openrouter\/alpha.*pinned/, "draft is preserved");

  // Retry save after fixing failure
  shouldFail = false;
  harness.editor.handleInput("s");
  await save;

  assert.equal(harness.outcome.resolved, true, "editor resolves on successful save");
  assert.deepEqual(harness.outcome.settings?.pinnedModels, ["openrouter/alpha"]);
  assert.equal(attempts, 2, "tried save twice");
});

test("heldEnvVars displays warning on header and status line on open", () => {
  const { text } = open(DEFAULT_SETTINGS, CANDIDATES, {
    heldEnvVars: ["PI_AAII_ROUTER_PINNED"],
  });

  const drawn = text(100);
  assert.match(drawn, /\[overridden by PI_AAII_ROUTER_PINNED\]/, "header shows env override warning");
  assert.match(drawn, /warning: PI_AAII_ROUTER_PINNED override this session/, "status line shows env override warning");
});

test("below 30 columns shows compact footer and short row badges [P]/[X]/[!]", () => {
  const { text } = open({
    ...DEFAULT_SETTINGS,
    pinnedModels: ["openrouter/alpha", "ghost/missing"],
    excludedModels: ["dashscope/gamma"],
  });

  // At width 28:
  const narrowText = text(28);
  assert.match(narrowText, /s save/, "narrow footer shows save");
  assert.match(narrowText, /q cancel/, "narrow footer shows cancel");
  assert.doesNotMatch(narrowText, /↑\/↓ move/, "narrow footer omits long key hint line");

  assert.match(narrowText, /\[P\].*openrouter\/alpha/, "pinned badge precedes the label");
  assert.match(narrowText, /\[P\]\[!\].*ghost\/missing/, "missing badges precede the label");
  assert.match(narrowText, /\[X\].*dashscope\/gamma/, "excluded badge precedes the label");

  // At normal width (80):
  const normalText = text(80);
  assert.match(normalText, /openrouter\/alpha.*pinned/, "normal width uses full word tags");
  assert.match(normalText, /s save/);
  assert.match(normalText, /q cancel/);
});

test("SDK tui.select.cancel binding closes the editor for an arbitrary sequence", () => {
  const sequence = "sdk-configured-cancel";
  setCustomCancelBinding(sequence);
  try {
    const { editor, outcome } = open();
    editor.handleInput(sequence);
    assert.equal(outcome.resolved, true);
    assert.equal(outcome.settings, undefined);
  } finally {
    setCustomCancelBinding(undefined);
  }
});
