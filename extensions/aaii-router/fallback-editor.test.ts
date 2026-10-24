import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candidate } from "./candidates.ts";
import { editorSettings, initialEditorState, pipelinePreview, reduceEditor } from "./fallback-editor.ts";
import type { EditorKey, EditorState } from "./fallback-editor.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

const candidates: readonly Candidate[] = ["a", "b", "c"].map((id, index) => ({
  label: `p/${id}`, provider: "p", id, score: 100 - index, tier: 0, supportsImages: false,
}));
const labels = (state: EditorState) => state.rows.map((row) => row.label);
const press = (state: EditorState, ...keys: EditorKey[]) => keys.reduce((draft, key) => reduceEditor(draft, key).state, state);

test("initial rows put pins first, retain missing pins, and move excluded rows last", () => {
  const state = initialEditorState(candidates, { ...DEFAULT_SETTINGS, pinnedModels: ["p/c", "gone/model"], excludedModels: ["p/a"] });
  assert.deepEqual(labels(state), ["p/c", "gone/model", "p/b", "p/a"]);
  assert.equal(state.rows[1].missing, true);
  assert.equal(state.rows[1].score, undefined);
  assert.equal(state.rows[0].score, 98);
  assert.equal(state.rows[3].excluded, true);
  assert.equal(state.dirty, false);
  assert.equal(state.armed, false);
  assert.equal(state.cursor, 0);
});

test("initial rows remain stable through nested editorSettings with overlapping labels", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    pinnedModels: ["p/c", "gone/model", "p/a"],
    excludedModels: ["p/c", "gone/model", "absent/excluded"],
  };
  const initial = initialEditorState(candidates, settings);
  const nested = initialEditorState(candidates, editorSettings(initialEditorState(candidates, settings), settings));
  assert.deepEqual(nested.rows, initial.rows);
  assert.equal(new Set(nested.rows.map((row) => row.label)).size, nested.rows.length);
  assert.ok(nested.rows.some((row) => row.pinned && row.excluded && !row.missing));
  assert.ok(nested.rows.some((row) => row.pinned && row.excluded && row.missing));
});

test("navigation clamps and J/K reorder while pinning every row needed to preserve the order", () => {
  const initial = initialEditorState(candidates, DEFAULT_SETTINGS);
  const moved = press(initial, "down", "moveDown");
  assert.deepEqual(labels(moved), ["p/a", "p/c", "p/b"]);
  assert.deepEqual(moved.rows.map((row) => row.pinned), [true, true, true]);
  assert.equal(moved.cursor, 2);
  assert.equal(moved.dirty, true);
  const up = press(moved, "moveUp");
  assert.deepEqual(labels(up), ["p/a", "p/b", "p/c"]);
  assert.equal(up.cursor, 1);
  const freshUp = press(initial, "down", "down", "moveUp");
  assert.deepEqual(labels(freshUp), ["p/a", "p/c", "p/b"]);
  assert.deepEqual(freshUp.rows.map((row) => row.pinned), [true, true, false]);
  assert.equal(press(initial, "up", "moveUp").dirty, false);
  assert.equal(press(initial, "down", "down", "down").cursor, 2);
  assert.equal(press(initial, "down", "down", "moveDown").dirty, false);
  assert.deepEqual(labels(initial), ["p/a", "p/b", "p/c"], "the reducer does not mutate its input");
});

test("pin toggles keep effective order and unpin returns a row to the original score order", () => {
  const state = initialEditorState(candidates, DEFAULT_SETTINGS);
  const pinned = press(state, "down", "pin");
  assert.deepEqual(labels(pinned), ["p/b", "p/a", "p/c"]);
  assert.equal(pinned.cursor, 0);
  assert.deepEqual(labels(press(pinned, "pin")), ["p/a", "p/b", "p/c"]);
});

test("rows and preview follow pin order and restore original rank after unpin and inclusion", () => {
  const initial = initialEditorState(candidates, {
    ...DEFAULT_SETTINGS,
    pinnedModels: ["p/c", "p/b"],
    excludedModels: ["p/b", "p/a"],
  });
  assert.deepEqual(labels(initial), ["p/c", "p/a", "p/b"]);
  assert.equal(pipelinePreview(initial, 100), "p/c");
  const included = press(initial, "down", "down", "exclude");
  assert.deepEqual(labels(included), ["p/c", "p/b", "p/a"]);
  assert.equal(pipelinePreview(included, 100), "p/c → p/b");
  const unpinned = press(included, "up", "pin");
  assert.deepEqual(labels(unpinned), ["p/b", "p/c", "p/a"]);
  assert.equal(pipelinePreview(unpinned, 100), "p/b → p/c");
});

test("delete requires two taps, removes missing rows, and other keys disarm it", () => {
  const state = initialEditorState(candidates, { ...DEFAULT_SETTINGS, pinnedModels: ["gone/model", "p/c"] });
  const armed = press(state, "delete");
  assert.equal(armed.armed, true);
  assert.match(armed.message ?? "", /press d again/);
  assert.equal(armed.dirty, false);
  const interrupted = press(armed, "other", "delete");
  assert.equal(interrupted.rows.length, 4);
  assert.equal(interrupted.armed, true);
  const deleted = press(interrupted, "delete");
  assert.deepEqual(labels(deleted), ["p/c", "p/a", "p/b"]);
  assert.equal(deleted.armed, false);
  assert.equal(deleted.dirty, true);
  const unpinned = press(deleted, "delete", "delete");
  assert.deepEqual(labels(unpinned), ["p/a", "p/b", "p/c"]);
  assert.equal(unpinned.rows.find((row) => row.label === "p/c")?.pinned, false);
  assert.equal(press(armed, "down").armed, false);
});

test("exclude moves a row to the end, can be toggled back, and blocks reordering across the boundary", () => {
  const state = initialEditorState(candidates, DEFAULT_SETTINGS);
  const excluded = press(state, "exclude");
  assert.deepEqual(labels(excluded), ["p/b", "p/c", "p/a"]);
  assert.equal(excluded.cursor, 2);
  assert.equal(excluded.rows[2].excluded, true);
  assert.deepEqual(labels(press(excluded, "moveUp")), labels(excluded));
  assert.deepEqual(labels(press(excluded, "up", "moveDown")), labels(excluded));
  assert.deepEqual(labels(press(excluded, "exclude")), ["p/a", "p/b", "p/c"]);
});

test("dirty cancel requires consecutive cancel taps and cannot confirm delete", () => {
  const state = press(initialEditorState(candidates, DEFAULT_SETTINGS), "pin");
  const first = reduceEditor(state, "cancel");
  assert.equal(first.effect, undefined);
  assert.equal(first.state.armed, true);
  assert.match(first.state.message ?? "", /press q again to discard/);
  assert.equal(reduceEditor(first.state, "cancel").effect, "close");
  const interrupted = press(first.state, "other");
  assert.equal(interrupted.armed, false);
  assert.equal(reduceEditor(interrupted, "cancel").effect, undefined);
  assert.equal(press(first.state, "delete").rows[0].pinned, true);
  assert.equal(reduceEditor(press(state, "delete"), "cancel").effect, undefined);
  assert.equal(reduceEditor(initialEditorState(candidates, DEFAULT_SETTINGS), "cancel").effect, "close");
});

test("editorSettings writes the draft and reset clears pins and exclusions in score order", () => {
  const settings = { ...DEFAULT_SETTINGS, cooldownMs: 1234, pinnedModels: ["p/c", "gone/model"], excludedModels: ["p/b", "absent/excluded"] };
  const initial = initialEditorState(candidates, settings);
  assert.deepEqual(editorSettings(initial, settings), settings);
  const reset = press(initial, "reset");
  assert.deepEqual(labels(reset), ["p/a", "p/b", "p/c"]);
  assert.equal(reset.dirty, true);
  assert.deepEqual(editorSettings(reset, settings), { ...settings, pinnedModels: [], excludedModels: [] });
  assert.equal(reduceEditor(reset, "save").effect, "save");
  assert.deepEqual(settings.pinnedModels, ["p/c", "gone/model"]);
});

test("pipelinePreview omits excluded rows and truncates to the requested width", () => {
  const state = initialEditorState(candidates, { ...DEFAULT_SETTINGS, excludedModels: ["p/b"] });
  assert.equal(pipelinePreview(state, 100), "p/a → p/c");
  assert.equal(pipelinePreview(state, 9), "p/a → p/c");
  assert.equal(pipelinePreview(state, 7), "p/a →…");
  assert.equal(pipelinePreview(state, 1), "…");
  assert.equal(pipelinePreview(state, 0), "");
  assert.equal(pipelinePreview(state, -1), "");
  for (let width = 0; width < 12; width++) assert.ok([...pipelinePreview(state, width)].length <= width);
});

test("empty editors support navigation, edits, reset, preview and save", () => {
  const state = initialEditorState([], DEFAULT_SETTINGS);
  const edited = press(state, "up", "down", "moveUp", "moveDown", "pin", "exclude", "delete");
  assert.equal(edited.cursor, 0);
  assert.equal(edited.dirty, false);
  assert.equal(pipelinePreview(edited, 20), "");
  assert.deepEqual(editorSettings(edited, DEFAULT_SETTINGS), DEFAULT_SETTINGS);
  assert.equal(press(edited, "reset").dirty, true);
});

test("pinning absent exclusions and reordering recompute missing, and delete leaves no ghost", () => {
  const initial = initialEditorState(candidates, { ...DEFAULT_SETTINGS, excludedModels: ["gone/model"] });
  const selected = press(initial, "down", "down", "down");
  const pinned = press(selected, "pin");
  assert.equal(pinned.rows[pinned.cursor].missing, true);
  const included = press(pinned, "exclude");
  assert.equal(included.rows[included.cursor].missing, true);
  assert.deepEqual(labels(press(included, "delete", "delete")), ["p/a", "p/b", "p/c"]);

  assert.deepEqual(labels(press(selected, "exclude")), ["p/a", "p/b", "p/c"]);
  const moved = press(included, "moveDown");
  assert.equal(moved.rows[moved.cursor].label, "gone/model");
  assert.equal(moved.rows[moved.cursor].missing, true);
  const reset = press(moved, "reset");
  assert.ok(reset.rows.every((row) => !row.missing));
  assert.deepEqual(labels(reset), ["p/a", "p/b", "p/c"]);
});

test("pipelinePreview skips missing pins as the request chain does", () => {
  const state = initialEditorState(candidates, { ...DEFAULT_SETTINGS, pinnedModels: ["gone/model", "p/c"] });
  assert.equal(pipelinePreview(state, 100), "p/c → p/a → p/b");
  assert.equal(pipelinePreview(initialEditorState([], { ...DEFAULT_SETTINGS, pinnedModels: ["gone/model"] }), 100), "");
});

test("delete on an unpinned row stays clean and never arms", () => {
  const initial = initialEditorState(candidates, DEFAULT_SETTINGS);
  for (const state of [initial, press(initial, "exclude")]) {
    const deleted = press(state, "delete");
    assert.equal(deleted.armed, false);
    assert.equal(deleted.message, `no pin on ${state.rows[state.cursor].label}`);
    assert.equal(deleted.dirty, state.dirty);
    assert.deepEqual(deleted.rows, state.rows);
    assert.equal(press(deleted, "delete").armed, false);
  }
});

test("removing the last missing pin leaves cursor at the empty-editor sentinel", () => {
  const initial = initialEditorState([], { ...DEFAULT_SETTINGS, pinnedModels: ["gone/model"] });
  for (const state of [press(initial, "delete", "delete"), press(initial, "reset")]) {
    assert.deepEqual(state.rows, []);
    assert.equal(state.cursor, 0);
    assert.equal(press(state, "up", "down").cursor, 0);
    assert.equal(reduceEditor(state, "save").effect, "save");
  }
});

test("editorSettings retains existing exclusion order and appends new exclusions", () => {
  const settings = { ...DEFAULT_SETTINGS, excludedModels: ["gone/model", "p/c", "p/a"] };
  const initial = initialEditorState(candidates, settings);
  assert.deepEqual(editorSettings(initial, settings).excludedModels, settings.excludedModels);
  const edited = press(initial, "exclude");
  assert.deepEqual(editorSettings(edited, settings).excludedModels, ["gone/model", "p/c", "p/a", "p/b"]);
  const removed = press(edited, "down", "exclude");
  assert.deepEqual(editorSettings(removed, settings).excludedModels, ["gone/model", "p/a", "p/b"]);
});

test("pin on a missing row explains double-delete without changing the draft", () => {
  const initial = initialEditorState(candidates, { ...DEFAULT_SETTINGS, pinnedModels: ["gone/model"] });
  for (const state of [initial, press(initial, "delete")]) {
    const pinned = press(state, "pin");
    assert.deepEqual(pinned.rows, state.rows);
    assert.equal(pinned.dirty, state.dirty);
    assert.equal(pinned.cursor, state.cursor);
    assert.equal(pinned.armed, false);
    assert.equal(pinned.message, "press d twice to drop the missing pin gone/model");
    assert.equal(press(pinned, "delete").rows.length, 4);
    assert.deepEqual(labels(press(pinned, "delete", "delete")), ["p/a", "p/b", "p/c"]);
  }
});


