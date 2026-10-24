# Verification — aaii-router fallback fixes (review-aaii-fallback-model H1–H8, review-aaii-fallback-tui 1–6)

Scope (read-only). No source or test file was modified by this pass; the only file written is this
report. Probes were throwaway `.ts` files under `%TEMP%\opencode\aaii-probe\` (deleted after use),
driven the same way the suite runs (`node` type-stripping with a theme stub).

Changed files inspected: `extensions/aaii-router/fallback-editor.ts`, `settings.ts`, `fallback-tui.ts`,
`index.ts`, `README.md`, and the three `*.test.ts` files.

## Test run

`node --test extensions/aaii-router/*.test.ts`

```
# tests 74
# suites 0
# pass 74
# fail 0
# skipped 0
# todo 0
```

Per file: `candidates` 11, `chain-order` 2, `cooldown` 11, `fallback-editor` 17, `fallback-tui` 17,
`settings` 16 (sum 74). The baseline recorded in the two reviews was 61 tests; 13 tests have been added,
all passing. No hang: the suite finishes in ~320 ms (the `\x1b` timer is `unref`ed, see below).

## Per-finding verdict

| # | Source | Verdict | Fix location | Regression test |
|---|---|---|---|---|
| H1 | model | resolved | `fallback-editor.ts:73-82` (`missing` recomputed in `changed`), `:101-104` | `fallback-editor.test.ts:143` |
| H2 | model | resolved | `settings.ts:251` (`/^[^\s/]+\/\S+$/`), docstring `:196` | `settings.test.ts:221` |
| H3 | model | resolved | `fallback-editor.ts:134` (skip `missing`) | `fallback-editor.test.ts:161`, `fallback-tui.test.ts:214` |
| H4 | model | resolved | `fallback-editor.ts:108-110` (guard before arming) | `fallback-editor.test.ts:167`; `fallback-tui.test.ts:186` |
| H5 | model | resolved | `fallback-editor.ts:80` (explicit empty case) | `fallback-editor.test.ts:179` |
| H6 | model | resolved | `fallback-editor.ts:129` (preserve input order, append new) | `fallback-editor.test.ts:189` |
| H7 | model | resolved | `fallback-tui.ts:136-173,175-185` (escape buffer) | `fallback-tui.test.ts:255` |
| H8 | model | partially resolved | coverage | 4 of 5 gaps now covered; nested state-stability still untested |
| 1 | tui | partially resolved | `index.ts:165-204,529,668,691` | `fallback-tui.test.ts:339` |
| 2 | tui | resolved | `fallback-tui.ts:194-218`, `index.ts:518-520` | `fallback-tui.test.ts:271` |
| 3 | tui | resolved | `fallback-tui.ts:238-250`, `index.ts:502-507,536-541` | `fallback-tui.test.ts:304` |
| 4 | tui | resolved | `fallback-editor.ts:108-110` | `fallback-editor.test.ts:167`; `fallback-tui.test.ts:186` |
| 5 | tui | partially resolved | `fallback-tui.ts:61,252-257,326-332` | `fallback-tui.test.ts:314` |
| 6 | tui | resolved | `fallback-editor.ts:101-104` (p no longer drops) | `fallback-editor.test.ts:199`; `fallback-tui.test.ts:214` |

### H1 — `missing` desync on `pin`/`delete` — resolved

`changed()` now re-derives the invariant on every mutation: `missing: entry.pinned && !current.has(entry.label)`
(`fallback-editor.ts:77`), and it also drops rows that are neither a candidate, pinned, nor excluded
(`:75-76`), which closes the "ghost row" path. The `pin` arm (`:101-104`) routes missing rows to an
explanatory message instead of toggling, so a non-candidate cannot be pinned silently. Reproduced the
review's scenario: pin an excluded non-candidate → `missing` true, and `d`,`d` removes it rather than
unpinning a ghost. Covered by `fallback-editor.test.ts:143`.

### H2 — label validation — resolved

`editSetting` for `pinned`/`models` now rejects with `!/^[^\s/]+\/\S+$/.test(label)`
(`settings.ts:251`), so internal whitespace, a leading space, a trailing space before the slash, a bare
segment and a space-separated list are all refused; nested ids (`openrouter/anthropic/model`) still pass.
`parseList`'s docstring was corrected to "comma or newline separated" (`settings.ts:196`). Validated
through edits, files and the environment by `settings.test.ts:221`.

### H3 — preview includes missing — resolved

`pipelinePreview` filters `!row.excluded && !row.missing` (`fallback-editor.ts:134`), so the preview is now
the order the router would actually run. `fallback-editor.test.ts:161` and `fallback-tui.test.ts:214` assert
a `missing` pin is absent from the preview. README:231-237 and the component comment are consistent with this.

### H4 — `d` arms on an unpinned row — resolved

The guard now runs first: `if (!row.pinned && !row.missing) return { ...clean, message: 'no pin on <label>' }`
(`fallback-editor.ts:108-110`), before the arming branch. `d` neither arms nor silently no-ops; it reports.
Covered by `fallback-editor.test.ts:167` and `fallback-tui.test.ts:186`.

### H5 — cursor after the last row is removed — resolved

`ordered.length === 0 ? 0 : ...` (`fallback-editor.ts:80`). Deleting the only (missing) row yields
`rows: []`, `cursor: 0`; `fallback-editor.test.ts:179` asserts it and that navigation and save still work.

### H6 — `editorSettings` reordered exclusions — resolved

Excluded labels are emitted as `[...settings.excludedModels.filter(has), ...new]`
(`fallback-editor.ts:129`), preserving the file's order and appending newly excluded rows.
`fallback-editor.test.ts:189` covers retain + append + removal.

### H7 — chunked `\x1b` closes the editor — resolved (keybinding nit remains)

The component now buffers a lone `\x1b` or a partial CSI/SS3 prefix and waits 50 ms before dispatching it
(`fallback-tui.ts:136-173`, `flushEscape` `:175-185`, `ESCAPE_SEQUENCES` `:63-70`). Probe confirmed
`"\x1b"` then `"[B"` moves the cursor and never resolves the editor. Covered by `fallback-tui.test.ts:255`
(and `fallback-editor.test.ts:213` pins the pure `keyFor` contract). The secondary note in the finding —
that raw matching ignores the user's configured cancel binding (`picker.ts` uses `matchesKey`) — is not
addressed and remains a known nit, not the defect that was reported.

### H8 — test gaps — partially resolved

| Sub-gap | Status |
|---|---|
| no test pins an excluded non-candidate (exposes H1) | covered — `fallback-editor.test.ts:143` |
| no test asserts the empty-row cursor after delete (H5) | covered — `fallback-editor.test.ts:179` |
| no test of nested state stability `initialEditorState(c, editorSettings(initialEditorState(c,s),s))` | **still untested** (grep across the suite finds no such nesting) |
| whitespace cases neutralised by `parseList` (H2) | covered — `settings.test.ts:221` (internal whitespace now hits the validator) |
| no test for `p` on a `missing` row (README:236) | covered — `fallback-editor.test.ts:199` |

### TUI Finding 1 — turn stickiness — partially resolved

`chooseTurnCandidate` now invalidates the remembered label when the session's recorded epoch differs from
the module counter (`index.ts:194-198`), and `bumpChainEpoch()` is called on editor save (`index.ts:529`),
`set pinned|models` (`:668`) and `reset` (`:691`). Unit-covered by `fallback-tui.test.ts:339`. However, the
`/aaii-router settings` window can also change `pinned`/`models` (via `editSettingDialog`, `index.ts:456-460`)
and rewrites the file with only `forget()` afterward — no epoch bump (`index.ts:463-481`). See New Defect 1.

### TUI Finding 2 — draft lost on save failure — resolved

`onSave` is awaited; `done()` is called only on resolve; a rejection sets `save failed: <message>` and keeps
the draft with the editor open (`fallback-tui.ts:200-217`), wired from `index.ts:518-520`. Verified by
`fallback-tui.test.ts:271` (open on failure, retry succeeds, two attempts). See New Defect 3 for the
key-handling side effect.

### TUI Finding 3 — env override warning — resolved (the warning fires)

`heldEnvVars` is computed from `process.env` for the two chain variables (`index.ts:502-507`) and passed in;
the component draws `[overridden by ...]` in the header and a `warning: ... override this session` status
line (`fallback-tui.ts:238-250`), independent of save. `index.ts:536-541` still posts the post-save toast.
Covered by `fallback-tui.test.ts:304`.

### TUI Finding 4 — same as H4 — resolved

### TUI Finding 5 — narrow viewport — partially resolved

Compact footer `s save · q cancel` below 30 columns (`fallback-tui.ts:61,252-257`) and `[P]/[X]/[!]` badges
after the label (`:326-332`). Probe at the finding's example width **16**:

```
|s save · q canc…|      <- cancel key now visible (good)
|▸ 1  openrouter…|      <- [P] badge still truncated away
```

The footer half of the finding is fixed for widths 15–18 (the `q` hint is only lost at width ≤ 10, where the
fixed 17-char compact string can no longer reach it). The row-badge half is **not** fixed at the widths the
finding cited: because the badge sits *after* the label, a long label (e.g. `openrouter/alpha`, 16 chars)
fills the line and the badge is dropped. The regression test `fallback-tui.test.ts:314` only exercises width
28, where the label plus badge fit, so it does not catch this.

### TUI Finding 6 — `p` instantly drops a missing row — resolved

`p` on a `missing` row no longer removes it; it reports `press d twice to drop the missing pin <label>`
(`fallback-editor.ts:101-104`), leaving removal to the guarded `d`,`d`. Covered by
`fallback-editor.test.ts:199` and `fallback-tui.test.ts:214`.

## New defects introduced or left by the fixes

### 1 (Medium) — the settings window changes the chain without bumping `chainEpoch`

- Evidence: `index.ts:431-482` (`openSettings`) edits `pinned`/`models` (`:456-460`), writes the file and
  calls only `forget()` (`:471`). `bumpChainEpoch()` is absent, unlike `openFallbackEditor` (`:529`),
  `set` (`:668`) and `reset` (`:691`).
- Failure scenario: the session is on `openrouter/alpha` at epoch 0. The operator runs
  `/aaii-router settings`, edits **Pinned models** to `commandcode/beta`, and saves. The next new user turn
  calls `chooseTurnCandidate` with the still-matching session epoch (`index.ts:194-198`), so `remembered`
  (`openrouter/alpha`) is re-selected and the new pin is ignored — the exact Finding 1 bug, now reachable
  through the settings window and its "Reset to defaults" path. (`set providers`/`set origins` similarly
  change eligibility without a bump, though there the remembered model may legitimately stay.)

### 2 (Low) — `render()` flushes an in-flight partial escape sequence

- Evidence: `render` calls `this.flushEscape()` unconditionally (`fallback-tui.ts:228`); `flushEscape`
  dispatches whatever is buffered (`:175-185`).
- Failure scenario: a terminal delivers an arrow as `"\x1b"` then `"[A"`, and the host re-renders between the
  two chunks (resize/tick). `render()` flushes the buffered `"\x1b"` (or `"\x1b["`), `keyFor` maps it to
  `cancel`/`other`, and the trailing `"[A"` becomes `other` — the arrow is lost and a lone `\x1b` closes a
  clean editor. The buffering was introduced to stop exactly this, so flushing inside `render` weakens it.
  Low likelihood (chunks normally arrive together and the timer is 50 ms, and no self-render occurs while
  buffering), but the two mechanisms contradict each other.

### 3 (Low) — every key is silently dropped while a save is in flight, with no feedback

- Evidence: `handleInput` and `dispatchKey` return early on `this.saving` (`fallback-tui.ts:134,188`); no
  "saving…" indicator is drawn and `requestRender` is not called when the save starts.
- Failure scenario: `onSave`/`saveSettings` blocks on a slow or locked filesystem. The operator presses
  `q`/`Esc` to abandon the save; the keys are discarded with no visual response, so the editor looks hung
  until the write settles. Probe: after `s` with a pending `onSave`, `q` leaves `resolved=false, saving=true`;
  only releasing the promise resolves it. Double-save is correctly prevented; the trade-off is a frozen,
  unexplained UI. (Probe also confirms the pending `escapeTimer` is `unref`ed, so it cannot keep the process
  or a test alive.)

## Targeted checks requested

- **`chainEpoch` reload (module back to 0, session holds an older epoch):** harmless. A mismatch only makes
  `epochValid` false (`index.ts:194-198`), which falls back to `preferred(ordered,...) ?? head` — never a
  stale resurrect, never a throw beyond the existing "no eligible model" guard. A *higher* stale session
  epoch keeps mismatching after later bumps, so the head is used until a new turn re-stamps the current epoch
  via `stick` (`:574`). Continuation behaviour is unchanged: the `reason === "continuation"` branch
  (`index.ts:578-586`) never consults the epoch for selection and passes `request.state?.epoch ?? chainEpoch`
  through, so prompt-cache stickiness is preserved across a reload. The only visible effect is that the first
  *new user turn* after a reload picks the head instead of the previous model, which is a safe default.
- **Async save path:** done only on success (`fallback-tui.ts:201-205`); no double save (`saving` guard at
  `:134,188`); the error path preserves the draft (`:206-217`). Keypress during save: ignored (New Defect 3).
- **`\x1b` buffering:** no leaked timer (cleared before each transition, in `flushEscape`, and in `finish`
  `:298-301`); timer is `unref`ed so no test or process fails to exit — the 74-test run completes in ~320 ms.
- **Env warning fires:** yes — header + status layout (`fallback-tui.ts:238-250`) fed by `index.ts:502-507`,
  plus the post-save toast (`:536-541`); covered by `fallback-tui.test.ts:304`.
- **README key table vs `keyFor`:** matches exactly. README:220-229 lists `↑↓/kj`, `KJ/shift-arrows`,
  `p`, `x`, `d`, `r`, `s`+enter, `q`+esc; `keyFor` (`fallback-editor.ts:144-158`) implements precisely those
  sequences (`\x1b[A/B/OA/OB`, `\x1b[1;2A/1;2B`, `k/j/K/J`, `p/x/d/r`, `s/\r/\n`, `q/\x1b`), and README:224-226
  matches the `missing`-row behaviour in code. No discrepancy found.

## Verdict rationale

Twelve of the fourteen findings are fully resolved with a targeted regression test; H8 is a coverage item
that is 4/5 closed. TUI Findings 1 and 5 are only partially resolved — the settings window can still change
pins without invalidating session stickiness (a live reproduction of the original HIGH bug through a second
entry point), and the narrow-width row badges are still truncated at the width the finding cited. Both are
small, well-localized fixes and the suite is green (74/74), but TUI Finding 1 is user-visible and defeats the
point of the fix on that path.

VERDICT: fix-first
