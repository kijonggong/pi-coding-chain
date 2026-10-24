# coding-fallback

A Pi extension that composes the fallback chains in a LiteLLM router config from
`model_list`, ordered by the Artificial Analysis Intelligence Index (AAII).

## The problem it solves

The LiteLLM config at `~/.pi/agent/litellm_config.yaml` declares a flat list of
model groups and then repeats them as a fallback matrix — 38 groups expanded into
472 lines. Every intermediate group needs its own copy of the remaining tail for
the chain to behave transitively, which is what makes the matrix long. Adding one
model or reordering the chain means editing hundreds of lines by hand.

## Ordering policy

Two generated blocks are rebuilt from `model_list`; every other byte of the file
is preserved.

| Block | Generated from |
|---|---|
| `model_group_alias` | the head of each chain |
| `fallbacks` | for each alias, the ordered remainder; for each group, everything after it |

The order is:

1. **AAII score, highest first.** A model the index does not cover has no place
   in a score-ordered chain, so it sorts after every scored model and is reported
   by name.
2. **Quota tier, when the score ties.** Two entries serving the same model share a
   score, and the tie goes to the allowance that replenishes soonest, because
   spending capacity that resets sooner costs less:

   | Tier | Hosts |
   |---|---|
   | `free` | `100.78.239.122` (self-hosted Strata) |
   | `daily` | `127.0.0.1` (local relay in front of Cline), `integrate.api.nvidia.com` |
   | `weekly` | `api.commandcode.ai` (DeepSeek V4.1 Flash only) |
   | `monthly` | `api.experientiallabs.ai` (GLM-5.3 Flash, with a coding model occasionally free on promo) |
   | `credit` | `dashscope-intl.aliyuncs.com` |

   A host that is not in the table is never treated as free: it sorts after every
   classified host and is reported.

   A model the free-model snapshot reports at zero input *and* zero output cost
   is `free` regardless of its host's standing tier. A price that is known to be
   nothing beats an assumption about an allowance, and it is the same tie-break
   rule with a better-informed tier in front of it.
3. Name, as a stable final tie-break.

This is visible in the DeepSeek V4.1 Flash group, which four suppliers resell at
the same score: NVIDIA and Cline (daily) come first, then CommandCode (weekly),
then ExpLabs (monthly).

## Free models

ExpLabs prices models at $0 from time to time. Usually that is not a new model
appearing but **an existing one getting cheaper**, which is precisely the case a
hand-written `model_list` cannot notice: the group is already there and correct,
and the tier table above classifies by *host* — so an ExpLabs model still reads as
`monthly` on the day it is free. This watches the listing instead:

```bash
node extensions/coding-fallback/fetch-free.mjs --dry   # preview the listing
node extensions/coding-fallback/fetch-free.mjs         # write the snapshot
```

The probe reads each upstream's own OpenAI-compatible `/models` endpoint with the
operator's key (`EXPLABS_API_KEY`), and the result is cached in
`free-models.json`. The cache is not an optimisation. A promo is transient — on
2026-10-14 ExpLabs published `ling-3.1-flash` at $0 in and $0 out and had
withdrawn it from the listing twelve hours later — so a read taken only when
someone happens to look would miss the window.

### Free is not the same as unpriced

The listing mixes shapes that all look like "costs nothing", and only one of them
is free:

| Shape | Treatment |
|---|---|
| `pricing` present, both meters exactly `0` | **free** — a candidate |
| no `pricing` object at all | **no-price** — a locked stub; recorded as excluded, never as free |
| one meter `0`, the other not | **partial-free** — a cheap direction, not a free model |
| embedding or other non-completions endpoint | **not-chat** — excluded |
| zero-priced but no context window published | **no-context-window** — excluded |

A locked stub is not hypothetical: a chat request against `qwen3-max`
answers `model_requires_purchase`. Treating its missing price as `$0` would wire a
group into the chain that fails on every call, so a missing price is recorded as
missing — the same rule `providers.ts` applies to a host absent from its table.

### What happens to a free model

Two cases, and the second is the usual one.

**The model already has a group.** Nothing is created. Its tier becomes `free`, so
it overtakes every other supplier of the same model. On the live config, flagging
`deepseek-v4.1-flash` as free moves `code-7-explabs-deepseek-v4.1-flash` from 11th
to 8th in the coding chain, ahead of NVIDIA, Cline and CommandCode, which resell
the same model at the same score. It does not become the head of the chain: score
still comes first, and 39.5 ranks below the Qwen3.8 Max group. That is the
existing rule, applied with a tier that is now known rather than assumed.

**The model has no group.** Then `sync` generates one, at the tail of
`model_list`:

```yaml
- model_name: code-free-explabs-ling-3.1-flash
  litellm_params:
    model: openai/ling-3.1-flash
    api_base: https://api.experientiallabs.ai/v1
    api_key: os.environ/EXPLABS_API_KEY
```

The `code-free-` name is also the prune marker. Generated groups are removed and
regenerated on every compose, so a promo that ends takes its group with it and no
one has to remember it was there. The three guarantees that keep this safe:

- **Hand-written entries are never touched.** A model that already has a group is
  reported as covered instead of gaining a second one, and no existing entry is
  added to, reordered, or removed.
- **Pruning is limited to hosts the snapshot speaks for.** A snapshot that is
  missing, malformed, or that failed to read a host must not look like "nothing is
  free any more". In that case `model_list` is left exactly as found and the
  command says so.
- **A failed probe never overwrites the snapshot.** An empty listing written after
  a network error would read as "the promo ended" and tear down a group that is
  still free.

The read is refreshed in the background at session start when the snapshot is
older than six hours — never awaited, so a session does not wait on the network —
and always refreshed immediately before a `sync`, because that is the moment the
decision is made. Set `PI_CODING_FALLBACK_FREE_REFRESH=off` to stop the extension
reading the network at all.

무료 스냅샷은 파일이 없을 때(ENOENT)만 없는 것으로 처리합니다. 권한·디렉터리 등 읽기 오류와
깨진 JSON은 경로와 이유를 보고하며, check/sync/add는 그 이유를 notice에 넣고 기존
`model_list`를 보존합니다. refresh는 이전 스냅샷 읽기 실패를
`could not read previous snapshot <path>: <reason>`으로 결과 메시지에 붙입니다.
원격 조회와 기존 임시 파일 쓰기·rename 절차는 계속 수행하며, dry run과 쓰기 실패에도
읽기 실패 이유를 함께 보고합니다. native quota catalog의 DashScope 제외 목록 host는
`DASHSCOPE.baseUrl`에서 계산해 주소 변경을 따릅니다.

## Scores

The index is published by [Artificial Analysis](https://artificialanalysis.ai) and
requires attribution wherever it surfaces. The extension reads `aaii-scores.json`
next to itself and never invents a value:

- A model with no entry sorts last and is listed in the command output.
- A model whose upstream has no entry of its own can be pointed at a sibling
  through the snapshot's `aliases` map. That is an explicit operator decision
  recorded in the file, not a guess made at run time.
- **`sync` refuses to write when the snapshot holds no scores at all**, because
  reordering a chain with nothing to rank by would replace a considered order
  with an arbitrary one.

One alias is recorded today: `qwen3.8-flash-next-uncensored` → `qwen3.8-flash-next`.
The index has no entry for the uncensored fine-tune, and nothing here measures the
fine-tune's own quality, so it carries the base model's 39.8. That is an inference,
which is why it lives in the file with its reason in `aliasNotes` rather than in
code — and why the effect is visible: the model moves from the end of the coding
chain to 8th of 14. Delete the alias to put it back. `qwen3.8-flash-next-iq3_s`
is the same situation and is deliberately **not** aliased; nothing measures that
quant either.

Refresh the snapshot with:

```bash
node extensions/coding-fallback/fetch-scores.mjs --dry   # preview
node extensions/coding-fallback/fetch-scores.mjs         # write
```

The script reads the keyless [EvalEval mirror](https://huggingface.co/datasets/evaleval/EEE_datastore),
which needs no API key. The official, documented source is
`https://artificialanalysis.ai/api/v2/language/models/free` with an `x-api-key`
header (free tier: 100 requests / 24 h) — preferred once a key exists, because the
mirror rebuilds from a legacy AA endpoint that retires on 2026-11-04. As of
2026-10-14 the `AA_API_KEY` in the environment does not authenticate (`401 Invalid
API key.`), so the mirror is what this repository can actually read.

A refresh regenerates `scores` but **carries `aliases` and `aliasNotes` forward**
from the file it is about to overwrite. The alias map is the one field written by
hand, and for a model the index does not cover it is the only route to a rank — a
refresh that reset it would quietly demote that model to the back of its chain.

## Commands

```
/coding-fallback          report drift, unranked models, unclassified hosts
/coding-fallback check    same as above
/coding-fallback sync     refresh the free-model listing, then rewrite the generated blocks
/coding-fallback add      the picker: choose an upstream, mark the models it serves
/coding-fallback add <model-id> <host-or-slug> [<group-name>]
                          the same registration without the picker
```

Anything else is reported as an unknown subcommand rather than falling through to
`check`, which is what a typo used to get.

A session start only reports drift — it never rewrites the file. `sync` copies the
config to a `.bak-<timestamp>` sibling only when the composed text differs, and
reports "nothing to do" otherwise, so a correct config is never churned and never
gains a stray backup.

`sync` reads the upstream listings before it composes, because a generated group
is a decision that has to be made from what the upstream says now. It reports
which models were added, which groups a finished promo took with it, and which
listing entries had no usable price and were therefore left alone.

| Variable | Effect |
|---|---|
| `PI_CODING_FALLBACK_CONFIG` | point at a different LiteLLM config |
| `PI_CODING_FALLBACK_SCORES` | point at a different AAII snapshot |
| `PI_CODING_FALLBACK_FREE` | point at a different free-model snapshot |
| `PI_CODING_FALLBACK_FREE_REFRESH=off` | stop the extension reading the network |

Applying a rewrite needs a LiteLLM restart. LiteLLM reads the config at startup,
and its runtime `/config/update` path requires an admin key, a database, and
`STORE_MODEL_IN_DB=True`, none of which this config sets. The extension therefore
does not restart the proxy for you; it reports that a restart is required.

## Adding a model

A model joins the chain by having a group in `model_list`, so registering one is
a single entry written by hand. The picker writes it:

```
/coding-fallback add
```

The model is chosen from a list, not typed. The list is the upstream's own answer
to what it serves, so anything marked is something that host says it has:

1. **The upstream**, chosen from the hosts `model_list` already carries. Its
   `api_base` and `api_key` line are copied verbatim, so the one mistake that
   would not survive review — a base URL the operator never configured — cannot be
   made here. A host whose own group names attest no slug
   (`code-7-qwen3.8-flash-next-iq3s` names no upstream) is asked for one rather
   than named after its hostname, which would put an invented word in a file
   someone has to read.
2. **The models**, marked from what that upstream lists. The listing is read at
   `/v1/models` under the `api_base` just chosen, with the same key line LiteLLM
   reads: `os.environ/NAME` takes that variable from the shell, a literal key is
   used as it stands, and a host with no key line is asked without one — which is
   what a local relay wants.

   | Key | What it does |
   |---|---|
   | typing | filters the list (fuzzy, the matcher Pi's own selectors use) |
   | ↑ ↓ | moves, wrapping at both ends |
   | space | marks or unmarks the row under the cursor |
   | enter | adds the marked rows, or the one under the cursor when none is marked |
   | esc | cancels, adding nothing |

   Marks survive filtering, so a model can be found, marked, and the filter cleared
   without losing it. What the host already serves is left out of the list and
   counted in the title instead; the same model on *another* host is still offered,
   because LiteLLM resolves by group and a second supplier of one model is the whole
   point of a fallback chain. A host that lists nothing this config does not already
   serve is reported as such rather than shown an empty list.

   When the listing cannot be read — a 401, a timeout, a gateway that answers
   something else — the fallback is **not** the score table. Its keys are Artificial
   Analysis' own slugs with the dots folded (`deepseek-v4-1-flash`), which is not
   what the host calls the model, and a group written from one fails on every call.
   The fallback is the ids this config already uses on its *other* hosts, whose
   spelling some upstream already accepts, and the title says which of the two lists
   is on screen — so a fallback list is never mistaken for the host's own answer. An
   id nobody uses yet is typed through the scriptable form, where the operator is the
   one who knows how the host spells it.
3. **The names**, claimed as `code-<n>-<slug>-<model>`, one number per model,
   numbered after the highest `code-<n>-` in the file. A number whose name is already
   taken is skipped, so a batch cannot collide with a group written by hand outside
   the numbering. The number has no meaning to the composer — the order is the
   score — which is why a batch never renames an existing group to fit.
4. **A confirmation**, showing the exact YAML lines (the first six of a long
   batch), the AAII score each entry will be ranked by, the host's standing quota
   tier, and which of the two lists the models came from.

Then the same write path as `sync`: every entry and the fallback blocks are written
in one pass, into one write, with the config copied to a `.bak-<timestamp>` sibling
first. One write for the batch rather than one per model, because a file that
briefly held a group outside the chains is a config no reader of it should see.

The picker is drawn through `ctx.ui.custom`, which belongs to the interactive TUI.
RPC and print sessions answer `undefined` for it, so `add` reports that the picker
needs the TUI and names the scriptable form — rather than opening nothing and
leaving the operator to guess.

Without a UI, or when the answers are already known:

```
/coding-fallback add <model-id> <host-or-slug> [<group-name>]
```

The second argument names the upstream by its slug (`nvidia`) or by its hostname
(`integrate.api.nvidia.com`); with one upstream in the config it may be left out.
A host whose names carry no slug has nothing to derive a name from, so the group
name is required there. The command asks for confirmation before writing whenever
it has a UI to ask with.

### What it refuses

Every refusal leaves the file byte-identical and the backup absent, so a refused
`add` cannot be mistaken for one that half-happened:

| Refusal | Why |
|---|---|
| the name is already in `model_list` | LiteLLM resolves a group by name; a second group is not a second supplier |
| the name does not match `code-<n>-…` | a group the composer does not match would be written and then ignored by every pass |
| the name starts with `code-free-` | that prefix belongs to the snapshot; reconciliation deletes those groups on the next compose |
| no AAII score is loaded | the guard `sync` already applies — ordering by quota tier alone replaces a considered order with an arbitrary one |
| the config cannot be composed | `check` reports the same reason; nothing is written |

The refusals are all-or-nothing for a batch as well: a model the file cannot take
stops the whole batch, and the report names every entry that was not added, so
"nothing was added" is never left ambiguous about what the confirmation agreed to.

`add` reads the free-model listing first, exactly as `sync` does, because the same
pass prunes the generated groups whose promo ended. Applying the write needs a
LiteLLM restart, like any other rewrite.

## Relationship to Pi's own retry

Pi retries a failed assistant turn on transient errors (overloaded, rate limit,
5xx) against the *same* model, and then gives up. It does not switch models. The
model-to-model failover lives entirely in LiteLLM: `fallbacks` runs after
`num_retries` is exhausted, walking the chain in order. The two do not overlap.

## Verification

```bash
node --test extensions/coding-fallback/*.test.ts
```

`chain.test.ts` covers composition and ordering on a synthetic score table, so the
tests do not depend on what the snapshot currently holds: score order, the tier
tie-break, unscored models ranking last, alias resolution, and the guarantee that
everything outside the two generated blocks is byte-identical on the live config.
No real AAII score is invented in the fixtures.

`config.test.ts` covers the write path on throwaway copies in the system temp
directory: the backup holds the pre-write text, the rewrite settles the drift, a
second sync is a no-op, an unreadable config is left alone, and an empty score
table stops the write. The live config is only ever read.

`register.test.ts` covers the registration rules themselves: the upstreams read out
of `model_list`, the slug a host's own names attest (and the absence of one), the
next free number, the model-id, slug and group-name checks, the entry as rendered
and where it lands, and the dialog text. Nothing in it touches a file.

`listing.test.ts` covers reading an upstream's `/v1/models`: the key resolved from
an `os.environ/` line or taken literally, the URL derived from `api_base`, and the
payload shapes endpoints actually return. The request path runs against a server
this file starts on the loopback interface, so the header sent, a 401 named as a key
that may not be in this shell, an empty listing, a timeout, and a body that is not
JSON are all real responses rather than stubbed ones. No test reaches the network —
the only host contacted is 127.0.0.1.

`catalog.test.ts` covers what the picker offers and what its keys mean: the ids a
host already serves read per host, the fallback list read from the config's other
hosts, deduplication and score ordering, the mark set, what enter means (the marks
in the list's order, or the row under the cursor, and a mark that is no longer
offered dropped), the numbers a batch claims, and the title that says which of the
two lists is on screen.

`picker.test.ts` covers the component: a row per candidate with its mark and rank,
typing that filters without disturbing the marks, space that marks and unmarks the
row under the cursor, enter that adds a mark the filter is hiding, a batch in the
list's order rather than the order it was marked, escape that adds nothing, and enter
on an empty list. The component imports the SDK and the repository ships no
`node_modules`, so the test copies the extension into a temp directory beside stub
packages for `pi-tui` and `pi-coding-agent` and drives the real component against
them with the byte sequences a terminal actually sends (`\x1b[B`, `\r`, `\x1b`,
`" "`).

`config.test.ts` also covers `add`: the entry and the backup are written in one
pass, the chain picks the new group up, an unranked model is reported and stays at
the back, a duplicate name and an uncomposable config are refused with the file
left byte-identical, and one write leaves the config settled. A batch is one write
with one backup whatever its size, a batch the file cannot take is refused whole
and names every entry it did not add, and two entries claiming one name write
neither.

`free-models.test.ts` covers the classification (a present price of zero is free,
a missing price is not, one zero meter on a non-chat endpoint is neither) and what
the chain does with the result: the group is generated, a second compose is
idempotent, an ended promo takes its group back out, a missing snapshot leaves
`model_list` exactly as found, a host the snapshot does not cover keeps its
groups, a hand-written group is never duplicated, and a zero price wins the
tie-break. No test asserts that any particular model is free today — the listing
that would say so is live and volatile — but one reads the real config to confirm
the generated block sits where it claims to.

## Limitations

- The tier table is a declaration, not a discovery. An upstream that changes its
  billing model needs the table edited.
- The mirror-backed fetch is a bootstrap. The official API is the durable path and
  is not implemented here, because it needs a key this repository does not hold.
- Models the index does not cover stay at the back of their chain. If that is the
  wrong place for one of them, alias it to a sibling in the snapshot or adjust the
  tier table.
- Only the two generated blocks are managed. `model_list`, `num_retries`,
  `timeout`, `allowed_fails`, `cooldown_time`, and `general_settings` are
  preserved as written.
- The tier override only reorders *within* a score tie. A zero price cannot lift
  a model above a better-scoring one, and a $0 model with no AAII entry of its own
  still sorts after every scored model. So a model that goes free and already has
  a group climbs to the front of its own suppliers — the `deepseek-v4.1-flash`
  case — while one with no score stays at the back. `code-1-explabs-qwen3.8-flash-next-uncensored`,
  one of only two ExpLabs groups in the live config, is unscored: if it goes to
  $0 it becomes reachable but last. Point it at a sibling through the `aliases`
  map in `aaii-scores.json` to give it a rank — the same explicit operator
  decision the snapshot already documents.
- The free-model snapshot is a cache, not a subscription. A promo that appears
  and ends between two refreshes is seen only if one of them landed inside it;
  run `fetch-free.mjs` directly to check without waiting for the six-hour window.
- Free is judged from the listing's own price, not from a live call. A model the
  listing prices at zero but the account cannot call (a locked stub that does
  publish a price) would still be wired in, because proving otherwise costs a
  request per candidate per refresh.
- Only the two `code-*` chains take generated groups. A free model on a host that
  serves the DashScope chain has no generated equivalent, because that chain
  matches `ds-` names and its members are one upstream's own catalog.
- The chain description embedded in the Pi-side `models.json` model `name` is not
  rewritten.
- `add` registers; it does not edit or remove. A group that is wrong is changed by
  hand and settled with `sync`, because a picker that can delete a group is a picker
  that can delete the wrong one.
- The picker needs the interactive TUI (`ctx.ui.custom`); RPC and print sessions are
  pointed at the scriptable form instead. The component's keys and rendering are
  tested against stubbed SDK modules, so what a real terminal draws — line wrapping
  on a narrow window, the row Pi highlights — is checked by using it, not by a test.
- `add` only registers on upstreams the config already has. A new provider is a new
  `model_list` entry with its own credentials, which is a deliberate edit to the
  file rather than another question in a picker.
- The number in `code-<n>-` is hand-assigned and means nothing to the composer —
  ordering is by score — so adding a group never renames an existing one. Two
  entries can therefore read `code-7-…` and `code-8-…` while ranking 9th and 3rd;
  `model_group_alias` and `fallbacks` are the answer to what the order is.

점수 파일과 경로: `scores.ts`가 모듈 상대 기본 경로와 `PI_CODING_FALLBACK_SCORES` 해석을 소유합니다. 파일이 없을 때(ENOENT)만 빈 점수표를 사용하며, 읽기 오류나 깨진 점수 파일은 경로와 이유를 보고합니다. check/sync/add는 이 오류가 있으면 백업이나 설정 쓰기를 하지 않고 거부하고, 모델 점수 조회도 실패를 전파합니다. fetch-scores는 기존 파일이 없을 때만 빈 별칭으로 시작하며, 읽기·JSON 오류 시 기존 파일을 보존하고 중단합니다. 건너뛴 원격 색인 레코드는 파일과 이유를 stderr에 기록합니다.

`providers.ts`는 URL의 hostname과 origin 정규화를 소유하며 잘못된 URL은 undefined로 반환합니다. 체인은 이를 미분류로, 라우터는 출처 없음으로 처리합니다. ExpLabs의 기본 API 주소는 무료 모델 probe 정의에서 소유하며 native quota catalog도 같은 값을 사용합니다.
