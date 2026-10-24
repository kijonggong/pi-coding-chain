# aaii-router fallback TUI — shared contract (coordinator-owned)

Goal: `/aaii-router fallback` opens a magpie-style TUI (see `_research/magpie-tui-reference.md`)
to view and edit the candidate fallback chain. Today the chain order is automatic (AAII score / tier,
`buildCandidates` in `extensions/aaii-router/candidates.ts`) and can only be narrowed by
excluded origins/providers (`settings.ts`). This feature adds operator control over order.

## New settings (owned by the model-layer worker, in settings.ts)

| key (file) | Settings field | type | default | env var |
|---|---|---|---|---|
| `pinned` | `pinnedModels: readonly string[]` | ordered list of candidate labels (`provider/id`) | `[]` | `PI_AAII_ROUTER_PINNED` |
| `models` | `excludedModels: readonly string[]` | candidate labels to leave out | `[]` | `PI_AAII_ROUTER_EXCLUDE_MODELS` |

- Both are **global only**: NOT in `PROJECT_KEYS` (they decide where requests go).
- Labels are validated as `<provider>/<id>` (non-empty both sides); the list is deduplicated.
- Both get `SETTINGS` descriptors (kind `list`), round-trip through `serializeSettings`/`parseSettings`,
  and show up in `describeSettings`.

## Ordering rule (model layer, new file `extensions/aaii-router/chain-order.ts`)

```ts
export function applyChainSettings(candidates: readonly Candidate[], settings: Pick<Settings, "pinnedModels" | "excludedModels">): Candidate[]
```
1. Drop candidates whose label is in `excludedModels`.
2. Pinned labels that exist come first, in `pinnedModels` order.
3. The rest follow in their incoming (score) order.
Pinned labels that match no candidate are ignored here (the editor shows them as "missing").

## Editor state (model layer, new file `extensions/aaii-router/fallback-editor.ts`, pure, no Pi SDK import)

```ts
export interface EditorRow {
  readonly label: string;          // provider/id
  readonly score: number | undefined;
  readonly pinned: boolean;
  readonly excluded: boolean;
  readonly missing: boolean;       // pinned but not a current candidate
}
export interface EditorState {
  readonly rows: readonly EditorRow[];   // effective order: pinned, then rest, excluded rows last
  readonly cursor: number;
  readonly armed: boolean;               // first `d` pressed on the cursor row
  readonly dirty: boolean;
  readonly message?: string;             // status line text
}
export type EditorKey =
  | "up" | "down"              // j/k, arrows
  | "moveUp" | "moveDown"      // K/J, shift+arrows: reorder; moving a row pins it (and every row above it)
  | "pin"                      // p: toggle pin on the cursor row
  | "exclude"                  // x: toggle excluded
  | "delete"                   // d: double tap; removes the pin (and a missing row) — first press arms + message
  | "reset"                    // r: clear pins and model exclusions (dirty)
  | "save"                     // s / enter
  | "cancel"                   // q / esc
  | "other";
export function initialEditorState(candidates: readonly Candidate[], settings: Settings): EditorState;
export function reduceEditor(state: EditorState, key: EditorKey): { readonly state: EditorState; readonly effect?: "save" | "close" };
export function editorSettings(state: EditorState, settings: Settings): Settings; // writes pinnedModels/excludedModels
export function pipelinePreview(state: EditorState, width: number): string;     // "a → b → c …" truncated to width, excluded rows skipped
export function keyFor(data: string): EditorKey;                               // raw terminal input -> EditorKey
```
Any key other than `delete` disarms. `cancel` with `dirty` first arms a "press q again to discard" message (same double-tap rule), then closes.

## TUI layer (TUI worker): `extensions/aaii-router/fallback-tui.ts` + wiring in `index.ts`

- Builds a Pi SDK component via `ctx.ui.custom(...)` (see `extensions/coding-fallback/picker.ts` for the pattern)
  that renders: header (`aaii-router fallback — <settings path>`), the pipeline preview, the row list
  (cursor marker, rank, label, score, `pinned`/`excluded`/`missing` tags), and a footer of key hints + `state.message`.
- Feeds input through `keyFor` → `reduceEditor`; on `effect: "save"` resolves with `editorSettings(...)`,
  on `"close"` resolves `undefined`.
- `index.ts`: new subcommand `fallback` (its `SUBCOMMANDS` entry in settings.ts is added by the MODEL worker;
  the TUI worker does not edit settings.ts), guarded with `ctx.mode === "tui"` like picker.ts (rpc/print → notify how to use `set pinned ...`).
  Save with `saveSettings(globalSettingsPath(), ...)`, then invalidate caches as the settings window does.
- The router request path must call `applyChainSettings` on the candidate list before `orderForRequest`.
