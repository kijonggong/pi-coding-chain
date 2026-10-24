# aaii-router

A Pi extension that registers `aaii/fallback`, a virtual model that picks a
physical model from the providers this Pi already has credentials for, and steps
to the next one when a request fails. No LiteLLM proxy is involved, so it
replaces the `fallbacks` matrix rather than feeding it.

## The problem it solves

The LiteLLM config expresses fail-over as a `fallbacks` matrix: 38 groups
expanded into 472 lines, one copy of the remaining tail per intermediate group.
The chain has to be rebuilt by hand when a model is added, and the proxy is one
more process between Pi and the upstream. Pi can do this itself — its only
missing piece was a model that answers with a different model per request.

Pi's own automatic retry is not a substitute: it re-sends the *same* model and
then gives up. Model-to-model fail-over is what this extension adds.

## Ordering policy

Pins come first. With `pinned` set, the labeled models lead the chain in the
order the operator wrote, and everything the operator did not touch keeps the
order below. A model named in `models` is dropped from the chain without
excluding the rest of its provider. Both lists are edited in
`/aaii-router fallback`, below.

The rest of the order is the same one `coding-fallback` writes into the LiteLLM
config:

1. **AAII score descending.** A model the index does not cover sorts after every
   scored model. A score that has to be inferred from a sibling model is an
   operator decision recorded in `aaii-scores.json`'s `aliases` map, not a guess
   made at run time.
2. **Quota tier, when the score ties** — the allowance that replenishes soonest
   first (`free` → `daily` → `weekly` → `monthly` → `credit`).
3. `provider/id`, as a stable final tie-break.

Candidates are every chat model in Pi's catalog that has configured credentials,
minus the entries served through the LiteLLM proxy: routing to the proxy would
send the request back into the chain this replaces. `quota-providers` registers
the `monthly` and `credit` hosts as real Pi providers, which is what makes those
tiers reachable as candidates.

## Where the candidate list comes from

**The list of models is automatic. The inputs it is *ordered* by are not.**

| Input | Source | Automatic? |
|---|---|---|
| Which models are candidates | Pi's live registry for the session (`getModelsOfType("chat")`), filtered to the ones with configured credentials | **yes** — a key added in `auth.json` or `models.json` is a candidate on the next session start, or after `/aaii-router reload` |
| AAII scores | `aaii-scores.json`, read from disk; `retrieved` is printed by `/aaii-router` | no — refresh with `node extensions/coding-fallback/fetch-scores.mjs`. Nothing fetches it at run time |
| Quota tier per host | the table in `coding-fallback/providers.ts` | no — a declaration; a new host is `no tier` until the table is edited |
| Pins and per-model exclusions | the `pinned` and `models` settings, edited in `/aaii-router fallback` | no — an operator decision, applied on top of the score order |
| The `monthly` and `credit` provider catalogs | `quota-providers/catalog.ts`, 29 + 2 models written by hand with their sources | no — a model an upstream publishes tomorrow is not discovered |

Three consequences worth knowing before trusting the order:

- **A missing score snapshot is not an error.** Every candidate is then
  `unranked`, and the order falls back to tier, then `provider/id`. The command
  says `no score snapshot` rather than ordering by something it invented.
- **The tier table is the policy, not a measurement.** It is what makes a
  `free` host outrank a `daily` one at the same score, and it only changes when
  a human changes it.
- **The free-model snapshot is not read here.** `free-models.json` moves groups
  in the LiteLLM composer only. On the Pi side an ExpLabs model that goes to $0
  keeps its `monthly` tier, so it does not climb past another supplier of the
  same model the way it does in the config. That is a real difference between the
  two sides of the migration, not a bug: this router orders by host tier, and the
  composer also knows a listing price.

The candidate list is built once per session and reused, because it is only
about what Pi has credentials for. `/aaii-router reload` rebuilds it after a
credential or catalog change.

## Failure memory

A failure does more than step the chain on: its model goes out for one cooldown
window, kept in the router state on the session branch, so the next turn does
not start by retrying what just failed. This is the rule the config on the other
side of the migration states as `cooldown_time: 300`.

| Signal | Remembered? |
|---|---|
| `rate-limit` — 429, quota, overloaded, capacity | yes |
| `auth` — 401, 403, invalid API key | yes |
| `error` — anything else the model answered | yes |
| `overflow` — context length or token limit | **no** — Pi compacts and retries, so the model did not fail |

An aborted turn is never remembered: that is the operator pressing ESC, and
benching a model for it would move the chain for the wrong reason. The
classification reads the error text, so it is a hint, not a contract.

Two rules keep a window from becoming a wall:

- A cooling candidate is skipped while an alternative exists, and taken anyway
  when it is all that is left, so the chain never reports "no model available"
  because of a cooldown.
- A window is bounded and pruned on every write, so the state a session carries
  does not grow.

The window is also what `/aaii-router next` uses to move the session off a model
that is degraded but not failing.

## Images

Pi substitutes placeholders for a model without image support, so a screenshot
sent to a text-only candidate is silently not seen. A request that carries an
image puts the candidates that can see it ahead of the ones that cannot. No
candidate is dropped: the chain stays as long as it was, and the score and tier
order still decides inside each group.

## Visibility

The footer shows the physical candidate the session is on and how many
candidates are cooling, for example `aaii → commandcode/Qwen3.8-Max · 2/9 cooling`.
The write is wrapped, because the status line is decoration and the route is
not: a UI that refuses the call cannot fail a request.

## Settings window

```text
/aaii-router settings
```

One entry per setting, each showing its current value, and a dialog per entry: a
confirmation for a toggle, a text field for a number or a list. Every answer is
validated before it is written — `soon` is refused in the dialog instead of
being stored and silently replaced by a default. `Reset to defaults` writes the
defaults back; `Done` (or Esc) closes the window. A value an environment
variable is holding is marked `(env)` in the list, because that is the one
source the window cannot write.

The same surface is available without a UI, which is what a script or a session
with no terminal uses:

```text
/aaii-router set cooldown 5m
/aaii-router reset
```

`set` validates the value the same way the window does, writes the global file,
and says so when an environment variable is overriding it in this session. It
requires a value, so emptying a list (`origins`, `providers`) is done in the
window, where an empty input is a value like any other.
`reset` asks for a confirmation when there is a UI and writes without one
otherwise, because typing the command is the confirmation. The command's
argument is also completed in the prompt: the subcommands first, the setting
keys after `set`, then the short value list for the settings that have one
(`on`/`off`, `5m`/`15m`/`1h`/`off`). A list setting offers no values: they come
from the operator's configuration, not from a table in the extension.

| Setting | Default | Environment |
|---|---|---|
| `cooldown` — how long a failed model stays out; `5m`, `300s` or `300000`, `0` disables | `300000` | `PI_AAII_ROUTER_COOLDOWN_MS` |
| `vision` — put candidates that can see an image ahead of ones that cannot | `on` | `PI_AAII_ROUTER_VISION` |
| `status` — footer line with the active candidate and the cooling count | `on` | `PI_AAII_ROUTER_STATUS` |
| `origins` — origins no candidate may use | the LiteLLM proxy | `PI_AAII_ROUTER_EXCLUDE_ORIGINS` |
| `providers` — providers to leave out of the chain, e.g. `openrouter` | none | `PI_AAII_ROUTER_EXCLUDE_PROVIDERS` |
| `pinned` — candidate labels to try first, in this order (`provider/id`) | none | `PI_AAII_ROUTER_PINNED` |
| `models` — candidate labels to leave out of the chain (`provider/id`) | none | `PI_AAII_ROUTER_EXCLUDE_MODELS` |

Settings are read from three sources, in this order:

| Source | File | Scope |
|---|---|---|
| global | `~/.pi/agent/aaii-router.json` (`PI_AAII_ROUTER_SETTINGS` points elsewhere) | every setting; this is what the window, the chain editor and `set` write |
| project | `.pi/aaii-router.json` under the session's working directory | `cooldown`, `vision`, `status` only |
| environment | the variables in the table below | every setting, and it wins |

Both files are written atomically through a temporary sibling, so a reader sees
the old file or the new one and never a half-written one.

**The project scope is a trust boundary, not a convenience.** A project may
change how the router treats the operator — how long a failure is remembered,
whether an image matters, whether the footer is drawn. It may **not** change
where a request goes: `origins`, `providers`, `pinned` and `models` are refused
there with a note, so a checked-out repository cannot take a supplier out of the
chain, add an origin to it, or pin a model of its choosing. A project file is
read at all only when Pi trusts the project
(`--approve` or a saved trust decision); when one is present and ignored, the
report says so rather than leaving the operator to wonder why it did nothing.
For an untrusted project, only the path's existence is checked; its contents
are never read. A directory at that path is ignored too. If the existence check
fails for a reason other than a missing path, the report includes that reason
and routing continues with global settings and environment overrides.
That is the same split `pi-star-router` documents for its own project file.

Two rules keep the files honest:

- **A value the router could not use is reported, never guessed.** `/aaii-router`
  prints `! ignored "cooldown": not a duration: soon` rather than quietly
  reverting to the default, and a bad environment override leaves the file's
  value in force.
- **An excluded provider is not a candidate even when it is authenticated.**
  That is the supported way to keep a reseller out of the chain without editing
  anything else.

The window needs an interactive session (TUI or RPC). Without one, the command
names the file and the environment variables to use instead.

## Fallback chain editor

```text
/aaii-router fallback
```

The chain order is automatic (score, then tier, then `provider/id`), and the
editor is how an operator overrides it without hand-editing JSON: one list of
the candidates, a preview of the order produced by the chain settings, and a draft
that is only written when it is saved.

```text
aaii-router fallback — ~/.pi/agent/aaii-router.json
openrouter/qwen3.8-max → commandcode/Kimi-K2 → dashscope/glm-5

▸ 1  openrouter/qwen3.8-max  AAII 41.8
  2  commandcode/Kimi-K2  AAII 39.5  pinned
  3  dashscope/glm-5  no AAII score  excluded

↑/↓ move · J/K reorder · p pin · x exclude · d unpin
r reset · s save · q cancel
```

| Key | Action |
|---|---|
| `↑` `↓`, `k` `j` | move the cursor |
| `K` `J`, shift+arrows | move the row up or down; the rows it passes are pinned, because a pin is how an order is stored |
| `p` | pin the row under the cursor, or unpin it; on a `missing` row, explains that dropping goes through `d` |
| `x` | leave the row out of the chain, or put it back |
| `d` | take the pin out — press twice, any other key cancels; dropping a `missing` row goes only through `d` twice |
| `r` | clear every pin and model exclusion |
| `s`, `enter` | write the chain to the global settings file; stays open on failure so save can be retried |
| `q`, `esc` | close (Kitty protocol handled by the SDK; respects configured `tui.select.cancel` keybindings); a changed draft asks for a second press before it is discarded |

The preview line is the order produced by the chain settings (pins, exclusions),
before the per-request image adjustment, so an edit shows its effect before it is
saved. A pin that matches no candidate
is kept and drawn as `missing`: it is an operator decision about a model that is
momentarily absent (a provider out of credential, a catalog refresh), not a typo
to be silently dropped, and it starts working again when the model returns.
Pressing `p` on such a row explains that dropping goes only through `d` twice,
protecting absent pins from accidental deletion.

The draft is written to the global settings file, because pins and exclusions
decide where a request goes; a project file may not set them. The editor stays
open until persistence succeeds: if saving fails (e.g. permission denied or disk
full), the status line reports `save failed: <message>` and preserves the draft so
the save can be retried without re-entering edits. The file is re-read after the
save, so the next request uses the new order immediately. An environment
override (`PI_AAII_ROUTER_PINNED`, `PI_AAII_ROUTER_EXCLUDE_MODELS`) still wins
for the session; the editor flags active overrides on the header and status line
from the moment it opens rather than waiting until save.

In narrow viewports (below 30 columns), the editor switches to a compact footer
(`s save · q cancel`) so that critical exit and save keys survive truncation, and
places short badges (`[P]`, `[X]`, `[!]`) immediately after the label so row
status remains visible.

`ctx.ui.custom` is the interactive TUI's. In an RPC or print session the command
says so and names the scriptable form instead:

```text
/aaii-router set pinned openrouter/qwen3.8-max,commandcode/Kimi-K2
/aaii-router set models dashscope/glm-5
```

## Commands

```text
/aaii-router                      list the candidates in order, with score, tier and cooldown
/aaii-router fallback             edit the chain: pin, exclude and reorder candidates
/aaii-router settings             open the settings window
/aaii-router set <key> <value>    write one value without the window
/aaii-router reset                write the default settings
/aaii-router next                 take the current candidate out for one cooldown window
/aaii-router reload               rebuild the list after a score or credential change
```

The argument is completed in the prompt (`Tab`), so the subcommands and keys do
not have to be remembered to be used.

| Variable | Effect |
|---|---|
| `PI_AAII_ROUTER_SETTINGS` | point at a different settings file |
| `PI_AAII_ROUTER_COOLDOWN_MS` | cooldown window; default `300000`, `0` disables the failure memory |
| `PI_AAII_ROUTER_VISION`, `PI_AAII_ROUTER_STATUS` | `on`/`off` (accepts `on`, `true`, `yes`, `1`, `enable`, `enabled` / `off`, `false`, `no`, `0`, `disable`, `disabled`) for the image order and the footer line |
| `PI_AAII_ROUTER_EXCLUDE_ORIGINS`, `PI_AAII_ROUTER_EXCLUDE_PROVIDERS` | comma separated lists, overriding the file |
| `PI_AAII_ROUTER_PINNED`, `PI_AAII_ROUTER_EXCLUDE_MODELS` | comma separated `provider/id` lists for the chain order, overriding the file |
| `PI_CODING_FALLBACK_SCORES` | point at a different AAII snapshot (shared with `coding-fallback`) |

## What it deliberately does not do

The Pi ecosystem already has several fail-over extensions, and these are the
mechanisms in them that were considered here:

| Mechanism | Source | Decision |
|---|---|---|
| Cooldown / circuit breaker per model | `pi-router`, `@anierbeck/pi-model-dynamic-router`, LiteLLM `cooldown_time` | **adopted** — see above |
| Vision as a hard constraint | `pi-star-router` | **adopted, softened** — demoted instead of dropped, because Pi answers with placeholders rather than failing |
| Footer status of the active channel | `pi-router` (`via <channel>`), `@anierbeck` status line | **adopted** — see above |
| Manual step to the next model | `pi-model-switch`, `pi-cycle`, `@cad0p` `/cycle-model` | **adopted** as `/aaii-router next` |
| Prompt classification → model tier | `@anierbeck`, `pi-star-router` | no — the policy here is one score order, not per-prompt tiers |
| Backoff between switches | `@cad0p` (`PI_FALLBACK_DELAY_MS`) | no — a switch inside `route()` is not a retry loop; a wait there is user-visible latency, and Pi's own retry already paces the request |
| Rotating `auth.json` account slots | `@cad0p` | no — it needs alias-provider registration and a model cache, and it rotates accounts rather than applying the quota order |
| Rerouting a compaction summary to a cheaper model | `pi-router` `summaryModel` | no — `reason: "direct"` covers compaction summaries and extension calls alike, and a silent downgrade of either is not this router's call |
| Ranking by a coding-specific benchmark column | `@anierbeck` `score_by`, `pi-better-models` | not yet — it needs a second score table; the snapshot here carries the composite index |

## Verification

```bash
node --test extensions/aaii-router/*.test.ts
```

`candidates.test.ts` covers selection and ordering on made-up scores: score
order, the tier tie-break, unranked models last, alias resolution, the proxy
exclusion, image detection and image ordering, and the step past a failed model.

`cooldown.test.ts` covers the failure memory with a literal clock: which signals
are remembered, that an abort and an overflow are not, pruning, that a window
ends exactly at its end time, that a cooling candidate is skipped while an
alternative exists and taken when it is the only one left, and the report text.

`settings.test.ts` covers the settings: the units a duration is written in, the
words a toggle is written in, origin normalization, one value refused at a time,
unknown keys and unreadable values reported rather than guessed, the environment
overriding the file (and a bad override leaving the file's value in force), the
project merge — a project key applied, a redirect key refused, and a project
file that names one key leaving the others as the global file left them — the
argument completions at each position, a written file read back unchanged, and
an atomic write that leaves no temporary behind. The file tests use a temp
directory, never the real one.

`chain-order.test.ts` covers the ordering rule on made-up candidates: pins lead
in the configured order, a pin that matches no candidate and a repeated pin are
ignored, the remaining score order survives, and an exclusion beats a pin and
leaves the other models from the same provider eligible.

`fallback-editor.test.ts` covers the draft without a terminal: the initial row
order (pins first, excluded last), cursor clamping, `J`/`K` reordering and the
pins it implies, unpinning back to score order, the double-tap rules for `d` and
for a dirty `q`, reset, and the settings a save writes.

`fallback-tui.test.ts` drives the component itself with key sequences and
asserts what it draws and what it resolves: the header, the preview line, the
`pinned`/`excluded`/`missing` tags, the footer and its armed messages, a save
returning the edited settings, a cancel returning nothing, and every line
clamped to the width it is given. Key handling uses the Pi SDK's `matchesKey`
and configured keybindings (`getKeybindings`). Legacy sequences and the Kitty
keyboard protocol are handled by the SDK; the component tests verify delegation
to configured cancel bindings using a simple stub, without testing SDK protocol
parsing or adding custom escape buffering.

Neither file asserts that any particular model is available today, and no test
invents a real leaderboard score. The end-to-end path — a session run against
`aaii/fallback` recording the physical model it routed to — is not covered by a
test, because it spends a request.

점수 경로는 coding-fallback의 `scores.ts`에서 가져오며 `PI_CODING_FALLBACK_SCORES`를 공유합니다. 점수 파일 없음(ENOENT)은 기존처럼 점수 없는 후보의 tier 순서를 허용하지만, 읽기 오류나 깨진 파일은 경로와 이유를 담은 오류로 registry 구성과 라우팅을 중단합니다. 이전의 조용한 tier 라우팅 대체 동작이 변경되었습니다. 설정 파일도 ENOENT만 없음으로 처리하며 다른 읽기 오류는 전파합니다. 깨진 설정 JSON은 기존 계약대로 note와 기본값을 사용합니다. URL 정규화는 coding-fallback/providers.ts를 공유하고, 설정 origin은 http(s)만 허용합니다. 상태 표시는 headless에서 no-op인 SDK UI 계약을 사용합니다.
