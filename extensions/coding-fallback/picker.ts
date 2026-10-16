/**
 * The picker: a filterable list of what the chosen upstream serves, with space
 * to mark several models and enter to add them.
 *
 * It is built from `SelectList` and `Input` — the components Pi's own selectors
 * use — rather than from `ctx.ui.select`, because the built-in selector is
 * arrows and enter only: no filter, and a listing can hold hundreds of ids. The
 * keys are the picker's own:
 *
 *   type          narrow the list (fuzzy, the same matcher Pi's selector uses)
 *   ↑ ↓           move, wrapping at both ends
 *   space         mark or unmark the row under the cursor
 *   enter         add the marked rows, or the one under the cursor when none is marked
 *   esc           cancel, adding nothing
 *
 * Marks survive filtering, so a model can be found, marked, and the filter
 * cleared without losing it. The list is rebuilt when a mark changes, because
 * the mark is part of the row's label; the highlighted row and the filter are
 * restored across that rebuild.
 *
 * The component owns no policy: what to offer comes from `catalog.ts`, and what
 * to do with the answer belongs to the caller. `done(null)` is a cancel.
 */

import { Input, SelectList, fuzzyFilter, getKeybindings, matchesKey, type Component } from "@earendil-works/pi-tui";
import { getSelectListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { MARK_ON, candidateDescription, candidateLabel, resolveSelection, toggleMarked } from "./catalog.ts";
import type { Candidate } from "./catalog.ts";

/** What the picker hands back: the chosen models, or `null` when it was cancelled. */
export type PickerOutcome = readonly Candidate[] | null;

export interface ModelPickerOptions {
  readonly title: string;
  readonly hint: string;
  readonly candidates: readonly Candidate[];
  /** Rows drawn at once. The rest are reachable by filtering or scrolling. */
  readonly maxVisible?: number;
}

export class ModelPicker implements Component {
  private readonly options: ModelPickerOptions;
  private readonly theme: Theme;
  private readonly done: (outcome: PickerOutcome) => void;
  private readonly search: Input;
  private readonly selectTheme = getSelectListTheme();

  private list: SelectList;
  private filter = "";
  private cursorId: string | undefined;
  private marked = new Set<string>();
  /** The candidates the filter currently shows, in the order it shows them. */
  private visible: readonly Candidate[] = [];

  constructor(options: ModelPickerOptions, theme: Theme, done: (outcome: PickerOutcome) => void) {
    this.options = options;
    this.theme = theme;
    this.done = done;
    this.search = new Input({ placeholder: "filter" });
    this.search.focused = true;
    this.list = this.buildList();
  }

  /** How many rows are marked. Exposed for the caller's confirmation text. */
  get markedCount(): number {
    return this.marked.size;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "space")) {
      this.toggle();
      return;
    }

    const keybindings = getKeybindings();
    if (
      keybindings.matches(data, "tui.select.up") ||
      keybindings.matches(data, "tui.select.down") ||
      keybindings.matches(data, "tui.select.confirm") ||
      keybindings.matches(data, "tui.select.cancel")
    ) {
      this.list.handleInput(data);
      this.cursorId = this.list.getSelectedItem()?.value ?? this.cursorId;
      return;
    }

    this.search.handleInput(data);
    const value = this.search.getValue();
    if (value === this.filter) return;
    this.filter = value;
    this.list = this.buildList();
    this.cursorId = this.list.getSelectedItem()?.value ?? this.cursorId;
  }

  /**
   * Every element is a line of text. `Input.render` and `SelectList.render`
   * return arrays of lines, so they are spread rather than nested: the TUI
   * paints each element with `String.replace`, and an array where a string
   * belongs is a crash rather than a formatting bug.
   */
  render(width: number): string[] {
    const marked = this.marked.size === 0 ? [] : [this.theme.fg("accent", `${MARK_ON} ${this.marked.size} marked`)];
    return [
      this.theme.fg("accent", this.theme.bold(this.options.title)),
      ...marked,
      ...this.search.render(width),
      "",
      ...this.list.render(width),
      "",
      this.theme.fg("dim", this.options.hint),
    ];
  }

  invalidate(): void {
    this.search.invalidate();
    this.list.invalidate();
  }

  private buildList(): SelectList {
    this.visible = fuzzyFilter([...this.options.candidates], this.filter, (candidate) => candidate.id);

    const list = new SelectList(
      this.visible.map((candidate) => ({
        value: candidate.id,
        label: candidateLabel(candidate, this.marked.has(candidate.id)),
        description: candidateDescription(candidate),
      })),
      this.options.maxVisible ?? 12,
      this.selectTheme,
    );

    const index = this.cursorId === undefined ? -1 : this.visible.findIndex((c) => c.id === this.cursorId);
    list.setSelectedIndex(Math.max(0, index));
    list.onSelect = () => this.confirm();
    list.onCancel = () => this.done(null);
    list.onSelectionChange = (item) => {
      this.cursorId = item.value;
    };
    return list;
  }

  private toggle(): void {
    const id = this.list.getSelectedItem()?.value;
    if (id === undefined) return;
    this.marked = toggleMarked(this.marked, id);
    this.list = this.buildList();
  }

  private confirm(): void {
    // The whole candidate order, not the filtered slice: a model marked before
    // the filter changed is still marked, and must still be added.
    const order = this.options.candidates.map((candidate) => candidate.id);
    const chosen = resolveSelection(this.marked, this.list.getSelectedItem()?.value, order);
    if (chosen.length === 0) return;

    const byId = new Map(this.options.candidates.map((candidate) => [candidate.id, candidate]));
    this.done(chosen.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])));
  }
}
