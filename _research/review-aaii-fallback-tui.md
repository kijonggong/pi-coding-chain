# Code Review: `aaii-router` Fallback Chain TUI & Integration

- **Review Target**: `extensions/aaii-router/fallback-tui.ts`, `extensions/aaii-router/fallback-tui.test.ts`, `extensions/aaii-router/index.ts` (subcommand `fallback` at line 575, `applyChainSettings` at lines 498, 641, 665, comments), `extensions/aaii-router/README.md`.
- **References**: `_research/aaii-fallback-tui-contract.md`, `_research/magpie-tui-reference.md`, `@earendil-works/pi-tui`, `@earendil-works/pi-coding-agent`.
- **Test Suite Results**: `node --test extensions/aaii-router/*.test.ts` executed with **61 passed, 0 failed, 0 skipped** (duration: 294ms across 6 test suites).

---

## Executive Summary

The fallback chain editor is cleanly separated between pure state reduction (`fallback-editor.ts`) and the TUI component layer (`fallback-tui.ts`). SDK type boundaries are respected, with zero runtime dependency on Pi TUI packages in the model/editor layers. The mode guards correctly protect RPC and print sessions.

However, several defects prevent an unconditional ship verdict:
1. **Turn stickiness in `route()` prevents newly saved chain pins from taking effect on the next turn** in ongoing sessions.
2. **Editor save failures permanently discard user draft state** because `done()` terminates the UI component before file write I/O is attempted.
3. **Active environment overrides (`PI_AAII_ROUTER_PINNED`) are neither flagged nor warned inside the editor UI**, misleading the operator.
4. **Unpinned candidate rows false-arm on `d`**, prompting the operator to confirm removing a non-existent pin.
5. **Narrow terminals (`width < 20`) truncate action hints from the right**, cutting off `q cancel` and hiding critical status badges.

---

## Detailed Findings Ranked by Severity

### Finding 1: Session Turn Stickiness Ignores Newly Saved Chain Order on Subsequent Requests [HIGH]
- **File & Line**: [extensions/aaii-router/index.ts#L542-L550](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/index.ts#L542-L550)
- **Defect**: In `route()`, user turns consult `request.state?.label` to preserve session continuity:
  ```ts
  const remembered = ordered.find((candidate) => candidate.label === request.state?.label);
  const candidate =
    remembered && coolingFor(cooldowns, remembered.label, now) === undefined
      ? remembered
      : (preferred(ordered, cooldowns, now) ?? head);
  ```
  Although `openFallbackEditor` calls `forget()` upon save (clearing `settingsCache` and candidate `cache`), the previous turn's model remains recorded in the session's branch state (`request.state.label`). As long as that remembered model is still present in `ordered` and not in cooldown, `route()` re-selects it over the newly pinned chain head (`ordered[0]`).
- **Concrete Failure Scenario**:
  An operator chats with `aaii/fallback`. Turn 1 routes to `openrouter/alpha` (the unpinned score leader). The operator decides `commandcode/beta` should handle requests instead, runs `/aaii-router fallback`, moves `commandcode/beta` to the top (#1 rank), and saves. The notification announces `aaii-router: chain written to ~/.pi/agent/aaii-router.json`. The operator sends Turn 2. Because `openrouter/alpha` is still an eligible candidate and has not failed, `route()` re-selects `openrouter/alpha`. The operator's newly pinned model is completely ignored, and requests remain stuck on the old model indefinitely until it encounters a failure.
- **Suggested Fix**:
  When chain settings are saved in `openFallbackEditor` (or when `applyChainSettings` changes the chain), clear or reset the session model stickiness. For example, track a `chainEpoch` counter or flag in `index.ts` that `route()` inspects to bypass `remembered` on the first request following an operator chain update, ensuring the new head candidate (`ordered[0]`) is chosen immediately.

---

### Finding 2: In-Memory Draft Discarded on Save Failure (Premature TUI Dismissal) [HIGH]
- **File & Line**: [extensions/aaii-router/fallback-tui.ts#L117-L120](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/fallback-tui.ts#L117-L120) and [extensions/aaii-router/index.ts#L451-L462](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/index.ts#L451-L462)
- **Defect**: When the operator presses `s` or `Enter`, `FallbackEditor.handleInput` immediately calls `this.finish(editorSettings(...))`, which triggers `this.done(outcome)`. In Pi's interactive mode, calling `done` tears down the custom component from `editorContainer` and restores the main chat editor. Only *after* the TUI has already been dismissed does `openFallbackEditor` execute `await saveSettings(path, edited)`. If `saveSettings` rejects (e.g. disk full, EACCES permission denied, file locked), the error is caught and reported via `notify(...)`, but the editor component has already been unmounted and its in-memory draft is destroyed.
- **Concrete Failure Scenario**:
  An operator spends several minutes organizing a complex fallback chain with multiple pins and custom exclusions. The configuration file `~/.pi/agent/aaii-router.json` is temporarily marked read-only or permission-denied. The operator presses `Enter` to save. The editor immediately closes and vanishes. A notification shows `aaii-router: could not write ~/.pi/agent/aaii-router.json: EACCES: permission denied`. The operator cannot fix the file permissions and retry saving; their entire draft is gone and must be re-entered from scratch.
- **Suggested Fix**:
  Accept an asynchronous save handler in `FallbackEditorOptions`, e.g. `onSave: (settings: Settings) => Promise<void>`. Keep the TUI active while saving; if `onSave` throws, catch the error, update `this.state = { ...this.state, message: "save failed: " + error.message, armed: false }`, call `this.invalidate()`, and `this.requestRender()`. Only call `this.done()` once persistence has successfully succeeded.

---

### Finding 3: Lack of In-Editor Warning When Environment Variables Override Settings [MEDIUM]
- **File & Line**: [extensions/aaii-router/fallback-tui.ts#L133-L148](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/fallback-tui.ts#L133-L148) and [extensions/aaii-router/index.ts#L470-L480](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/index.ts#L470-L480)
- **Defect**: When `PI_AAII_ROUTER_PINNED` or `PI_AAII_ROUTER_EXCLUDE_MODELS` is defined in the environment, `currentSettings(ctx)` loads those values into the draft because environment variables take precedence over file settings. However, inside `FallbackEditor`, there is no visual indication (no `(env)` badge, no header banner, and no warning message) that the chain is currently held by environment overrides. The warning in `index.ts:476` is only emitted as a toast *after* the editor has already closed following a save. If the user cancels with `q` or `Esc`, no warning is displayed at all.
- **Concrete Failure Scenario**:
  An operator launches Pi in an environment where `PI_AAII_ROUTER_PINNED=openrouter/alpha` is exported in the shell. The operator opens `/aaii-router fallback`, sees `openrouter/alpha` at the top, moves `commandcode/beta` above it, and saves. Only after the editor closes does a brief warning flash: `aaii-router: PI_AAII_ROUTER_PINNED still override this session`. In the active session, requests continue routing to `openrouter/alpha`. Furthermore, reopening `/aaii-router fallback` reloads from `currentSettings`, so the editor again displays `openrouter/alpha` as pinned, wiping the operator's expectations.
- **Suggested Fix**:
  Pass `heldEnvVars: readonly string[]` in `FallbackEditorOptions`. If active overrides exist, render a prominent header or status banner (e.g. `aaii-router fallback — <path> [OVERRIDDEN by PI_AAII_ROUTER_PINNED]`) and display an advisory note in the footer so operators know before editing that file changes will not take precedence in this session.

---

### Finding 4: Unpinned Rows Arm with Misleading Pin Removal Message on `d` [MEDIUM]
- **File & Line**: [extensions/aaii-router/fallback-editor.ts#L103-L108](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/fallback-editor.ts#L103-L108)
- **Defect**: In `reduceEditor`, the `delete` action checks whether the action is armed before verifying if the target row is actually pinned or missing:
  ```ts
  case "delete":
    if (!row) return { state: clean };
    if (!state.armed || state.message === DISCARD) {
      return { state: { ...clean, armed: true, message: `press d again to remove the pin on ${row.label}` } };
    }
    if (!row.pinned && !row.missing) return { state: clean };
  ```
  When the cursor is on an unpinned, normal candidate row, pressing `d` arms the editor and shows `press d again to remove the pin on <label>`. Pressing `d` a second time hits line 108, which evaluates `!row.pinned && !row.missing` and returns `{ state: clean }` without performing any action.
- **Concrete Failure Scenario**:
  The operator browses candidate rows and inadvertently taps `d` on an unpinned candidate row. The status line warns in bold yellow: `press d again to remove the pin on dashscope/gamma`. Confused because the model has no `pinned` tag, the operator taps `d` again. The message disappears, and nothing happens.
- **Suggested Fix**:
  Guard arming against unpinned rows before setting the armed state:
  ```ts
  case "delete":
    if (!row || (!row.pinned && !row.missing)) return { state: clean };
    if (!state.armed || state.message === DISCARD) {
      return { state: { ...clean, armed: true, message: `press d again to remove ${row.missing ? "missing row" : "pin on"} ${row.label}` } };
    }
    return changed(row.missing
      ? state.rows.filter((entry) => entry !== row)
      : state.rows.map((entry) => entry === row ? { ...entry, pinned: false } : entry));
  ```

---

### Finding 5: Key Hints Truncation in Narrow Viewports (`width < 20`) Hides Cancel Key [LOW]
- **File & Line**: [extensions/aaii-router/fallback-tui.ts#L47-L53](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/fallback-tui.ts#L47-L53) and [extensions/aaii-router/fallback-tui.ts#L69-L83](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/fallback-tui.ts#L69-L83)
- **Defect**: The module comment states: *"Two rather than one: the whole set does not fit 80 columns, and a truncated footer would eat the cancel key."* However, `HINT_ACTIONS` is 27 characters long (`"r reset · s save · q cancel"`). In narrow terminal viewports (`width < 20`, e.g. 15–18 columns in sidebars or split panes), `draw()` truncates from the right, producing `"r reset · s sa…"`. The `q cancel` key hint is completely cut off. In addition, `rowLine` places the status tags (`pinned`, `excluded`, `missing`) after the score at the end of the line, which gets truncated away at narrow widths.
- **Concrete Failure Scenario**:
  An operator opens `/aaii-router fallback` in a narrow vertical split pane (width 16). The action footer displays only `r reset · s sa…`. The operator does not know how to exit without saving. Additionally, when they toggle `p` on a candidate, the line renders as `▸ 1  openroute…`, hiding the `pinned` indicator entirely and giving no visual feedback that pinning succeeded.
- **Suggested Fix**:
  In `FallbackEditor.render`, when `width < 30`, render a compact, prioritized footer such as `s save · q cancel`. In `rowLine`, render compact badges (such as `[P]`, `[X]`, `[!]`) before or immediately after the model label rather than after the score so that critical status indicators survive narrow truncations.

---

### Finding 6: Unconfirmed Instant Drop on `missing` Rows via `p` Bypasses `d` Double-Tap Safeguard [INFORMATIONAL]
- **File & Line**: [extensions/aaii-router/fallback-editor.ts#L95-L99](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/fallback-editor.ts#L95-L99) vs [extensions/aaii-router/fallback-editor.ts#L103-L111](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/fallback-editor.ts#L103-L111)
- **Defect**: The Magpie UX reference and contract require a double-tap confirmation (`d` arms, next `d` executes) for destructive removals to prevent accidental loss of configured chain items. `d` properly implements this double-tap rule. However, pressing `p` on a `missing` row immediately purges the row from the draft on a single tap (`row.missing ? state.rows.filter(...) : ...`), completely bypassing the safety mechanism.
- **Concrete Failure Scenario**:
  An operator has a pinned model that is temporarily offline (`missing` tag). While navigating with arrow keys, they accidentally press `p`. The missing pin is instantly removed from the candidate list without confirmation or status alert.
- **Suggested Fix**:
  Align `p` with `d` when dealing with `missing` entries: either disallow dropping missing rows with `p` (reserving unpinning/dropping to `d` as indicated in the footer `d unpin`), or require double-tap confirmation when removing a missing row via `p`.

---

## Targeted Contract & Requirement Verification

### 1. Component Contract vs SDK Types & Lifecycle
- **SDK Match**: `FallbackEditor` implements `render(width: number): string[]`, `handleInput(data: string): void`, and `invalidate(): void`, perfectly satisfying `@earendil-works/pi-tui.Component`.
- **`done()` Lifecycle**: `FallbackEditor.finish` encapsulates `this.done(outcome)` behind `if (this.finished) return; this.finished = true;`. Subsequent keypresses in `handleInput` check `if (this.finished) return;`. It is strictly guaranteed never to resolve twice.

### 2. `ctx.mode` Guard and `hasUI` Check
- **Guard Coverage**: [extensions/aaii-router/index.ts#L437](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/index.ts#L437) enforces:
  ```ts
  if (ctx?.hasUI !== true || ctx.mode !== "tui")
  ```
- **RPC & Print Modes**:
  - In RPC mode, `ctx.hasUI` is `true`, but `ctx.mode === "rpc"`. The guard triggers correctly and notifies the user with fallback CLI instructions (`/aaii-router set pinned ...`).
  - Without the `ctx.mode !== "tui"` check (i.e. if only checking `!ctx.hasUI`), calling `ctx.ui.custom()` in RPC mode would resolve immediately to `undefined` (as implemented in `pi-coding-agent/dist/modes/rpc/rpc-mode.js:152`), causing the command to silently do nothing.
  - In print mode, `ctx.hasUI === false` and `ctx.mode === "print"`, properly triggering the guard.

### 3. Cache Invalidation and Next-Request Pinned Order
- **Cache Invalidation**: `openFallbackEditor` invokes `forget()`, resetting `settingsCache = undefined`, `settingsNotes = []`, and candidate `cache = undefined`.
- **Ordering Application**: On the next request, `route()` re-reads settings and executes `orderForRequest(applyChainSettings(candidates, settings), ...)`.
- **Stickiness Defect**: As reported in **Finding 1**, while `applyChainSettings` correctly reorders candidates, the session stickiness check (`request.state?.label`) prevents the new order from being selected if the previous turn's model remains eligible.

### 4. Environment Overrides Warning
- **Warning Verification**: As reported in **Finding 3**, `openFallbackEditor` notifies *after* the save completes. Inside the TUI editor itself, there is no visual indicator or warning that environment variables will supersede the edited file.

### 5. Save Failure Resilience
- **Crash Prevention**: `saveSettings` in `openFallbackEditor` is enclosed in a `try / catch` block and gracefully notifies errors via `notify(..., "error")`.
- **State Loss Defect**: As reported in **Finding 2**, because `done()` is called prior to the write, any save failure leaves the operator with a dismissed editor and lost in-memory changes.

### 6. Width Clamping & Narrow Terminals (`width < 20`)
- **Clamping**: Line length is bounded via `draw()` which checks character widths against remaining room. Zero-width ANSI codes are styled after plain-text truncation. Lines do not wrap or overflow terminal boundaries.
- **Narrow Terminal Usability**: As reported in **Finding 5**, at `width < 20`, right-hand text truncation swallows the `q cancel` key hint and drops trailing row tags.

### 7. Ordering Consistency Across `next`, `report`, and Request Path
- **Request Path (`route`)**: `orderForRequest(applyChainSettings(candidates, settings), settings.preferVision && containsImage(request.messages))`
- **Step Command (`next`)**: `applyChainSettings(candidates, settings)[0]?.label` (fallback when `branchState` is unset)
- **Status Report (`report`)**: `applyChainSettings(candidates, settings)`
- All three sites consistently call `applyChainSettings(candidates, settings)` using the same candidate base from `registry(ctx, settings)`.

### 8. README Key Table vs `keyFor` Mapping
- The README table at [extensions/aaii-router/README.md#L220-L230](file:///D:/repository/pi-openrouter-catalog-filter/extensions/aaii-router/README.md#L220-L230) precisely documents:
  - `↑ ↓, k j` -> `up` / `down` (`\x1b[A`, `\x1bOA`, `\x1b[B`, `\x1bOB`, `k`, `j`)
  - `K J, shift+arrows` -> `moveUp` / `moveDown` (`\x1b[1;2A`, `\x1b[1;2B`, `K`, `J`)
  - `p` -> `pin`
  - `x` -> `exclude`
  - `d` -> `delete`
  - `r` -> `reset`
  - `s, enter` -> `save` (`s`, `\r`, `\n`)
  - `q, esc` -> `cancel` (`q`, `\x1b`)
- Mapping is faithful, with the behavioral nuances documented in **Finding 4** and **Finding 6**.

---

VERDICT: fix-first
