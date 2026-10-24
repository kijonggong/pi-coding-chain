/**
 * The fallback chain editor as a Pi component.
 *
 * `fallback-editor.ts` owns what a key means and what the draft looks like; this
 * file only draws that draft and hands terminal input to it. Keeping the split
 * means the ordering rules are tested without a terminal, and this component can
 * be driven with raw key sequences in a test of its own.
 *
 * It is a single vertical list on purpose. The chain is one order — pinned
 * models, then the score order, then the exclusions put aside — and a list shows
 * both the order and every row's state at once. `J`/`K` reorder in place rather
 * than opening an "edit order" mode, because the draft is not written until `s`:
 * there is an undo (`q` on a dirty draft asks once) and nothing to lose by
 * looking.
 *
 * The footer carries the keys and the draft's own status line, so an armed
 * destructive key (`d`, or `q` discarding) says what a second press would do
 * without a modal in the way. That is the double-tap rule from the reference
 * UI: a first press explains, any other key cancels, the second press acts.
 *
 * Key interpretation uses the SDK's `matchesKey` and `getKeybindings` (for
 * configured bindings, legacy escape sequences, and the Kitty keyboard protocol).
 * `StdinBuffer` in the terminal layer delivers complete key sequences without
 * custom buffering.
 */

import { matchesKey, getKeybindings, type Component } from "@earendil-works/pi-tui";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Candidate } from "./candidates.ts";
import type { EditorKey, EditorRow, EditorState } from "./fallback-editor.ts";
import { editorSettings, initialEditorState, pipelinePreview, reduceEditor } from "./fallback-editor.ts";
import type { Settings } from "./settings.ts";

/** What the editor hands back: the settings to write, or `undefined` when cancelled. */
export type FallbackOutcome = Settings | undefined;

export interface FallbackEditorOptions {
  /** The candidates as the router would order them, before pins and exclusions. */
  readonly candidates: readonly Candidate[];
  /** The settings in force: where the draft starts. */
  readonly settings: Settings;
  /** The settings file the draft would be written to, shown in the header. */
  readonly path: string;
  /** Active environment variable names overriding the chain settings. */
  readonly heldEnvVars?: readonly string[];
  /**
   * Optional asynchronous persistence hook. When supplied, the editor remains
   * open while saving. If it rejects, the error is displayed in the status line
   * and the draft is preserved. `done` is called only after `onSave` resolves.
   */
  readonly onSave?: (settings: Settings) => Promise<void>;
}

/**
 * The key lines. Two rather than one: the whole set does not fit 80 columns, and
 * a truncated footer would eat the cancel key. The draft's status line, when
 * there is one, is drawn under them.
 */
const HINT_KEYS = "↑/↓ move · J/K reorder · p pin · x exclude · d unpin";
const HINT_ACTIONS = "r reset · s save · q cancel";
const HINT_COMPACT = "s save · q cancel";

/** Drawn in place of the rows when the router has no candidate at all. */
const NO_CANDIDATES = "no candidates — none of the registered chat models has credentials, or they are all excluded";

/** One run of text in a row, with the color and weight it is drawn in. */
interface Span {
  readonly text: string;
  readonly color?: ThemeColor;
  readonly bold?: boolean;
}

/**
 * Join spans into one line no wider than `width`. Truncation happens on the
 * plain text, before a color is applied, because the escape sequences a theme
 * adds are not columns: cutting the styled string would cut a sequence in half.
 */
function draw(spans: readonly Span[], theme: Theme, width: number): string {
  let room = Math.max(0, Math.floor(width));
  let out = "";

  for (const span of spans) {
    if (room <= 0) break;
    const chars = [...span.text];
    const fits = chars.length <= room;
    const text = fits ? span.text : room > 1 ? `${chars.slice(0, room - 1).join("").trimEnd()}…` : "…";
    const styled = span.color === undefined ? text : theme.fg(span.color, text);
    out += span.bold === true ? theme.bold(styled) : styled;
    room -= fits ? chars.length : room;
  }
  return out;
}

export class FallbackEditor implements Component {
  private readonly options: FallbackEditorOptions;
  private readonly theme: Theme;
  private readonly done: (outcome: FallbackOutcome) => void;
  private readonly requestRender: (() => void) | undefined;

  private state: EditorState;
  /** Set once the completion callback ran: a second key must not resolve twice. */
  private finished = false;
  /** True while an async onSave is in flight; prevents double saves. */
  private saving = false;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    options: FallbackEditorOptions,
    theme: Theme,
    done: (outcome: FallbackOutcome) => void,
    requestRender?: () => void,
  ) {
    this.options = options;
    this.theme = theme;
    this.done = done;
    this.requestRender = requestRender;
    this.state = initialEditorState(options.candidates, options.settings);
  }

  handleInput(data: string): void {
    if (this.finished || this.saving) return;
    this.dispatchKey(this.toEditorKey(data));
  }

  private toEditorKey(data: string): EditorKey {
    const keybindings = getKeybindings();
    if (keybindings.matches(data, "tui.select.cancel") || matchesKey(data, "escape") || matchesKey(data, "q")) {
      return "cancel";
    }
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      return "up";
    }
    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      return "down";
    }
    if (matchesKey(data, "shift+up") || matchesKey(data, "shift+k")) {
      return "moveUp";
    }
    if (matchesKey(data, "shift+down") || matchesKey(data, "shift+j")) {
      return "moveDown";
    }
    if (matchesKey(data, "p")) {
      return "pin";
    }
    if (matchesKey(data, "x")) {
      return "exclude";
    }
    if (matchesKey(data, "d")) {
      return "delete";
    }
    if (matchesKey(data, "r")) {
      return "reset";
    }
    if (matchesKey(data, "s") || matchesKey(data, "enter")) {
      return "save";
    }
    return "other";
  }

  private dispatchKey(key: EditorKey): void {
    if (this.finished || this.saving) return;

    const reduced = reduceEditor(this.state, key);
    this.state = reduced.state;
    this.invalidate();

    if (reduced.effect === "save") {
      const nextSettings = editorSettings(this.state, this.options.settings);
      if (!this.options.onSave) {
        this.finish(nextSettings);
        return;
      }
      this.saving = true;
      this.requestRender?.();
      this.options.onSave(nextSettings).then(
        () => {
          this.saving = false;
          this.finish(nextSettings);
        },
        (error: unknown) => {
          this.saving = false;
          const message = error instanceof Error ? error.message : String(error);
          this.state = {
            ...this.state,
            armed: false,
            message: `save failed: ${message}`,
          };
          this.invalidate();
          this.requestRender?.();
        },
      );
      return;
    }
    if (reduced.effect === "close") {
      this.finish(undefined);
      return;
    }
    this.requestRender?.();
  }

  render(width: number): string[] {
    if (this.cachedLines !== undefined && this.cachedWidth === width) return this.cachedLines;

    const state = this.state;
    const rank = String(Math.max(1, state.rows.length)).length;
    const isNarrow = width < 30;

    const headerSpans: Span[] = [
      { text: `aaii-router fallback — ${this.options.path}`, color: "accent", bold: true },
    ];
    if (this.options.heldEnvVars && this.options.heldEnvVars.length > 0) {
      headerSpans.push({
        text: ` [overridden by ${this.options.heldEnvVars.join(", ")}]`,
        color: "warning",
        bold: true,
      });
    }

    const envWarning =
      this.options.heldEnvVars && this.options.heldEnvVars.length > 0
        ? `warning: ${this.options.heldEnvVars.join(", ")} override this session`
        : undefined;
    const activeMessage = this.saving ? "saving…" : state.message ?? envWarning;

    const footerLines = isNarrow
      ? [draw([{ text: HINT_COMPACT, color: "dim" }], this.theme, width)]
      : [
          draw([{ text: HINT_KEYS, color: "dim" }], this.theme, width),
          draw([{ text: HINT_ACTIONS, color: "dim" }], this.theme, width),
        ];

    const lines = [
      draw(headerSpans, this.theme, width),
      // The preview is the order produced by the chain settings (pins,
      // exclusions), before the per-request image adjustment.
      draw([{ text: pipelinePreview(state, width), color: "muted" }], this.theme, width),
      "",
      ...(state.rows.length === 0
        ? [draw([{ text: NO_CANDIDATES, color: "dim" }], this.theme, width)]
        : state.rows.map((row, index) => this.rowLine(row, index, rank, width))),
      "",
      ...footerLines,
      ...(activeMessage === undefined
        ? []
        : [
            draw(
              [{
                text: activeMessage,
                color: (state.armed || state.message === undefined) ? "warning" : "muted",
                bold: state.armed,
              }],
              this.theme,
              width,
            ),
          ]),
    ];

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private finish(outcome: FallbackOutcome): void {
    if (this.finished) return;
    this.finished = true;
    this.done(outcome);
  }

  private rowLine(row: EditorRow, index: number, rank: number, width: number): string {
    const cursor = index === this.state.cursor;
    const isNarrow = width < 30;

    const shortTags: string[] = [];
    if (row.pinned) shortTags.push("[P]");
    if (row.excluded) shortTags.push("[X]");
    if (row.missing) shortTags.push("[!]");

    const spans: Span[] = [
      { text: cursor ? "▸ " : "  ", color: "accent" },
      { text: `${String(index + 1).padStart(rank)}${isNarrow ? " " : "  "}`, color: "dim" },
    ];

    if (isNarrow && shortTags.length > 0) {
      spans.push({
        text: `${shortTags.join("")} `,
        color: row.missing ? "warning" : row.excluded ? "error" : "success",
        bold: true,
      });
    }

    spans.push({
      text: row.label,
      // An excluded row is out of the chain: drawing it like a live candidate
      // would say the opposite of what `x` just did.
      color: row.excluded ? "dim" : cursor ? "accent" : "text",
      bold: cursor,
    });

    spans.push({
      text: `  ${row.score === undefined ? "no AAII score" : `AAII ${row.score}`}`,
      color: "dim",
    });

    if (!isNarrow) {
      const tags: string[] = [];
      // Tags are words, not glyphs: one row can be pinned and missing, or pinned
      // and excluded at once, and both states have to stay readable side by side.
      if (row.pinned) tags.push("pinned");
      if (row.excluded) tags.push("excluded");
      if (row.missing) tags.push("missing");
      if (tags.length > 0) {
        // `missing` wins the color: a pin that matches nothing is the one tag
        // that needs the operator to do something about it.
        spans.push({
          text: `  ${tags.join(" ")}`,
          color: row.missing ? "warning" : row.excluded ? "error" : "success",
        });
      }
    }

    return draw(spans, this.theme, width);
  }
}
