/**
 * Candidate selection for the AAII-ordered Pi router.
 *
 * Pure: it takes a list of physical models and a score snapshot and returns the
 * ordered candidates. The Pi extension supplies the models and performs the
 * routing, so the ordering and the fail-over step can be tested without Pi.
 *
 * Ordering matches the LiteLLM config composer: AAII score descending first,
 * then the quota tier that replenishes soonest, then provider/id. A model the
 * index does not cover sorts after every scored model.
 *
 * A request that carries an image reorders the same list rather than dropping
 * from it: Pi substitutes placeholders for a model without image support, so a
 * blind candidate still answers — it just answers without having seen the
 * screenshot. {@link orderForRequest} moves those candidates behind the ones
 * that can see, and keeps the policy order inside each group.
 */

import { tierForHost, TIER_UNKNOWN } from "../coding-fallback/providers.ts";
import { scoreFor } from "../coding-fallback/scores.ts";
import type { ScoreSnapshot } from "../coding-fallback/scores.ts";

/** The parts of a physical model the candidate list needs. */
export interface PhysicalModel {
  readonly provider: string;
  readonly id: string;
  readonly baseUrl?: string;
  /** From the catalog's input modalities. Defaults to text-only when absent. */
  readonly supportsImages?: boolean;
}

export interface Candidate {
  /** `provider/id`, the stable identity used in router state and reports. */
  readonly label: string;
  readonly provider: string;
  readonly id: string;
  readonly score: number | undefined;
  readonly tier: number;
  readonly supportsImages: boolean;
}

export interface BuildOptions {
  /**
   * Origins to leave out. A model served through the LiteLLM proxy would send
   * the request back into the chain this router replaces, so the proxy's origin
   * is excluded by default.
   */
  readonly excludedOrigins?: readonly string[];
  /** Provider ids to leave out, whatever the model. */
  readonly excludedProviders?: readonly string[];
}

/** The LiteLLM proxy origin: the default, and what the setting starts from. */
export const DEFAULT_EXCLUDED_ORIGINS: readonly string[] = ["http://127.0.0.1:4000"];

function originOf(baseUrl: string | undefined): string {
  if (!baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

function hostOf(baseUrl: string | undefined): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}

export function candidateLabel(model: PhysicalModel): string {
  return `${model.provider}/${model.id}`;
}

/** Physical models from a registry listing, dropping the excluded origins. */
export function eligibleModels(
  models: readonly PhysicalModel[],
  options: BuildOptions = {},
): PhysicalModel[] {
  const excluded = new Set(options.excludedOrigins ?? DEFAULT_EXCLUDED_ORIGINS);
  const excludedProviders = new Set(options.excludedProviders ?? []);
  const seen = new Set<string>();
  const kept: PhysicalModel[] = [];

  for (const model of models) {
    const label = candidateLabel(model);
    if (seen.has(label)) continue;
    if (excluded.has(originOf(model.baseUrl))) continue;
    if (excludedProviders.has(model.provider)) continue;
    seen.add(label);
    kept.push(model);
  }
  return kept;
}

/** Order candidates by score, then tier, then label. */
export function buildCandidates(
  models: readonly PhysicalModel[],
  scores: ScoreSnapshot,
  options: BuildOptions = {},
): Candidate[] {
  return eligibleModels(models, options)
    .map((model) => {
      const score = scoreFor(scores, model.id);
      return {
        label: candidateLabel(model),
        provider: model.provider,
        id: model.id,
        score,
        tier: tierForHost(hostOf(model.baseUrl)),
        supportsImages: model.supportsImages === true,
      };
    })
    .sort((a, b) => {
      const rankA = a.score === undefined ? Number.NEGATIVE_INFINITY : a.score;
      const rankB = b.score === undefined ? Number.NEGATIVE_INFINITY : b.score;
      if (rankA !== rankB) return rankB - rankA;
      if (a.tier !== b.tier) return a.tier - b.tier;
      return a.label.localeCompare(b.label);
    });
}

/** The part of a request message this module reads. */
export interface MessageLike {
  readonly content?: unknown;
}

/**
 * Whether any message carries an image. Pi accepts an image on any message with
 * an array content, so this looks at the parts rather than the role.
 */
export function containsImage(messages: readonly MessageLike[]): boolean {
  for (const message of messages) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "image") return true;
    }
  }
  return false;
}

/**
 * The order to use for one request. Without images this is the policy order
 * unchanged. With an image, candidates that cannot see come last — every model
 * stays in the list, so the chain is as long as it was and the tier tie-break
 * still decides inside each group.
 */
export function orderForRequest(candidates: readonly Candidate[], needsImages: boolean): Candidate[] {
  if (!needsImages) return [...candidates];
  const seeing: Candidate[] = [];
  const blind: Candidate[] = [];
  for (const candidate of candidates) {
    (candidate.supportsImages ? seeing : blind).push(candidate);
  }
  return [...seeing, ...blind];
}

/** Candidates that carry no score, for a startup report. */
export function unscoredCandidates(candidates: readonly Candidate[]): Candidate[] {
  return candidates.filter((candidate) => candidate.score === undefined);
}

/** Candidates whose tier could not be classified, for a startup report. */
export function unclassifiedCandidates(candidates: readonly Candidate[]): Candidate[] {
  return candidates.filter((candidate) => candidate.tier === TIER_UNKNOWN);
}
