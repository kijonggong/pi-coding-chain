# quota-providers

A Pi extension that registers **DashScope International** and **ExpLabs** as
first-class Pi providers, so the monthly and credit quota tiers stop being
reachable only through the LiteLLM proxy.

## The problem it solves

Pi can only route to models it can reach itself, and `aaii-router` builds its
candidate list from those providers alone. Its ordering policy sorts by
Artificial Analysis Intelligence Index and then by the quota that replenishes
soonest:

| Tier | Host | Pi provider before this extension |
|---|---|---|
| `free` | `100.78.239.122` (self-hosted Strata) | `skyautonet-local` |
| `daily` | `127.0.0.1:28180` (freeflow/Cline relay), `integrate.api.nvidia.com` | `freeflow`, `nvidia` |
| `weekly` | `api.commandcode.ai` | `commandcode` |
| `monthly` | `api.experientiallabs.ai` | **none** |
| `credit` | `dashscope-intl.aliyuncs.com` | **none** |

Two of the five tiers had no Pi provider at all. `providers.ts` could classify
those hosts, and the LiteLLM config could reach them, but a `aaii-router`
candidate never could — 21 of the 38 groups in `model_list` are served from
those two hosts, including the coding chain's own head,
`code-1-explabs-qwen3.8-flash-next-uncensored`.

Registering both hosts makes every tier in the table a real candidate. Because
the tie-break is by tier, a model several suppliers resell still resolves in the
intended order: DeepSeek V4.1 Flash, for example, sorts NVIDIA and Cline (daily)
first, then CommandCode (weekly), then ExpLabs (monthly), then DashScope
(credit).

## Why an extension rather than `models.json`

Registering through `pi.registerProvider()` keeps the definition in this
package: versioned, reviewed, and testable without Pi running. It also leaves
`~/.pi/agent/models.json` — a hand-maintained file that already carries the
operator's own model entries — untouched. Both provider ids are new to Pi, so
nothing existing is replaced.

## Authentication

Keys are interpolated from the environment, exactly as `models.json` does it:

| Provider | Variable |
|---|---|
| `dashscope` | `DASHSCOPE_API_KEY` |
| `explabs` | `EXPLABS_API_KEY` |

A missing variable is not an error. Pi reports that provider as
unauthenticated, `hasConfiguredAuth()` returns false, and the router drops its
models instead of failing — the same behavior as any other unconfigured
provider.

## What it registers

`dashscope` — 29 chat models, text-in, quota-covered (cost reported as zero,
matching the rest of this configuration). The endpoint also resells third-party
models, which is why one provider carries Qwen, Kimi, and GLM ids.

`explabs` — 2 chat models. Unlike the other upstreams, ExpLabs publishes
per-token pricing rather than a metered allowance, so these entries carry the
endpoint's real rates ($0.30/1.20 per Mtok uncached for DeepSeek V4.1 Flash,
$0.15/0.47 for Qwen3.8 Flash-Next Uncensored) instead of zero.

## Where the limits come from

Limits are not guessed. Every entry records its source, and `catalog.ts`
documents the rules:

- **`endpoint`** — the provider's own `/models` response, read directly. Both
  ExpLabs entries use this; it publishes `context_window_tokens` and
  `maximum_output_tokens`.
- **`alibaba:<slug>`** — Alibaba's published model page at
  `help.aliyun.com/zh/model-studio/<slug>`.

Where Alibaba publishes the same limits for a dated snapshot as for its base
model, the snapshot carries the base model's figures.

### One deliberate deviation

Two Alibaba pages publish a maximum output equal to the entire context window
(`kimi-k3` and `kimi-k2.7-code`). That cannot be right — an output limit equal
to the input limit leaves no room for the prompt. Overstating `maxTokens` makes
the provider reject the request, while understating it only caps planned output,
so both entries take the smaller figure Pi's own catalog carries for the same
upstream model. `catalog.ts` exports `MAX_OUTPUT_CAVEAT` for it, and a test
keeps a later edit from pasting the published number back in.

## The one target it does not register

`ds-qwen3.6-max-preview` is in the LiteLLM config but is **not** registered
here. DashScope answers a chat request for it with:

```json
{"message": "Model not exist.", "type": "invalid_request_error", "code": "model_not_found"}
```

and omits the id from its `/models` listing. That LiteLLM group is therefore
dead on arrival — it fails before the fallback chain can help. The exclusion is
listed in `EXCLUDED_MODELS` with its reason, printed by `/quota-providers`, and
a test asserts that no config target is silently dropped: every upstream the
config sends to these two hosts is either registered or explicitly excluded.

## Commands

```text
/quota-providers    list what this extension registered, with limits
```

## Verify

`pi --list-models` should show `dashscope` (29 models) and `explabs` (2), and
`pi --list-models aaii` should still show `aaii/fallback`. Then run
`/aaii-router` and confirm the candidate list reaches tier 3 and tier 4 hosts.
