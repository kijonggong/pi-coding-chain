# Code review — aaii-router fallback model layer

Scope (read-only). Target files:

- `extensions/aaii-router/chain-order.ts` (+ `chain-order.test.ts`)
- `extensions/aaii-router/fallback-editor.ts` (+ `fallback-editor.test.ts`)
- the `pinned` / `models` additions in `extensions/aaii-router/settings.ts` (+ `settings.test.ts`)

Contract: `_research/aaii-fallback-tui-contract.md`. UX: `_research/magpie-tui-reference.md`.
No source or test file was modified; probes were throwaway scripts under the OS temp dir.

Note on the requested diff: `git diff -- extensions/aaii-router/settings.ts` is **empty** because
`settings.ts` is untracked (it does not exist in any commit), so there is no baseline to diff against.
The whole file was reviewed, with attention to `pinned`/`models`. `fallback-tui.ts` / `fallback-tui.test.ts`
are being added by the TUI worker concurrently and are out of scope except where they consume this layer.

## Verdict summary

| # | Severity | Where | One line |
|---|---|---|---|
| H1 | High | `fallback-editor.ts:97-99`, `:109-111` (root `:54`) | `pin`/`delete` break the `missing` invariant: a pinned non-candidate is not flagged missing, and `d` then unpins a ghost row instead of dropping it |
| H2 | Medium | `settings.ts:250-255` (+ `:196-200`) | Label validation accepts labels that can never match a candidate (internal whitespace, space-separated lists), so an exclusion silently does nothing |
| H3 | Medium | `fallback-editor.ts:128` | `pipelinePreview` keeps `missing` rows, so it is not "the order a request would take" (contradicts README:231 and fallback-tui.ts:135-136) |
| H4 | Low | `fallback-editor.ts:105-108` | `d` on an unpinned, non-missing row arms a "remove the pin" prompt, then the second press is a silent no-op |
| H5 | Low | `fallback-editor.ts:75` | After removing the last row, `rows` is empty but `cursor` is `0` (index out of range) |
| H6 | Low | `fallback-editor.ts:122-123` | `editorSettings` canonicalises `excludedModels` order, so open→save can rewrite a hand-ordered list |
| H7 | Low / risk | `fallback-editor.ts:138-148` | `keyFor` maps a lone `"\x1b"` to cancel; correctness depends on the terminal delivering arrow sequences whole |
| H8 | Info | `fallback-editor.test.ts`, `settings.test.ts` | Coverage gaps that hide H1/H2/H5 |

---

## H1 (High) — `missing` is only derived at construction, so `pin`/`delete` desync it

**Where:** `extensions/aaii-router/fallback-editor.ts:97-99` (`pin`), `:109-111` (`delete`); the field is
derived once at `:54` (`missing: pins.has(label) && !byLabel.has(label)`) and never recomputed.

**Defect.** The contract defines `EditorRow.missing` as "pinned but not a current candidate"
(`_research/aaii-fallback-tui-contract.md:38`), i.e. a derived invariant `missing === pinned && !isCandidate`.
The reducer mutates `pinned` (`pin` → `{ ...entry, pinned: !entry.pinned }`) and `excluded` without
recomputing `missing`. The `pin` handler only routes *already-missing* rows to removal (`row.missing ? remove : toggle`);
a row that is excluded and not a candidate has `missing === false`, so pressing `p` on it creates a pinned
non-candidate that is **not** flagged missing. `delete` then sees `row.missing === false` and unpins it
(`:109-111`) instead of dropping it, leaving a row that is neither a candidate nor pinned nor excluded — a
ghost that only disappears on reopen.

**Failure scenario** (candidates `p/a p/b p/c`; settings `{ pinnedModels: [], excludedModels: ["gone/retired"] }`,
where `gone/retired` is not a candidate):

1. Open → `p/a[] p/b[] p/c[] gone/retired[X]`.
2. Cursor to `gone/retired`, press `p` → `p/a[] p/b[] p/c[] gone/retired[PX]`.
   Expected: `[P X M]` (it is pinned and matches no candidate). Got: `[PX]` — no `missing` tag.
3. Press `x` → `gone/retired[P] p/a[] p/b[] p/c[]`. It now leads the chain and renders as a **healthy pin**
   with no `missing` tag, though it matches no candidate; `editorSettings` writes
   `pinnedModels: ["gone/retired"]` (`fallback-editor.ts:122`), which `applyChainSettings` then silently ignores
   (`chain-order.ts:14-15`).
4. Ghost path: from the same start, `x p d d x` → `p/a[] p/b[] p/c[] gone/retired[]` — a non-candidate row
   with no flags at all, which `editorSettings` drops, so it vanishes on reopen
   (`initialEditorState` returns `p/a p/b p/c`).

Impact: the TUI renders the wrong tag set (README:232-236 promises a stale pin "is kept and drawn as `missing`"),
and `p`/`d` lose their documented semantics on stale pins for the rest of the session.

**Suggested fix.** Recompute `missing` after every mutation. `original` already holds the candidate labels,
so in `changed` (and in the `pin` arm) map rows through a helper, e.g.
`missing: entry.pinned && !original.includes(entry.label)`. That also fixes the ghost row, because a
non-candidate can never end up with all three flags false.

## H2 (Medium) — label validation accepts labels that can never match a candidate

**Where:** `extensions/aaii-router/settings.ts:250-255` (the `pinned`/`models` arm of `editSetting`),
relying on `parseList` at `:196-200`.

**Defect.** The check is `slash <= 0 || left.trim() === "" || right.trim() === ""`. It trims to test
emptiness but stores the **untrimmed** label, and it never rejects whitespace inside a segment. `parseList`
splits only on `[,\n]` (`:198`) even though its docstring says "comma (or whitespace) separated", so a
space-separated list arrives as one token. The result is a label that is accepted, persisted, and shown, but
can never equal a `Candidate.label` (`provider/id`), so the exclusion/pin silently no-ops.

**Failure scenario** (probe output):

- `editSetting(DEFAULT_SETTINGS, "models", "openrouter/ claude, a/b c/d")` → `ok: true`,
  `excludedModels: ["openrouter/ claude", "a/b c/d"]`. Against candidate `openrouter/claude`,
  `applyChainSettings` returns it unchanged → the model the operator excluded still serves.
- `editSetting(DEFAULT_SETTINGS, "pinned", "p/a p/b")` → `ok: true`, `pinnedModels: ["p/a p/b"]`
  (one dead label, intended as two). Same for `"p/a\tp/b"`, `"p/a/"`, `"p //a"`.
- The editor then draws the dead exclusion with an `excluded` tag (its `missing` flag is false for
  non-pins), giving the operator confirming UI for an exclusion that does nothing.

The stated contract is "Labels are validated as `<provider>/<id>` (non-empty both sides)"
(contract:16), and the whole point of the boundary is that these keys "decide where requests go"
(`settings.ts:335-341`); a silently ineffective exclusion is exactly what validation must prevent.

**Suggested fix.** Reject any whitespace and require a real `provider/id`, e.g.
`!/^[^\s/]+\/\S+$/.test(label)` (this still allows nested ids such as `openrouter/anthropic/model`), or
normalise by trimming around the slash. Also fix `parseList`'s docstring, or split on whitespace so the
documented "space separated" input actually yields multiple labels. The existing test at
`settings.test.ts:193` does not catch this: `parseList` trims `"provider/ "` and `" /model"` before the
validator sees them, so those cases only re-test `"provider/"` and `"/model"`.

## H3 (Medium) — `pipelinePreview` includes `missing` rows, so it is not the request order

**Where:** `extensions/aaii-router/fallback-editor.ts:128` (`filter((row) => !row.excluded)` only).

**Defect.** The contract (`:60`) and two in-repo docs (`README.md:231` "the order a request would take,
exclusions already skipped"; `fallback-tui.ts:135-136` "the order the next request would take") say the
preview equals what the router will run. But `applyChainSettings` drops pins that match no candidate
(`chain-order.ts:14-15`), while `pipelinePreview` keeps `missing` rows.

**Failure scenario:** candidates `p/a p/b`, settings `pinnedModels: ["gone/x"]`.
`pipelinePreview(state, 100)` → `"gone/x → p/a → p/b"`, but the actual request order is `p/a → p/b`.
The operator sees a nonexistent model leading the chain.

**Suggested fix.** Also skip `row.missing` in the preview (`filter((row) => !row.excluded && !row.missing)`),
or reword the contract/README to say the preview shows the *draft* including not-yet-available pins.

## H4 (Low) — `d` on a row with no pin arms a misleading prompt and then no-ops

**Where:** `extensions/aaii-router/fallback-editor.ts:105-108`.

**Defect.** The arm branch runs before the "nothing to remove" guard, so it offers to remove a pin that
does not exist; the confirmation then does nothing (`:108` returns `clean`), so the operator gets a prompt
they cannot satisfy.

**Failure scenario:** fresh editor, cursor on the unpinned `p/a`. Press `d` → status
`"press d again to remove the pin on p/a"` (`armed: true`). Press `d` again → rows unchanged, `dirty: false`,
`armed: false`; nothing was removed and nothing was reported.

**Suggested fix.** Guard first: `if (!row.pinned && !row.missing) return { state: clean };` (or return a
`"no pin on <label>"` status) before arming.

## H5 (Low) — cursor is out of range after the last row is removed

**Where:** `extensions/aaii-router/fallback-editor.ts:75` (`Math.max(0, Math.min(state.cursor, ordered.length - 1))`).

**Defect.** When the removed row was the only row, `ordered.length - 1 === -1`, so the clamp yields `0`
while `rows` is empty — `rows[cursor]` is `undefined`. The reducer guards this (`if (!row)`), but the
contract presents `cursor` as the cursor index and the TUI worker indexes `rows` by it.

**Failure scenario:** candidates `[]`, `pinnedModels: ["gone/x"]`; press `d d` → `rows.length === 0`,
`cursor === 0`, `rows[0] === undefined`. (Deleting a missing row in the middle is fine; only the empty
case is off.)

**Suggested fix.** Make the empty case explicit, e.g. `ordered.length === 0 ? 0 : clamp(...)`, and assert
in a test that a reducer that returns zero rows returns `cursor === 0`. (Consumers must still tolerate
`rows[cursor] === undefined`.)

## H6 (Low) — `editorSettings` canonicalises `excludedModels` order

**Where:** `extensions/aaii-router/fallback-editor.ts:122-123`.

**Defect.** `excludedModels` is emitted in row order (excluded rows are grouped last and re-sorted by
original rank), not in the input order, so `editorSettings(initialEditorState(c, s), s)` is not deep-equal
to `s` for an out-of-order input list. The *editor state* round-trip
`initialEditorState(c, editorSettings(initialEditorState(c, s), s))` **is** stable (verified across the
cases in the probe, including pinned+excluded, missing, and duplicate labels), so this is a file-order
cosmetic issue, not a data loss.

**Failure scenario:** `excludedModels: ["absent/z", "p/b"]` → open → save rewrites the file to
`["p/b", "absent/z"]`.

**Suggested fix.** If order is meaningless for exclusions, document that save canonicalises it; otherwise
preserve the input order (append newly-excluded labels rather than re-deriving from rows).

## H7 (Low / risk) — `keyFor` cannot distinguish a lone `\x1b` from an arrow prefix by itself

**Where:** `extensions/aaii-router/fallback-editor.ts:138-148`.

**Defect.** `"\x1b"` maps to `cancel` and `"\x1b[A"` / `"\x1bOA"` map to `up`, using exact string equality.
The function is correct **given** the whole escape sequence arrives in one `data` string (the TUI calls
`keyFor(data)` on each input chunk, `fallback-tui.ts:113`). If Pi ever delivers input byte-by-byte or
splits a sequence, the leading `"\x1b"` is consumed as cancel and an arrow press closes the editor instead
of moving the cursor. Unlike `picker.ts`, which routes cancel/up/down through
`getKeybindings().matches(...)` / `matchesKey` (`extensions/coding-fallback/picker.ts:69-85`), this layer
does its own raw matching, so it also ignores the user's configured cancel binding.

**Failure scenario (if chunked):** pressing `↑` on a byte-streaming input yields `keyFor("\x1b") === "cancel"`
on the first chunk → `effect: "close"`, discarding the editor.

**Suggested fix.** Have the TUI consume a complete escape sequence (or use `matchesKey`) before calling
`keyFor`, and/or ignore a lone `"\x1b"` while a partial CSI sequence is pending. At minimum, document the
"one whole sequence per call" precondition on `keyFor`.

## H8 (Info) — test gaps

- No test presses `p` on an excluded non-candidate, which is what exposes H1.
- No test asserts the empty-row cursor after a delete (H5); the "empty editors" test builds from `[]`
  candidates, never empties a non-empty list.
- No test exercises the stated stability property `initialEditorState(c, editorSettings(initialEditorState(c, s), s))`;
  `fallback-editor.test.ts:101` only checks `editorSettings(initialEditorState(c, s), s) === s` for one crafted `s`.
- The whitespace cases in `settings.test.ts:193` are neutralised by `parseList`'s trim, so H2 is untested.
- README:236 documents `p` on a `missing` row removing the pin; no test covers it (the code does this at
  `fallback-editor.ts:97-99`).

---

## Verified correct (checked against the contract, no finding)

- **Names / signatures / semantics** match the contract (`:22-24`, `:33-62`): `applyChainSettings`,
  `initialEditorState`, `reduceEditor` (`{ state, effect? }`), `editorSettings`, `pipelinePreview`, `keyFor`,
  and the `EditorRow` / `EditorState` / `EditorKey` shapes (including `"other"`).
- **`chain-order.ts`**: exclusions drop before pins (`:9-10`), pins lead in `pinnedModels` order, duplicates
  and unknown labels are ignored (`:13-18`), the rest keep incoming order (`:19`). Exclusion beats a pin
  (`chain-order.test.ts:18`). Verified.
- **moveUp/moveDown "pins the row and every row above it"** (`fallback-editor.ts:87-94`): after the adjacent
  swap, `index <= to` is exactly the moved row plus every row above its new position; excluded rows block the
  move (`:90`), boundary moves are no-ops that leave `dirty` unchanged (`:39`, `:41`). Probes matched the
  expected orders and pin masks. Verified.
- **Double-tap `d` and dirty `q`** (`:81-83`, `:103-108`): first press arms with a message; second executes;
  `clean` (`:70`) disarms on `other`, movement, and save; `q` closes immediately when clean and re-arms
  otherwise. Verified.
- **Excluded rows sort last** (`orderedRows`, `:41`) including after toggle (`fallback-editor.test.ts:72-81`).
  Verified.
- **`editorSettings` round-trip / state stability** — the state from `editorSettings` reproduces bit-for-bit
  (only H6's file order differs). Verified across pinned+excluded, missing, duplicates, and empty lists.
- **`PROJECT_KEYS`** excludes `pinned`/`models` (`settings.ts:342`); `SETTING_KEYS`, `SETTINGS`, `copyField`,
  `serializeSettings`, `describeSettings`, and the env vars (`PI_AAII_ROUTER_PINNED`,
  `PI_AAII_ROUTER_EXCLUDE_MODELS`) all match the contract table (`:10-18`). Verified.
- **`pipelinePreview` width math** (`:127-135`): counts code points, so the multi-byte arrow `→` (U+2192, one
  code point) counts as 1; output length is always `<= width` for widths 0..11 (`width 0 → ""`, `1 → "…"`,
  `7 → "p/a →…"`, `9 → "p/a → p/c"`). `trimEnd` can only shorten, never overflow. Verified. (Display width
  for CJK/emoji labels is out of scope; ids are effectively ASCII.)

## Test run

`node --test extensions/aaii-router/*.test.ts` (run mid-review, before the TUI worker's files landed):
**tests 49, pass 49, fail 0** — chain-order 2, fallback-editor 10, settings 15, candidates 11, cooldown 11.
Re-run at the end of the review with `fallback-tui.test.ts` present: **tests 61, pass 61, fail 0**
(`fallback-tui` 12). No failures; the H1/H2/H5 defects all sit outside the assertions the tests cover.

## Verdict rationale

The happy path (editor-driven pins/exclusions/reorders with well-formed labels) is solid: chain order,
the move rule, both double-tap rules, excluded-last ordering, `PROJECT_KEYS`, the env/round-trip plumbing,
and the preview width math all conform. But H1 is a real model-invariant break reachable by an ordinary key
(`p` on a stale excluded row) that makes the editor display a nonexistent model as a healthy pin and changes
what `d` does, and H2 lets the very validation that is supposed to guard "where requests go" accept labels
that silently do nothing. Both warrant a fix before shipping, with the small H4/H5 cleanups alongside.

VERDICT: fix-first
