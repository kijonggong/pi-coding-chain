# pi-coding-chain

Pi extensions for a **coding model chain** — the same order and the same
fail-over, whether a request goes through a LiteLLM proxy or straight from Pi.

| Extension | Command | Role |
|---|---|---|
| [`coding-fallback`](extensions/coding-fallback/README.md) | `/coding-fallback` | Compose the LiteLLM router config: `model_group_alias` and `fallbacks` are regenerated from `model_list`, ordered by AAII score, with a picker that registers a model on an upstream the config already has |
| [`aaii-router`](extensions/aaii-router/README.md) | `/aaii-router` | Register `aaii/fallback`, a virtual model that walks the same order inside Pi — no proxy, no `fallbacks` matrix |
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
/aaii-router settings              open the settings window
/aaii-router set <key> <value>     write one setting without the window
/aaii-router reset                 write the default settings
/aaii-router next                  take the current candidate out for one cooldown window
/aaii-router reload                rebuild the list after a score or credential change

/quota-providers                   list the quota-tier providers this extension registers

/openrouter-catalog-filter         report the allowlist state and what decided it (status)
/openrouter-catalog-filter list    print the models the allowlist keeps
/openrouter-catalog-filter on|off  write the switch (the environment still wins)
```

## Tests

```bash
node --test extensions/*/*.test.ts
```

Two tests read the live LiteLLM config to prove the generated blocks match it;
they fail rather than skip when that file has been replaced by a config the
composer does not understand. Everything else runs on fixtures in the system
temp directory.
