/**
 * The fallback editor's draft is independent of the terminal and persistence.
 * Keeping the original candidate order lets unpin and reset return to score
 * order without asking the registry for another snapshot while editing.
 */
import type { Candidate } from "./candidates.ts";
import { applyChainSettings } from "./chain-order.ts";
import type { Settings } from "./settings.ts";

export interface EditorRow {
  readonly label: string;
  readonly score: number | undefined;
  readonly pinned: boolean;
  readonly excluded: boolean;
  readonly missing: boolean;
}

export interface EditorState {
  readonly rows: readonly EditorRow[];
  /** Selected row index; 0 when rows is empty. */
  readonly cursor: number;
  readonly armed: boolean;
  readonly dirty: boolean;
  readonly message?: string;
}

export type EditorKey =
  | "up" | "down"
  | "moveUp" | "moveDown"
  | "pin" | "exclude" | "delete" | "reset" | "save" | "cancel" | "other";

// Draft metadata travels with immutable states, so the reducer has no hidden
// mutable storage and independent editors cannot affect one another.
const ORIGINAL_ORDER = Symbol("original candidate order");
type Draft = EditorState & { readonly [ORIGINAL_ORDER]: readonly string[] };
const DISCARD = "press q again to discard";

function orderedRows(rows: readonly EditorRow[], original: readonly string[]): EditorRow[] {
  // Restore the router's input snapshot before applying the shared chain rule.
  // Rows absent from that snapshot are retained for missing pins/exclusions.
  const byLabel = new Map(rows.map((row) => [row.label, row]));
  const byOriginal: EditorRow[] = [];
  for (const label of original) {
    const row = byLabel.get(label);
    if (row) byOriginal.push(row);
    byLabel.delete(label);
  }
  byOriginal.push(...byLabel.values());
  const pinnedModels = rows.filter((row) => row.pinned).map((row) => row.label);
  const excludedModels = rows.filter((row) => row.excluded).map((row) => row.label);
  const active = applyChainSettings(byOriginal, {
    pinnedModels,
    excludedModels,
  });
  const excluded = byOriginal.filter((row) => row.excluded);
  return [...active, ...excluded];
}

export function initialEditorState(candidates: readonly Candidate[], settings: Settings): EditorState {
  const byLabel = new Map(candidates.map((candidate) => [candidate.label, candidate]));
  const pins = new Set(settings.pinnedModels);
  const excluded = new Set(settings.excludedModels);
  const labels = [...new Set([...settings.pinnedModels, ...byLabel.keys(), ...settings.excludedModels])];
  const rows = labels.map((label): EditorRow => ({
    label,
    score: byLabel.get(label)?.score,
    pinned: pins.has(label),
    excluded: excluded.has(label),
    missing: pins.has(label) && !byLabel.has(label),
  }));
  const original = [...byLabel.keys()];
  const state: Draft = {
    rows: orderedRows(rows, original), cursor: 0, armed: false, dirty: false,
    [ORIGINAL_ORDER]: original,
  };
  return state;
}

export function reduceEditor(
  state: EditorState,
  key: EditorKey,
): { readonly state: EditorState; readonly effect?: "save" | "close" } {
  const draft = state as Draft;
  const original = draft[ORIGINAL_ORDER];
  const clean: Draft = { ...draft, armed: false, message: undefined };
  const row = state.rows[state.cursor];
  const changed = (rows: readonly EditorRow[], label = row?.label) => {
    const current = new Set(original);
    const normalized = rows
      .filter((entry) => current.has(entry.label) || entry.pinned || entry.excluded)
      .map((entry) => ({ ...entry, missing: entry.pinned && !current.has(entry.label) }));
    const ordered = orderedRows(normalized, original);
    const selected = ordered.findIndex((entry) => entry.label === label);
    const cursor = ordered.length === 0 ? 0 : selected >= 0 ? selected : Math.max(0, Math.min(state.cursor, ordered.length - 1));
    return { state: { ...clean, rows: ordered, cursor, dirty: true } };
  };

  switch (key) {
    case "save":
      return { state: clean, effect: "save" };
    case "cancel":
      if (!state.dirty || (state.armed && state.message === DISCARD)) return { state: clean, effect: "close" };
      return { state: { ...clean, armed: true, message: DISCARD } };
    case "up":
    case "down":
      return { state: { ...clean, cursor: Math.max(0, Math.min(state.cursor + (key === "up" ? -1 : 1), state.rows.length - 1)) } };
    case "moveUp":
    case "moveDown": {
      const to = state.cursor + (key === "moveUp" ? -1 : 1);
      if (!row || row.excluded || to < 0 || to >= state.rows.length || state.rows[to].excluded) return { state: clean };
      const rows = [...state.rows];
      [rows[state.cursor], rows[to]] = [rows[to], rows[state.cursor]];
      return changed(rows.map((entry, index) => index <= to ? { ...entry, pinned: true } : entry));
    }
    case "pin":
      if (!row) return { state: clean };
      if (row.missing) return { state: { ...clean, message: `press d twice to drop the missing pin ${row.label}` } };
      return changed(state.rows.map((entry) => entry === row ? { ...entry, pinned: !entry.pinned } : entry));
    case "exclude":
      if (!row) return { state: clean };
      return changed(state.rows.map((entry) => entry === row ? { ...entry, excluded: !entry.excluded } : entry));
    case "delete":
      if (!row) return { state: clean };
      if (!row.pinned && !row.missing) return { state: { ...clean, message: `no pin on ${row.label}` } };
      if (!state.armed || state.message === DISCARD) {
        return { state: { ...clean, armed: true, message: `press d again to remove the pin on ${row.label}` } };
      }
      return changed(row.missing
        ? state.rows.filter((entry) => entry !== row)
        : state.rows.map((entry) => entry === row ? { ...entry, pinned: false } : entry));
    case "reset":
      return changed(state.rows.filter((entry) => original.includes(entry.label)).map((entry) => ({ ...entry, pinned: false, excluded: false, missing: false })));
    default:
      return { state: clean };
  }
}

export function editorSettings(state: EditorState, settings: Settings): Settings {
  const excluded = new Set(state.rows.filter((row) => row.excluded).map((row) => row.label));
  return {
    ...settings,
    pinnedModels: state.rows.filter((row) => row.pinned).map((row) => row.label),
    excludedModels: [...settings.excludedModels.filter((label) => excluded.has(label)), ...[...excluded].filter((label) => !settings.excludedModels.includes(label))],
  };
}

export function pipelinePreview(state: EditorState, width: number): string {
  const eligible = state.rows.filter((row) => !row.missing);
  const pinnedModels = state.rows.filter((row) => row.pinned).map((row) => row.label);
  const excludedModels = state.rows.filter((row) => row.excluded).map((row) => row.label);
  const active = applyChainSettings(eligible, { pinnedModels, excludedModels });
  const text = active.map((c) => c.label).join(" → ");
  const limit = Math.max(0, Math.floor(width));
  const chars = [...text];
  if (chars.length <= limit) return text;
  if (limit === 0) return "";
  if (limit === 1) return "…";
  return `${chars.slice(0, limit - 1).join("").trimEnd()}…`;
}
