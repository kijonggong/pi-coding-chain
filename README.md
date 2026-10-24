# pi-coding-chain

Pi extensions for a **coding model chain** — the same order and the same
fail-over, whether a request goes through a LiteLLM proxy or straight from Pi.

| Extension | Command | Role |
|---|---|---|
| [`coding-fallback`](extensions/coding-fallback/README.md) | `/coding-fallback` | Compose the LiteLLM router config: `model_group_alias` and `fallbacks` are regenerated from `model_list`, ordered by AAII score, with a picker that registers a model on an upstream the config already has |
| [`aaii-router`](extensions/aaii-router/README.md) | `/aaii-router` | Register three virtual models under a `fallback` provider — `fallback/aaii` (full chain), `fallback/deepseek-v4.1-flash` and `fallback/glm-5.3-flash` (family-scoped) — that walk the same order inside Pi — no proxy, no `fallbacks` matrix |
| [`quota-providers`](extensions/quota-providers/README.md) | `/quota-providers` | Register the `monthly` and `credit` hosts as real Pi providers, which is what makes those tiers reachable as candidates |
| [`openrouter-catalog-filter`](extensions/openrouter-catalog-filter/README.md) | `/openrouter-catalog-filter` | Keep OpenRouter's catalog aligned with the remote one (independent of the chain) |

`aaii-router` and `quota-providers` import `coding-fallback`'s tier table
(`providers.ts`), score reader (`scores.ts`) and `model_list` parser
(`chain.ts`), so those three are one library and its consumers in one package.
`openrouter-catalog-filter` shares no code with them.

The chain's two sides share their inputs: one score snapshot
(`aaii-scores.json`), one quota-tier table, and one ordering policy (AAII score
descending, then the quota that replenishes soonest, then `provider/id`).
`coding-fallback` **feeds** LiteLLM's `fallbacks` matrix; `aaii-router`
**replaces** it. Pick one side or run both — they do not conflict, because the
Pi-side router leaves the proxy's origins out of its candidates.

## Install

```bash
pi install git:github.com/kijonggong/pi-coding-chain@main
```

## Commands

```
/coding-fallback                   report drift, unranked models, unclassified hosts
/coding-fallback check             the same, read-only
/coding-fallback sync              refresh the free-model listing, then rewrite the generated blocks
/coding-fallback add               the picker: choose an upstream, mark the models it serves
/coding-fallback add <model-id> <host-or-slug> [<group-name>]
                                   the same registration without the picker

/aaii-router                       list the candidates in order, with score, tier and cooldown
/aaii-router fallback              edit the chain: pin, exclude and reorder candidates
/aaii-router settings              open the settings window
/aaii-router set <key> <value>     write one setting without the window
/aaii-router reset                 write the default settings
/aaii-router next                  take the current candidate out for one cooldown window
/aaii-router reload                rebuild the list after a score or credential change

/quota-providers                   list the quota-tier providers this extension registers

/openrouter-catalog-filter         report the allowlist state and what decided it (status)
/openrouter-catalog-filter list    print the models the allowlist keeps
/openrouter-catalog-filter on|off  write the switch (the environment still wins)
/openrouter-catalog-filter reload  fetch the catalog again and reapply
```

## Tests

The tests run on Node's built-in runner with TypeScript type stripping and need
no network:

```bash
PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/*/*.test.ts
```

In PowerShell:

```powershell
$env:PI_OFFLINE='1'; $env:PI_CODING_FALLBACK_FREE_REFRESH='off'; node --test extensions/*/*.test.ts
```

Every test runs on fixtures in the system temp directory; none reads the live
LiteLLM config or skips when a file is absent. The Pi SDK is stubbed only at the
package boundary: `test-support/module-harness.ts` copies the real modules
beside the stub packages a test supplies, so no product code carries a
test-only path.

## Repository layout

```text
extensions/<name>/             one directory per extension, each with its README and tests
test-support/                  the shared module harness for tests that import the Pi SDK
docs/engineering-standard.md   the engineering standard changes are reviewed against
_research/                     review records: findings, dispositions, mutation checks
WORKLOG.md                     work log (Korean)
```
