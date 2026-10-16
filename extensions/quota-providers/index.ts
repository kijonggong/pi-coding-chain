/**
 * Pi extension: register the monthly and credit quota tiers as real providers.
 *
 * `aaii-router` can only route to models Pi itself can reach, so the two hosts
 * that only the LiteLLM proxy talked to — DashScope (credit) and ExpLabs
 * (monthly) — were invisible to it. This extension registers both, which makes
 * every tier in `coding-fallback/providers.ts` a possible candidate.
 *
 * The keys are read from the environment (`DASHSCOPE_API_KEY`,
 * `EXPLABS_API_KEY`) using the same `$NAME` interpolation `models.json`
 * supports. A missing variable is not an error here: Pi reports the provider as
 * unauthenticated, and the router drops its models rather than failing.
 *
 * Commands
 * --------
 *   /quota-providers    list what this extension registered, with limits
 *
 * Nothing is written to disk, and no existing provider is replaced: both ids
 * are new to Pi.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EXCLUDED_MODELS, PROVIDERS } from "./catalog.ts";
import type { ProviderSpec } from "./catalog.ts";

const COMMAND = "quota-providers";

interface RegisteredProviderModel {
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly input: readonly ("text" | "image")[];
  readonly cost: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number };
  readonly contextWindow: number;
  readonly maxTokens: number;
}

interface RegisteredProviderConfig {
  readonly name: string;
  readonly baseUrl: string;
  readonly api: ProviderSpec["api"];
  readonly apiKey: string;
  readonly models: readonly RegisteredProviderModel[];
}

/**
 * Project the catalog onto the shape `pi.registerProvider()` accepts. Listing
 * fields explicitly keeps a catalog change from silently inventing a provider
 * field Pi does not understand.
 */
export function providerConfig(spec: ProviderSpec): RegisteredProviderConfig {
  return {
    name: spec.name,
    baseUrl: spec.baseUrl,
    api: spec.api,
    apiKey: `$${spec.apiKeyEnv}`,
    models: spec.models.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: [...model.input],
      cost: { ...model.cost },
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    })),
  };
}

function humanTokens(tokens: number): string {
  return tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1000)}K`;
}

/** The body of `/quota-providers`, split out so it can be asserted without Pi. */
export function report(): string {
  const lines: string[] = [];
  for (const spec of PROVIDERS) {
    lines.push(`${spec.id}: ${spec.models.length} models via ${spec.baseUrl} (key from $${spec.apiKeyEnv})`);
    for (const model of spec.models) {
      lines.push(
        `  ${model.id} — ${humanTokens(model.contextWindow)} in, ${humanTokens(model.maxTokens)} out` +
          `${model.reasoning ? ", reasoning" : ""}` +
          `${model.cost.input === 0 ? "" : `, $${model.cost.input}/$${model.cost.output} per Mtok`}`,
      );
    }
  }
  for (const entry of EXCLUDED_MODELS) {
    lines.push(`excluded ${entry.id} (${entry.host}): ${entry.reason}`);
  }
  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  for (const spec of PROVIDERS) {
    pi.registerProvider(spec.id, providerConfig(spec));
  }

  pi.registerCommand(COMMAND, {
    description: "List the quota-tier providers this extension registers",
    handler: async (_args, ctx) => {
      ctx?.ui?.notify?.(report(), "info");
    },
  });
}
