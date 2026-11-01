<div align="center">

# pi-coding-chain

**One model list. One fail-over chain. Zero proxy.**

[![Pi package](https://img.shields.io/badge/pi-package-7c3aed)](https://pi.dev/packages)
[![Tests](https://img.shields.io/badge/tests-292%20passing-16a34a)](#tests)
[![No dependencies](https://img.shields.io/badge/dependencies-0-16a34a)](package.json)
[![License](https://img.shields.io/badge/license-private-lightgrey)](#license)

*The same order and the same fail-over — whether a request goes through a
LiteLLM proxy or straight from [Pi](https://github.com/badlogic/pi-mono).*

</div>

---

Pick one model in Pi and stop thinking about which provider is up today.
This package registers **routing groups** as ordinary Pi models: each one
walks the models your Pi already has credentials for — ordered by the
[AAII index](https://artificialanalysis.ai) — and steps to the next candidate
when a request fails.

```text
you type ──▶ fallback/glm-5.3-flash          ← pick once in /model
                   │   1  nvidia/z-ai/glm-5.3-flash        AAII 41.8 · daily quota
                   │   2  river/zai-org/GLM-5.3-Flash      AAII 41.8 · monthly
                   │   3  zcode/GLM-5.3-Flash              AAII 41.8 · credit
                   ▼   … walk the order, skip what is cooling
             429 ✗ ──▶ next candidate ──▶ answer
```

No LiteLLM proxy, no `fallbacks` matrix, no hand-rebuilt chains. The candidate
list is **collected automatically** from Pi's live registry: add a key, and the
next session it is a candidate.

## Install

```bash
pi install git:github.com/kijonggong/pi-coding-chain@main
```

## The extensions

| Extension | Command | Role |
|---|---|---|
| [`aaii-router`](extensions/aaii-router/README.md) | `/aaii-router` | **The routing engine.** Registers `fallback/aaii` plus one virtual model per *group* — each group is a named filter over the collected candidates (a model family, by default) — and walks them with fail-over, cooldowns, distribution strategies and session affinity |
| [`coding-fallback`](extensions/coding-fallback/README.md) | `/coding-fallback` | The LiteLLM side: composes `model_group_alias` and `fallbacks` from `model_list`, ordered by the same score table |
| [`quota-providers`](extensions/quota-providers/README.md) | `/quota-providers` | Registers the `monthly` and `credit` quota hosts as real Pi providers |
| [`openrouter-catalog-filter`](extensions/openrouter-catalog-filter/README.md) | `/openrouter-catalog-filter` | Keeps OpenRouter's catalog aligned with a remote allowlist |

`aaii-router` and `quota-providers` import `coding-fallback`'s tier table,
score reader and `model_list` parser — one library and its consumers.
`openrouter-catalog-filter` shares no code. The two routing sides share their
inputs (one score snapshot, one quota-tier table, one ordering policy) and do
not conflict: pick one, or run both.

## What the router does

| | |
|---|---|
| **Automatic candidates** | Every chat model with configured credentials, minus excluded origins/providers and the router models themselves (`…/auto`, `group/…`) |
| **Fail-over per request** | Pi retries a failure; the router answers the retry with the *next* candidate. Pi's own retry only re-sends the same model |
| **Failure memory** | A failed model sits out one cooldown window; repeat failures stretch it, up to 4×, so one bad model cannot bench itself forever |
| **Groups** | Named family filters (`match: "glm-5-3-flash"`) that shrink the chain to the candidates serving that model — supplier prefixes, dated snapshots and `:free` variants all match |
| **Strategies** | `order` (the policy order), `free-first`, `rotate`, `least-used`, `manual` — globally, or per group |
| **Affinity** | `auto` (resume the remembered model), `session` (stay where failure moved you), `turn` (fresh turn starts at the head) |
| **`/aaii-router explain`** | Why the last request went where it went: the failed model, the cooling windows, the order considered |
| **Images** | A request with an image demotes candidates that cannot see it — demotion, not removal |

Full details — ordering policy, settings, the trust boundary for project
files, the chain editor — in the [`aaii-router` README](extensions/aaii-router/README.md).

## Quick start

```text
/aaii-router                 list the candidates in order, with score and tier
/model                       pick fallback/aaii (or a group) — once
/aaii-router explain         why the last request went where it went
/aaii-router next            bench the current model for one cooldown window
/aaii-router fallback        pin, exclude and reorder — a TUI chain editor
/aaii-router settings        strategies, affinity, cooldown, groups
```

Groups are data, not code — add one to `~/.pi/agent/aaii-router.json`:

```json
{
  "groups": [
    { "id": "glm-5.3-flash", "match": "glm-5-3-flash" },
    { "id": "qwen-coder", "match": "qwen3-coder", "strategy": "rotate", "affinity": "turn" }
  ]
}
```

Each entry becomes `fallback/<id>` in `/model`, walking only the candidates
its canonical family key matches. (`/reload` picks up a new group id; a
group's membership and strategy are re-read per request.)

## The ordering policy

One policy decides the walk, shared with the LiteLLM composer:

1. **AAII score** descending — a model the index does not cover sorts last
2. **Quota tier** on ties — the allowance that replenishes soonest first
   (`free` → `daily` → `weekly` → `monthly` → `credit`)
3. **`provider/id`** as the stable final tie-break

Operator pins lead the chain; exclusions win over pins. The score snapshot is
refreshed with `node extensions/coding-fallback/fetch-scores.mjs` — nothing
fetches it at run time, and a missing snapshot degrades to tier order rather
than inventing one.

## Tests

```bash
PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/*/*.test.ts
```

**292 tests, no network, no live config** — every test runs on fixtures in the
system temp directory. The Pi SDK is stubbed only at the package boundary; no
product code carries a test-only path. The engineering standard changes are
reviewed against lives in [`docs/engineering-standard.md`](docs/engineering-standard.md),
with review records in [`_research/`](_research/).

## Repository layout

```text
extensions/<name>/             one directory per extension: README, source, tests
test-support/                  the shared module harness for SDK-boundary stubs
docs/engineering-standard.md   the engineering standard changes are reviewed against
_research/                     survey, design, review and live-evidence records
WORKLOG.md                     work log (Korean)
```
