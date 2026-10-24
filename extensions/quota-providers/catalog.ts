/**
 * Provider catalog for the quota tiers Pi could only reach through LiteLLM.
 *
 * Pi's own provider list covers three of the five tiers directly: the
 * self-hosted Strata endpoint (free), the freeflow/Cline relay and NVIDIA
 * (daily), and CommandCode (weekly). The monthly (ExpLabs) and credit
 * (DashScope) tiers had **no Pi provider at all**, so `aaii-router` could never
 * build a candidate on either host — both tiers were reachable only by sending
 * the request through the LiteLLM proxy.
 *
 * This module is the data behind the two providers that close that gap, and
 * `index.ts` registers it with `pi.registerProvider()`. Registering here rather
 * than in `~/.pi/agent/models.json` keeps the definition reviewable, testable,
 * and versioned with the rest of this package.
 *
 * Sources
 * -------
 * Limits are not guessed. Each entry records where its numbers came from:
 *
 * - `endpoint` — the provider's own `/models` response, read directly.
 * - `alibaba:<slug>` — Alibaba's published model page for that model, at
 *   `help.aliyun.com/zh/model-studio/<slug>`.
 *
 * Where Alibaba publishes the same limits for a dated snapshot and its base
 * model, the snapshot carries the base model's figures and says so. Two limits
 * are deliberately *lower* than the published page: see `MAX_OUTPUT_CAVEAT`.
 */

import { EXPLABS_BASE_URL } from "../coding-fallback/free-models.ts";
import { parseProviderUrl } from "../coding-fallback/providers.ts";

/** Cost metadata shape Pi expects. */
export interface ModelCost {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export interface ModelSpec {
  readonly id: string;
  readonly name: string;
  readonly input: readonly ("text" | "image")[];
  readonly cost: ModelCost;
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly reasoning: boolean;
  /** Which document or endpoint established the limits above. */
  readonly source: string;
}

export interface ProviderSpec {
  /** Provider id Pi registers and shows in `/model`. */
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  /** Environment variable Pi interpolates for the request key. */
  readonly apiKeyEnv: string;
  readonly api: "openai-completions";
  readonly models: readonly ModelSpec[];
}

/**
 * Two Alibaba pages publish a maximum output equal to the whole context window
 * (`kimi-k3` and `kimi-k2.7-code`). That cannot be right: an output limit that
 * equals the input limit leaves no room for the prompt. Overstating `maxTokens`
 * makes the provider reject the request outright, while understating it only
 * caps planned output, so both entries take the smaller figure that Pi's own
 * catalog carries for the same upstream model.
 */
export const MAX_OUTPUT_CAVEAT =
  "Alibaba's page reports a maximum output equal to the context window; the smaller catalog figure is used instead.";

const ZERO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Alibaba's published page for a model, as a source string. */
function alibaba(slug: string): string {
  return `alibaba:${slug}`;
}

/** A DashScope chat model. Every one of these is text-in and quota-covered. */
function dashscope(id: string, contextWindow: number, maxTokens: number, source: string): ModelSpec {
  return {
    id,
    name: `${id} (DashScope)`,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow,
    maxTokens,
    reasoning: true,
    source,
  };
}

const QWEN35_DENSE = 262144;
const QWEN35_LARGE = 1000000;
const OUTPUT_SMALL = 65536;
const OUTPUT_LARGE = 131072;

/**
 * DashScope. Serves both Alibaba's own Qwen families and resold third-party
 * models (Moonshot's Kimi, Zhipu's GLM) under the same OpenAI-compatible
 * endpoint, which is why one provider carries three vendors' ids.
 */
export const DASHSCOPE: ProviderSpec = {
  id: "dashscope",
  name: "DashScope International (Alibaba Model Studio)",
  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  apiKeyEnv: "DASHSCOPE_API_KEY",
  api: "openai-completions",
  models: [
    dashscope("qwen3.7-max-2026-05-17", QWEN35_LARGE, OUTPUT_LARGE, alibaba("qwen3-7-max")),
    dashscope("qwen3.7-max-2026-06-08", QWEN35_LARGE, OUTPUT_LARGE, alibaba("qwen3-7-max")),
    dashscope("qwen3.7-max-preview", QWEN35_LARGE, OUTPUT_LARGE, alibaba("qwen3-7-max")),
    dashscope("qwen3.7-max-2026-05-20", QWEN35_LARGE, OUTPUT_LARGE, alibaba("qwen3-7-max")),
    {
      ...dashscope("deepseek-v4.1-flash-1017", 1048576, 393216, alibaba("deepseek-v4-1-flash")),
      input: ["text", "image"],
    },
    {
      // Catalog entry only: this model needs Realtime WebSocket/WebRTC/AOQ.
      // Pi's current openai-completions transport cannot invoke it.
      ...dashscope("qwen3.8-omni-flash-realtime", 196608, 65536, alibaba("qwen3-8-omni-flash-realtime")),
      name: "Qwen3.8 Omni Flash Realtime (DashScope; Realtime API required)",
      input: ["text", "image"],
      reasoning: false,
    },
    dashscope("glm-5.1", 204800, OUTPUT_LARGE, alibaba("glm-5-1-by-zhipu")),
  ],
};

/**
 * ExpLabs. Unlike the other upstreams in this configuration its pricing is
 * published per token rather than consumed from a metered allowance, so the
 * costs below are the endpoint's own figures and not zero.
 */
export const EXPLABS: ProviderSpec = {
  id: "explabs",
  name: "ExpLabs (Experiential Labs)",
  baseUrl: EXPLABS_BASE_URL,
  apiKeyEnv: "EXPLABS_API_KEY",
  api: "openai-completions",
  models: [
    {
      id: "glm-5.3-uncensored",
      name: "GLM-5.3 Uncensored (ExpLabs)",
      input: ["text"],
      cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      contextWindow: 1048576,
      maxTokens: 131072,
      reasoning: true,
      source: "endpoint",
    },
    {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek V4.1 Flash (ExpLabs)",
      input: ["text"],
      cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      contextWindow: 1048576,
      maxTokens: 393216,
      reasoning: true,
      source: "endpoint",
    },
    {
      id: "qwen3.8-flash-next-uncensored",
      name: "Qwen3.8 Flash-Next Uncensored (ExpLabs)",
      input: ["text"],
      cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 65536,
      reasoning: true,
      source: "endpoint",
    },
  ],
};

export const PROVIDERS: readonly ProviderSpec[] = [DASHSCOPE, EXPLABS];

const dashscopeUrl = parseProviderUrl(DASHSCOPE.baseUrl);
if (!dashscopeUrl) throw new Error(`Invalid DASHSCOPE.baseUrl: ${DASHSCOPE.baseUrl}`);

/**
 * Groups the LiteLLM config targets that this package deliberately does not
 * register, with the reason. Kept explicit so a later reader does not assume
 * the omission was an accident.
 */
export const EXCLUDED_MODELS: readonly { readonly id: string; readonly host: string; readonly reason: string }[] = [
  {
    id: "qwen3.6-max-preview",
    host: dashscopeUrl.hostname,
    reason:
      "the LiteLLM config routes code-... to it, but DashScope answers a chat request with " +
      '"Model not exist." (model_not_found) and its /models listing omits the id',
  },
];

/** Every model id a provider declares, in order. */
export function modelIds(provider: ProviderSpec): string[] {
  return provider.models.map((model) => model.id);
}
