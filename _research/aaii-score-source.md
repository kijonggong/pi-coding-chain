# AAII score source — can Artificial Analysis Intelligence Index scores be fetched programmatically?

**Research date:** 2026-10-13 (all URLs fetched and all HTTP code probes run on this date, UTC, from this workstation).
**Scope:** determine whether AAII scores for a fixed set of router model ids can be obtained in machine-readable form, read-only, without sign-up or scraping loops.
**Overall verdict:** A machine-readable source exists and is officially documented — a key-gated JSON API (`x-api-key`), whose **Free tier includes the Intelligence Index value per model** at 100 requests / 24 h. A no-key fallback also exists: a fresh MIT-licensed Hugging Face mirror (`evaleval/EEE_datastore`) that reproduces the index per model, currently ingesting the AA endpoint that is **retired 2026-11-04**. Neither source covers every id in the router list; 7 of ~25 ids have no upstream entry.

Evidence tiers used below: **[code/probe]** = live HTTP status or response observed in this run; **[official]** = page/document published by artificialanalysis.ai (or the mirror operator); **[secondary]** = third-party recap; **[inference]** = my reasoning over the above; **[UNCONFIRMED]** = not verified.

---

## Q1. What is "AAII"? What does the index measure, and when was it last revised?

**Finding 1.1 [official]** — "AAII" is the **Artificial Analysis Intelligence Index**, the headline composite index published by artificialanalysis.ai. Current version is **v4.3.2**, a composite of **10 evaluations**.
Source: https://artificialanalysis.ai/ (homepage, sidebar text) and https://artificialanalysis.ai/models — quotation:
> "Artificial Analysis Intelligence Index v4.3.2 incorporates 10 evaluations: AA-Briefcase v1.1, GDPval-AA v2.1, AutomationBench-AA, Terminal-Bench 4.0, SciCode, Humanity's Last Exam, GDP.pdf, CritPt, AA-Omniscience, AA-LCR v1.1"

**Finding 1.2 [official]** — The API docs independently state the same composition, and indicate the free API exposes this index as a headline field.
Source: https://artificialanalysis.ai/data-api/docs — quotation:
> "Currently included (v4.3.2, 10 evaluations): AA-Briefcase v1.1, GDPval-AA v2.1, AutomationBench-AA (partial score), Terminal-Bench 4.0, SciCode, AA-LCR v1.1, AA-Omniscience, HLE, GDP.pdf, CritPt"

**Finding 1.3 [official]** — What it measures, in AA's own wording: an overall capability/intelligence composite over named evaluations, plus derived cost-per-task; scores carry per-benchmark weights.
Source: https://artificialanalysis.ai/methodology — quotation:
> "Cost per Task: The weighted-average cost (USD) to complete one Artificial Analysis Intelligence Index task... weighted by the same per-benchmark weights the Intelligence Index uses"

**Finding 1.4 [UNCONFIRMED] — last-revision date.** I could not establish the calendar date on which v4.3.2 was published. The version string is current as of 2026-10-13 (Findings 1.1–1.2), and the homepage changelog shows evaluation-level updates dated "12 Oct" (AA-Briefcase v1.1, AA-LCR v1.1 carry "Updated" tags) — but no version-history page dated v4.3.2 was retrieved. `/methodology/intelligence-index` failed to render text twice (fetch tool error; raw HTML 15,139 bytes contained no `v4.` match). Treat "last revised: ≤ 2026-10-13, exact date unknown" as the safe statement.

**Finding 1.5 [inference]** — Since versioning is major.minor.patch with the note that "patch" is not reflected in the API field (see Finding 2.7), a client cannot detect a v4.3.1 → v4.3.2 patch bump from the API payload alone; only major.minor appear.

---

## Q2. Is there a public, documented API returning these scores as JSON?

**Answer: yes** — documented, JSON, key-gated, self-serve Free tier that includes the index. Not anonymous: every call requires an API key.

**Finding 2.1 [official] — base URL, auth, key scope.**
Source: https://artificialanalysis.ai/data-api/docs — quotations:
> "Base URL: https://artificialanalysis.ai/api/v2"
> "Authentication: pass your API key in the x-api-key header"
> "Keys are scoped to an organization"

**Finding 2.2 [code/probe] — the API is live and key-gated.** Observed in this run:
```
curl -s -i https://artificialanalysis.ai/api/v2/data/llms/models
HTTP/1.1 401 Unauthorized
{"error":"API key is required"}
```
Headers on that response included: `Deprecation: @1785801600`, `Sunset: Wed, 04 Nov 2026 23:59:59 GMT`, `Link: <https://artificialanalysis.ai/data-api/migrate-v2-data>; rel="deprecation"`. `1785801600` = **2026-08-04 00:00:00 UTC**. The new free path `GET https://artificialanalysis.ai/api/v2/language/models/free` likewise returns `401` with the same body; its existence (rather than 404) is confirmed by the matched-path header and by the migration page (Finding 2.5).

**Finding 2.3 [official] — exact endpoints and what each tier returns.**
Source: https://artificialanalysis.ai/data-api/docs — tier table quotations:
> "Free — The public language models endpoint with headline indices, Capability Indexes, median performance, and input/output pricing... Other language model endpoints return a `403` subscription error"
> "Pro — ...model detail, full pricing (including blended), performance percentiles, and pro-only media endpoints"
> "Commercial — provider-level data, performance over time (7/30/90-day), measurement exports" (provisioned manually)

Effective URLs after the migration (Finding 2.5): Free = `GET https://artificialanalysis.ai/api/v2/language/models/free`; Pro = `GET https://artificialanalysis.ai/api/v2/language/models`; legacy = `GET https://artificialanalysis.ai/api/v2/data/llms/models` (sunset).

**Finding 2.4 [official] — response shape of the Free endpoint.** From the docs' field list and example payload: top-level `tier`, `intelligence_index_version` (major.minor only), `pagination` (page_size 200), and `data[]` entries containing `id`, `name`, `slug`, `release_date`, `model_creator`, `evaluations` (headline indices: Intelligence, Coding, Agentic, plus six Capability Indexes), `artificial_analysis_intelligence_index_cost`, `pricing` (input/output), `performance`. Example field from the docs:
> "artificial_analysis_intelligence_index": 24.5

The Free tier **excludes** the full evaluation set, token counts, blended pricing, percentiles, context window, parameters, modalities, licensing, and provider detail; nulls mean "not measured".

**Finding 2.5 [official] — migration and sunset.** Legacy `/api/v2/data/*` is being retired; the free/Pro replacements are the `language/models` paths.
Source: https://artificialanalysis.ai/data-api/migrate-v2-data — quotations:
> "Test the updated integration, then deploy it before November 4, 2026. After the retirement date, legacy requests will return `410 Gone` with a link to this guide."
> (table) legacy `/api/v2/data/llms/models` → Free `/api/v2/language/models/free`, Pro `/api/v2/language/models`

**Finding 2.6 [official] — rate limits (new docs).**
Source: https://artificialanalysis.ai/data-api/docs — quotations:
> "Free: 100 requests per 24-hour window", "Pro: 500 requests per 24-hour window", "Commercial: custom"
> headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-AA-Tier`; `Retry-After` on 429

**Finding 2.7 [official] — version semantics in payload.**
Source: https://artificialanalysis.ai/data-api/docs — the `intelligence_index_version` field carries major.minor only (e.g. `4.1`); patch bumps "are not reflected in intelligence_index_version" (as previously observed on this page).

**Finding 2.8 [official] — cost.** Free tier: "Get a free API key" (no card stated); Pro tier priced at **$417/month per seat** ("Save $984 with yearly billing"); Enterprise custom.
Sources: https://artificialanalysis.ai/data-api and https://artificialanalysis.ai/pricing — quotations: "Free — Get a free API key... Internal use only; no redistribution"; "Pro — Unlock full model-level data and benchmark scores"; "For data redistribution or external use, contact us."

**Finding 2.9 [official] — licence/attribution.** Source: https://artificialanalysis.ai/data-api/docs — quotation:
> "Use of the API requires attribution across all tiers"
plus: use is subject to AA's Terms of Use and Data Platform Terms; redistribution needs contacting AA. (Free tier page adds "Internal use only; no redistribution".)

**Finding 2.10 [UNCONFIRMED] — live response body.** No API key was obtained (user forbade sign-up), so the Free-tier payload and the Pro payload were not observed live in this run; the response shape above rests on the official docs page plus the observed 401 envelope. The docs page advertises a downloadable OpenAPI spec ("Download spec"), but well-known candidate paths `https://artificialanalysis.ai/api/v2/openapi.json` and `https://artificialanalysis.ai/openapi.json` both returned **404** in this run, so the exact spec URL is unconfirmed.

### Conflicts inside AA's own materials (reported, not reconciled)

**Conflict A [official vs official]** — Chart captions across https://artificialanalysis.ai/ and https://artificialanalysis.ai/models render the string "No publicly available API", while https://artificialanalysis.ai/data-api/docs documents a public API and the live endpoint returns a structured 401 (Finding 2.2). The caption text is repeated site-wide; it may refer to something narrower (e.g. the chart data series rather than the index dataset), but that reading is [inference]. The API demonstrably exists; the caption is at best misleading.

**Conflict B [official vs official]** — Rate limits. https://artificialanalysis.ai/documentation (legacy docs, still live, describing `/api/v2/data/llms/models` with `evaluations.artificial_analysis_intelligence_index`, example `62.9`) states: "The API is rate-limited to 1,000 requests per day". The migrated docs page states Free = 100 per 24 h (Finding 2.6). Both pages are official. The newer, migration-aligned page is the safer basis; treat 100/day as the operative Free limit and 1,000/day as legacy-doc residue.

---

## Q3. If there is no public API — machine-readable alternatives (official downloads, third-party mirrors)

Since a documented API **does** exist, this section covers fallback/no-key options, which the user still needs for a snapshot/fixture.

### 3a. Official downloads

**Finding 3.1 [official]** — "Databook Download" is listed as a **Pro** feature on the pricing comparison; there is no anonymous official CSV/JSON bulk download found.
Source: https://artificialanalysis.ai/pricing — feature row "Databook Download" under Pro/Enterprise.

**Finding 3.2 [official, UNCONFIRMED detail]** — OpenAPI spec is offered on the docs page ("Download spec"); direct spec URLs 404 (Finding 2.10). Not retrievable without the docs-page link target.

### 3b. Third-party mirror — Hugging Face dataset `evaleval/EEE_datastore` (EvalEval Coalition / "Every Eval Ever")

**Finding 3.3 [official (mirror operator)] — location, contents, frequency, licence.**
Source: https://huggingface.co/datasets/evaleval/EEE_datastore — dataset card: **license: mit**; ~**728 MB**; subset path `data/artificial-analysis-llms/`; 170 commits; many per-creator `*cron` bots commit on a daily cadence. At research time the newest AA commits were timestamped 2026-10-13 (≈2 h before this run), commit title pattern:
> "cron: artificial_analysis 2026-10-13 (699 record(s))"

**Finding 3.4 [code/probe] — a mirror record carries the AAII value per model.** Raw record fetched in this run:
`https://huggingface.co/datasets/evaleval/EEE_datastore/raw/main/data/artificial-analysis-llms/deepseek/deepseek-v4-1-flash/fae1df55-3f39-48b5-9517-5ba265cc4fb0.json` (14,047 bytes) contains, verbatim:
```
"evaluation_result_id": "artificial_analysis.artificial_analysis_intelligence_index"
"score": 39.5
"raw_model_name": "DeepSeek V4.1 Flash (Reasoning"
"raw_model_slug": "deepseek-v4-1-flash"
"attribution_required": "true"
"cron_run_date": "2026-09-17"
```
It also carries `artificial_analysis.hle`, `artificial_analysis.scicode`, etc., and `retrieved_timestamp` (1789634173.8 → 2026-09-17). Cross-check: the live leaderboard displays "DeepSeek V4.1 Flash (max) | … | 39" — same model, leaderboard rounds to integer while the mirror keeps one decimal.

**Finding 3.5 [official (mirror operator)] — how the mirror is produced (and the risk this implies).** The record's own metadata names the **legacy** AA endpoint as the source:
> `"source_name": "Artificial Analysis LLM API"`, `"api_endpoint": "https://artificialanalysis.ai/api/v2/data/llms/models"`, `"cron_adapter": "artificial_analysis"`, `"cron_run_url": "https://github.com/evaleval/every_eval_ever/actions/runs/..."`
Repo: https://github.com/evaleval/every_eval_ever (schema_version 0.3.0; arXiv:2606.14516). Because that endpoint returns **410 Gone after 2026-11-04** (Finding 2.5), the mirror's daily refresh is expected to break unless the adapter migrates. **[UNCONFIRMED]**: whether upstream has already switched the cron to the new endpoint; not checked.

**Finding 3.6 [inference — licence tension]** — The mirror is MIT-tagged as a dataset, but the AA terms require attribution for API use and prohibit redistribution without agreement (Finding 2.9), and the record itself asserts `"attribution_required": "true"`. Shipping mirror-derived numbers inside a product needs AA attribution at minimum; MIT on the mirror does not waive AA's own terms. Use as an **internal snapshot**, attribute AA, and don't redistribute the dataset.

---

## Q4. Coverage of the specific router model ids

Existence probes on 2026-10-13. Method: `GET https://artificialanalysis.ai/models/<slug>` — `200` = model page (slug exists), `404` = absent; control slug `zzz-not-a-real-model-xyz` also 404, so 404s are meaningful. Mirror side: HF tree API and per-path requests; root listing of `alibaba` hit a 1000-entry cap, so per-path probes are the stronger evidence. Score column: best evidence captured in this run (leaderboard integer / mirror record / not captured).

| Router id | AA page slug | AA site | Mirror folder (`data/artificial-analysis-llms/…`) | Score evidence |
|---|---|---|---|---|
| `qwen3.8-max` | `qwen3-8-max` | 200 | `alibaba/qwen3-8-max` 200 | "Qwen3.8 Max (0902) | 984k | Alibaba | 45" (leaderboard) |
| `qwen3.8-max-0902` | `qwen3-8-max-0902` | **404** | `alibaba/qwen3-8-max-0902` **404**; but `alibaba/qwen3-8-max-0803` exists | leaderboard name "Qwen3.8 Max (0902)" probably = slug `qwen3-8-max` [inference] |
| `qwen3.8-flash-next` (implied by other ids) | `qwen3-8-flash-next` | 200 | `alibaba/qwen3-8-flash-next` 200 | "Qwen3.8-Flash-Next | 256k | Alibaba | 40" |
| `qwen3.8-flash-next-uncensored` | — | `experientiallabs` **404** | **404** | **missing** |
| `qwen3.8-flash-next-iq3_s` | `qwen3-8-flash-next-iq3_s` | **404** | **404** | **missing** |
| `z-ai/glm-5.3-flash` | `glm-5-3-flash` | 200 | `zai/glm-5-3-flash` 200 | "GLM-5.3-Flash | 1M | Z AI | 42" |
| `glm-5.2` | `glm-5-2` | 200 | `zai/glm-5-2` 200 | value not captured; "GLM-5.3 (max) | 45", "GLM-5.3 (low) | 34" |
| `glm-5.1` | `glm-5-1` | 200 | `zai/glm-5-1` 200 | value not captured |
| `deepseek-ai|deepseek/deepseek-v4.1-flash` (all suppliers) | `deepseek-v4-1-flash` | 200 | `deepseek/deepseek-v4-1-flash` 200 | mirror **39.5**; leaderboard "DeepSeek V4.1 Flash (max) | 39", "(non-reasoning) | 25" |
| `kimi-k3` | `kimi-k3` | 200 | `kimi/kimi-k3` 200 | "Kimi K3 (max) | 1.05M | Kimi | 44", "(low) | 30" |
| `kimi-k2.7-code` | `kimi-k2-7-code` | 200 | `kimi/kimi-k2-7-code` 200 | "Kimi K2.7 Code | 256k | Kimi | 26" |
| `qwen3.5-27b` | `qwen3-5-27b` | 200 | `alibaba/qwen3-5-27b` 200 | value not captured |
| `qwen3.5-35b-a3b` | `qwen3-5-35b-a3b` | 200 | `alibaba/qwen3-5-35b-a3b` 200 | value not captured |
| `qwen3.5-122b-a10b` | `qwen3-5-122b-a10b` | 200 | `alibaba/qwen3-5-122b-a10b` 200 | "Qwen3.5 122B A10B | 16" |
| `qwen3.5-397b-a17b` | `qwen3-5-397b-a17b` | 200 | `alibaba/qwen3-5-397b-a17b` 200 | "Qwen3.5 397B A17B | 18" |
| `qwen3.5-flash` | `qwen3-5-flash` | **404** | **404** | **missing** |
| `qwen3.5-plus` | `qwen3-5-plus` | **404** | **404** | **missing** |
| `qwen3.5-omni-plus` | `qwen3-5-omni-plus` | 200 | `alibaba/qwen3-5-omni-plus` 200 | "Qwen3.5 Omni Plus | 20*" (asterisk seen in captured text) |
| `qwen3.6-27b` | `qwen3-6-27b` | 200 | `alibaba/qwen3-6-27b` 200 | value not captured |
| `qwen3.6-flash` | `qwen3-6-flash` | **404** | **404** | **missing** |
| `qwen3.6-plus` | `qwen3-6-plus` | 200 | `alibaba/qwen3-6-plus` 200 | value not captured |
| `qwen3.6-max-preview` | `qwen3-6-max-preview` | **404** | **404** (mirror has `alibaba/qwen3-6-max`) | **missing as named**; possibly tracks `qwen3-6-max` [inference] |
| `qwen3.7-flash` | `qwen3-7-flash` | **404** | **404** | **missing** |
| `qwen3.7-plus` | `qwen3-7-plus` | 200 | `alibaba/qwen3-7-plus` 200 | "Qwen3.7 Plus | 25" |
| `qwen3.7-max` | `qwen3-7-max` | 200 | `alibaba/qwen3-7-max` 200 | value not captured |
| `qwen3.6-35b-a3b` (adjacent, checked) | — | — | `alibaba/qwen3-6-35b-a3b` 200 | "Qwen3.6 35B A3B | 18" |
| `qwen3.8 2.4T A95B` (leaderboard-only name) | — | — | — | "Qwen3.8 2.4T A95B | 40" |

**Missing from both sources as named (7 ids):** `qwen3.8-flash-next-uncensored`, `qwen3.8-flash-next-iq3_s`, `qwen3.5-flash`, `qwen3.5-plus`, `qwen3.6-flash`, `qwen3.7-flash`, `qwen3.6-max-preview`. Also unmapped as written: `qwen3.8-max-0902` (the AA site lists a model *named* "Qwen3.8 Max (0902)" but the slug `qwen3-8-max-0902` 404s while `qwen3-8-max` and `qwen3-8-max-0803` both exist).

**Structural notes for the router:**
- **Scores are model-level, not supplier-level.** All three DeepSeek V4.1 Flash router ids collapse to one AA slug (`deepseek-v4-1-flash`), with two variants upstream — `(max)`/reasoning (39.5 in the mirror; 39 rounded on the leaderboard) and `(non-reasoning)` (25). Per-reseller/provider breakdown is **Commercial tier only** (Finding 2.3), i.e. not obtainable free — and unnecessary if you treat them as one model.
- **Slug normalisation is mechanical** for the covered ids: dots→dashes, lowercase (`kimi-k2.7-code` → `kimi-k2-7-code`, `qwen3.8-max` → `qwen3-8-max`). Creator folder names on the mirror differ from provider branding: `zai` (not `z-ai`), `kimi` (not `moonshotai`), `alibaba` (not `qwen`). Verified by 404/200 probes.
- **Leaderboard display values are integers** and may differ from API/mirror precision (39 vs 39.5). Use the API value as the sort key, not the leaderboard integer.

---

## Q5. Practical recommendation

**Possible, but do it as "fetch with a bundled fallback snapshot".** A fully automated hand-free pipeline is achievable today but has three soft spots (key, sunset, rate limit), so pair the fetch with a checked-in snapshot.

1. **Primary: official API, Free tier.** `GET https://artificialanalysis.ai/api/v2/language/models/free` with `x-api-key`. It contains `artificial_analysis_intelligence_index` per model — enough for a score-ordered fallback chain. Free = 100 req/24 h; one daily fetch of paginated `data[]` (page_size 200) is far under quota. Attribute AA wherever scores surface (required across all tiers), keep it internal (no redistribution on Free).
2. **Fallback / offline snapshot.** Bundle the last successful API response (or a build-time extracted `slug → intelligence_index` JSON) in the repo. If the key is missing or AA returns 429/5xx, the router orders by the snapshot. A handful of daily-integer values for a hand-curated id list can also be maintained by hand, but the API makes that unnecessary for covered ids.
3. **No-key mirror, as snapshot source only.** `https://huggingface.co/datasets/evaleval/EEE_datastore` (path `data/artificial-analysis-llms/<creator>/<model>/<uuid>.json`, field `score` under `artificial_analysis.artificial_analysis_intelligence_index`) refreshes ~daily and needs no key — but it ingests the legacy endpoint that dies **2026-11-04** (Finding 3.5), so treat it as an occasional bootstrap, not the runtime path.
4. **Handle the gap explicitly.** For the 7 ids absent from both sources (`…-uncensored`, `…-iq3_s`, `qwen3.5-flash`, `qwen3.5-plus`, `qwen3.6-flash`, `qwen3.7-flash`, `qwen3.6-max-preview`), decide once: alias them to a sibling slug (e.g. `qwen3.6-max-preview` → `qwen3-6-max`), or exclude them from AAII ordering with a documented default rank. Do not invent scores.
5. **Add a mapping layer.** Router id → AA slug → score, with the slug-resolution check (404-vs-200) as a CI test like the probes in this report; unknown slugs order below known ones.

**Not recommended:** parsing leaderboard HTML pages (client-rendered; text extraction returned only chart boilerplate in this run), or scraping `/models/<slug>` pages (no numbers retrievable from static text; see Q4 method note).

---

## Appendix — evidence inventory

| Item | URL | Verified this run |
|---|---|---|
| Index definition + v4.3.2 | https://artificialanalysis.ai/ , https://artificialanalysis.ai/models | yes (text) |
| API docs (authoritative), tiers, rate limits, response shape, attribution | https://artificialanalysis.ai/data-api/docs | yes (text) |
| Migration + sunset | https://artificialanalysis.ai/data-api/migrate-v2-data | yes (text) |
| Legacy docs, 1,000/day claim | https://artificialanalysis.ai/documentation | yes (text) |
| Tier page (Free/Pro/Commercial) | https://artificialanalysis.ai/data-api | yes (text) |
| Pro price $417/seat, databook | https://artificialanalysis.ai/pricing | yes (text) |
| Methodology (Model/Provider/weights/cost-per-task) | https://artificialanalysis.ai/methodology | yes (text) |
| Leaderboard values | https://artificialanalysis.ai/leaderboards/models | yes (text, ~250 models listed) |
| Legacy endpoint live 401 + sunset headers | https://artificialanalysis.ai/api/v2/data/llms/models | yes (HTTP 401) |
| New free endpoint exists | https://artificialanalysis.ai/api/v2/language/models/free | yes (HTTP 401) |
| Mirror dataset (MIT, cadence) | https://huggingface.co/datasets/evaleval/EEE_datastore | yes (tree + raw record) |
| Mirror pipeline repo | https://github.com/evaleval/every_eval_ever | yes (linked from record) |
| Slug/per-path probes | (27 slugs + 12 mirror paths, see Q4) | yes (HTTP codes) |
| Index publication date | — | **UNCONFIRMED** |
| Live Free/Pro payload with key | — | **UNCONFIRMED** (no key) |
| Mirror health after 2026-11-04 | — | **UNCONFIRMED** |

No file other than this report was created or modified; `_research/litellm-runtime-baseline.md` was not touched.
