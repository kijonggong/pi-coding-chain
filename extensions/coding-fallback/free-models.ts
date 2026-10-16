/**
 * Zero-priced models, read from an upstream's own model listing.
 *
 * Why this exists
 * ---------------
 * ExpLabs occasionally serves a coding model at $0 on promotion. Nothing else in
 * this configuration notices that: the LiteLLM `model_list` is hand-written, so a
 * promo model simply never appears in the chain, and `providers.ts` classifies by
 * *host*, so an ExpLabs model is `monthly` even on the day it is free.
 *
 * The listing is volatile — observed here, `ling-3.1-flash` was published at $0 in
 * and $0 out early on 2026-10-14 and had been withdrawn from the listing twelve
 * hours later — so the read is cached in a snapshot rather than taken only when
 * someone happens to look.
 *
 * Free is not the same as unpriced
 * -------------------------------
 * The listing mixes three shapes that all look like "costs nothing", and only one
 * of them is free:
 *
 *   - **free** — `pricing` is present and both meters read exactly `0`.
 *   - **unpriced** — no `pricing` object at all. These are locked stubs: a chat
 *     request answers `model_requires_purchase`. A missing price is a missing
 *     fact, never a zero one, which is the same rule `providers.ts` applies to a
 *     host missing from its tier table.
 *   - **partial** — one side of the meter is `0` and the other is not (`clef` is
 *     $0.24 in, $0 out). Cheap output is not a free model.
 *
 * Only the first shape produces a candidate, and even then the entry must be
 * priced *and* described: `supports_completions` must not be `false`, it must not
 * be an embedding endpoint, and it must publish a context window, so a partially
 * populated stub can never be wired into the chain.
 *
 * Nothing here performs I/O beyond reading the snapshot file, and nothing
 * invents a price. `free-fetch.ts` is what talks to the network.
 */

import { readFile } from "node:fs/promises";
import { canonicalModelKey } from "./scores.ts";

/** A host this module knows how to probe and how to wire into `model_list`. */
export interface FreeProbeTarget {
  /** Hostname as it appears in `litellm_params.api_base`. */
  readonly host: string;
  readonly baseUrl: string;
  /** Short name used in the generated group, e.g. `code-free-explabs-<model>`. */
  readonly slug: string;
  /** Variable holding the key, written as `os.environ/<name>` in the generated group. */
  readonly apiKeyEnv: string;
}

/**
 * Upstreams whose listing is read for zero-priced models. One entry today; the
 * shape is a list because the probe is the same for any OpenAI-compatible
 * `/models` endpoint, and a second free promo elsewhere should not need a new
 * module.
 */
export const FREE_PROBE_TARGETS: readonly FreeProbeTarget[] = [
  {
    host: "api.experientiallabs.ai",
    baseUrl: "https://api.experientiallabs.ai/v1",
    slug: "explabs",
    apiKeyEnv: "EXPLABS_API_KEY",
  },
];

/**
 * Prefix of every group this package generates. It is also the prune marker: a
 * group whose name starts with this is owned by the snapshot, so it is removed
 * and re-added on every compose rather than being treated as hand-written.
 */
export const MANAGED_PREFIX = "code-free-";

/** Generated group name for one model. */
export function freeModelGroupName(slug: string, id: string): string {
  return `${MANAGED_PREFIX}${slug}-${id}`;
}

export function isManagedModelName(name: string): boolean {
  return name.startsWith(MANAGED_PREFIX);
}

export function targetForHost(host: string): FreeProbeTarget | undefined {
  const wanted = host.toLowerCase();
  return FREE_PROBE_TARGETS.find((target) => target.host === wanted);
}

/** Why a listing entry did not become a candidate. */
export type FreeExclusionReason =
  /** No per-token price published: a locked stub, or simply unpublished. */
  | "no-price"
  /** An embeddings or other non-completions endpoint. */
  | "not-chat"
  /** Priced and chat-capable, but the listing omits its context window. */
  | "no-context-window"
  /** Only one side of the meter is zero. */
  | "partial-free";

export interface ExcludedModel {
  readonly id: string;
  readonly reason: FreeExclusionReason;
}

export interface FreeModel {
  readonly id: string;
  readonly contextWindow: number;
  readonly maxOutput: number | null;
  readonly reasoning: boolean;
  readonly tools: boolean;
  readonly uncensored: boolean;
}

export interface ProviderFreeSnapshot {
  readonly host: string;
  readonly baseUrl: string;
  readonly endpoint: string;
  readonly retrieved: string | null;
  /** How many entries the listing returned, so a shrunken listing is visible. */
  readonly listed: number;
  readonly free: readonly FreeModel[];
  readonly excluded: readonly ExcludedModel[];
}

export interface FreeSnapshot {
  readonly attribution: string;
  readonly retrieved: string | null;
  readonly providers: readonly ProviderFreeSnapshot[];
}

const NANO_PER_MILLION = 1e9;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * `pricing` meters are nano-USD per million tokens, so `300000000` is $0.30.
 * Kept so the reason a model was accepted can be printed in the units the
 * upstream publishes.
 */
export function nanoToUsdPerMillion(nano: number): number {
  return nano / NANO_PER_MILLION;
}

export interface ClassifiedEntry {
  readonly id: string;
  readonly reason?: FreeExclusionReason;
  readonly model?: FreeModel;
}

/**
 * Classify one listing entry. Returns the free model, or the reason it was not
 * one. A caller never has to interpret a price itself.
 */
export function classifyListingEntry(value: unknown): ClassifiedEntry | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = record.id;
  if (typeof id !== "string" || id === "") return undefined;

  // A locked stub carries an id and little else. Its missing meters must never
  // read as zero.
  const pricing = asRecord(record.pricing);
  if (!pricing) return { id, reason: "no-price" };

  const inputNano = finiteNumber(pricing.input_nano_usd_per_million_tokens);
  const outputNano = finiteNumber(pricing.output_nano_usd_per_million_tokens);
  if (inputNano === undefined || outputNano === undefined) return { id, reason: "no-price" };

  const chat = record.supports_completions !== false && record.supports_embeddings !== true;

  // A model with no zero meter at all is ordinary paid inventory; reporting every
  // one of them would bury the exclusions that mean something.
  if (inputNano !== 0 && outputNano !== 0) return undefined;

  if (inputNano !== 0 || outputNano !== 0) {
    // One side of the meter is zero. That is a cheap direction, not a free model,
    // and it is only worth reporting for something that could serve a chat turn.
    return chat ? { id, reason: "partial-free" } : undefined;
  }

  if (!chat) return { id, reason: "not-chat" };

  const contextWindow = finiteNumber(record.context_window_tokens);
  if (contextWindow === undefined || contextWindow <= 0) return { id, reason: "no-context-window" };

  return {
    id,
    model: {
      id,
      contextWindow,
      maxOutput: finiteNumber(record.maximum_output_tokens) ?? null,
      reasoning: record.supports_reasoning === true,
      tools: record.supports_tools === true,
      uncensored: record.uncensored === true,
    },
  };
}

/** Turn one upstream listing into the snapshot record for that host. */
export function buildProviderSnapshot(
  target: FreeProbeTarget,
  listing: unknown,
  retrieved: string | null,
): ProviderFreeSnapshot {
  const body = asRecord(listing);
  const raw = body?.data ?? body?.models ?? listing;
  const entries = Array.isArray(raw) ? raw : [];

  const free: FreeModel[] = [];
  const excluded: ExcludedModel[] = [];

  for (const entry of entries) {
    const classified = classifyListingEntry(entry);
    if (!classified) continue;
    if (classified.model) free.push(classified.model);
    else if (classified.reason) excluded.push({ id: classified.id, reason: classified.reason });
  }

  return {
    host: target.host,
    baseUrl: target.baseUrl,
    endpoint: `${target.baseUrl}/models`,
    retrieved,
    listed: entries.length,
    free: free.sort((a, b) => a.id.localeCompare(b.id)),
    excluded: excluded.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function buildFreeSnapshot(
  providers: readonly ProviderFreeSnapshot[],
  retrieved: string | null,
  attribution: string,
): FreeSnapshot {
  return { attribution, retrieved, providers };
}

function toProvider(value: unknown): ProviderFreeSnapshot | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const host = record.host;
  const baseUrl = record.baseUrl;
  if (typeof host !== "string" || typeof baseUrl !== "string") return undefined;

  const free: FreeModel[] = [];
  if (Array.isArray(record.free)) {
    for (const entry of record.free) {
      const model = asRecord(entry);
      const id = model?.id;
      // The written shape, not the upstream listing's shape: both ends of the
      // round trip live in this module, and a mismatch would silently drop every
      // free model on load.
      const contextWindow = finiteNumber(model?.contextWindow);
      if (typeof id !== "string" || contextWindow === undefined) continue;
      free.push({
        id,
        contextWindow,
        maxOutput: finiteNumber(model?.maxOutput) ?? null,
        reasoning: model?.reasoning === true,
        tools: model?.tools === true,
        uncensored: model?.uncensored === true,
      });
    }
  }

  const excluded: ExcludedModel[] = [];
  if (Array.isArray(record.excluded)) {
    for (const entry of record.excluded) {
      const item = asRecord(entry);
      const id = item?.id;
      const reason = item?.reason;
      if (typeof id !== "string" || typeof reason !== "string") continue;
      excluded.push({ id, reason: reason as FreeExclusionReason });
    }
  }

  return {
    host,
    baseUrl,
    endpoint: typeof record.endpoint === "string" ? record.endpoint : `${baseUrl}/models`,
    retrieved: typeof record.retrieved === "string" ? record.retrieved : null,
    listed: finiteNumber(record.listed) ?? free.length + excluded.length,
    free,
    excluded,
  };
}

/** Parse a snapshot. `undefined` means the text is not a usable snapshot. */
export function parseFreeSnapshot(text: string): FreeSnapshot | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const record = asRecord(raw);
  if (!record) return undefined;

  const providers: ProviderFreeSnapshot[] = [];
  if (Array.isArray(record.providers)) {
    for (const entry of record.providers) {
      const provider = toProvider(entry);
      if (provider) providers.push(provider);
    }
  }

  return {
    attribution: typeof record.attribution === "string" ? record.attribution : "unavailable",
    retrieved: typeof record.retrieved === "string" ? record.retrieved : null,
    providers,
  };
}

/**
 * Read a snapshot. `undefined` — not an empty snapshot — means no snapshot was
 * usable, which is the signal to leave `model_list` exactly as found rather than
 * pruning groups because a file went missing.
 */
export async function loadFreeSnapshot(path: string): Promise<FreeSnapshot | undefined> {
  try {
    return parseFreeSnapshot(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Key for the free-tier override: a host plus the model it serves. Both sides are
 * normalised, so `Qwen3.8-Flash` and `qwen3.8-flash` are one key.
 */
export function freeUpstreamKey(host: string, upstream: string): string {
  return `${host.toLowerCase()}|${canonicalModelKey(upstream)}`;
}

/** Every (host, model) pair the snapshot reports at zero cost. */
export function freeUpstreamKeys(snapshot: FreeSnapshot | undefined): Set<string> {
  const keys = new Set<string>();
  if (!snapshot) return keys;
  for (const provider of snapshot.providers) {
    for (const model of provider.free) keys.add(freeUpstreamKey(provider.host, model.id));
  }
  return keys;
}

export function freeModelsForHost(snapshot: FreeSnapshot | undefined, host: string): readonly FreeModel[] {
  if (!snapshot) return [];
  const wanted = host.toLowerCase();
  return snapshot.providers.find((provider) => provider.host.toLowerCase() === wanted)?.free ?? [];
}

/** Hosts the snapshot actually covers, so a host it says nothing about is untouched. */
export function coveredHosts(snapshot: FreeSnapshot | undefined): Set<string> {
  const hosts = new Set<string>();
  for (const provider of snapshot?.providers ?? []) hosts.add(provider.host.toLowerCase());
  return hosts;
}

export function excludedByReason(
  snapshot: FreeSnapshot | undefined,
  reason: FreeExclusionReason,
): string[] {
  const ids: string[] = [];
  for (const provider of snapshot?.providers ?? []) {
    for (const entry of provider.excluded) if (entry.reason === reason) ids.push(entry.id);
  }
  return ids;
}

/** Age of a snapshot in milliseconds, or `undefined` when it carries no date. */
export function snapshotAgeMs(snapshot: FreeSnapshot | undefined, now = Date.now()): number | undefined {
  const retrieved = snapshot?.retrieved;
  if (!retrieved) return undefined;
  const at = Date.parse(retrieved);
  return Number.isNaN(at) ? undefined : now - at;
}

export function describeTimestamp(value: string | null): string {
  if (!value) return "unknown";
  const at = Date.parse(value);
  if (Number.isNaN(at)) return value;
  const hours = Math.floor((Date.now() - at) / 3_600_000);
  if (hours < 1) return `${value} (under an hour ago)`;
  if (hours < 48) return `${value} (${hours}h ago)`;
  return `${value} (${Math.floor(hours / 24)}d ago)`;
}
