/**
 * Routing groups: named filters over the automatically collected candidate
 * list, each registered as one virtual model under the `fallback` provider.
 *
 * Magpie's groups aggregate models into one selectable target; here the same
 * idea lands as a canonical family matcher over Pi's live registry — the
 * operator names a group and what it matches, and the members are whichever
 * candidates the registry already serves. `aaii` is reserved for the full
 * chain and always registered.
 *
 * A group's members are decided per request from the current settings, so an
 * edited file changes membership on the next request; only the set of
 * registered virtual models is fixed at load, because `registerVirtualModel`
 * runs once. Adding or removing a group id therefore needs Pi's `/reload`.
 */

import { canonicalModelKey } from "../coding-fallback/scores.ts";
import { tieOrder } from "./candidates.ts";
import type { Candidate } from "./candidates.ts";
import { parseAffinity, AFFINITIES } from "./cooldown.ts";
import type { Affinity } from "./cooldown.ts";
import { parseStrategy, STRATEGIES } from "./strategy.ts";
import type { Strategy } from "./strategy.ts";

/** The Pi provider id every route registers under. */
export const PROVIDER = "fallback";

/** The virtual model that walks every candidate, in policy order. */
export const FULL_CHAIN_ID = "aaii";

/** What one group says about itself. `match` is a canonical family key. */
export interface GroupDefinition {
  /** Pi catalog id under the `fallback` provider, unique across the file. */
  readonly id: string;
  /** The name `/model` shows for the virtual model. */
  readonly name: string;
  /** Canonical model key the group matches; `undefined` is the full chain. */
  readonly match?: string;
  /** Distribution strategy for this group, overriding the global one. */
  readonly strategy?: Strategy;
  /** How eagerly a new turn returns here, overriding the global one. */
  readonly affinity?: Affinity;
}

/** The full chain, plus the two family groups the seed file starts with. */
export const FULL_CHAIN: GroupDefinition = { id: FULL_CHAIN_ID, name: "AAII fallback (providers direct)" };

/**
 * Whether a physical model id belongs to a family, on the canonical key.
 * The family is matched as a dash-delimited token, so a supplier prefix
 * (`zai-glm-5-3-flash`), a suffix (`zaicoding-glm-5-3`) and extensions
 * (`deepseek-v4-1-flash-1017`) all match, while a longer version number
 * (`glm-5-35`) does not. An OpenRouter tier suffix after `:` (`:free`,
 * `:batch`) is stripped first, because it is a tier of the same model, not a
 * different name.
 */
export function matchesFamily(modelId: string, family: string): boolean {
  const key = canonicalModelKey(modelId.split(":")[0]);
  return key === family || key.startsWith(`${family}-`) || key.endsWith(`-${family}`) || key.includes(`-${family}-`);
}

/** The groups `serializeSettings` writes into a fresh settings file. They are
 * the seed, not the source of truth: the file is. */
export const DEFAULT_GROUPS: readonly GroupDefinition[] = [
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash fallback (providers direct)", match: "deepseek-v4-1-flash" },
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash fallback (providers direct)", match: "glm-5-3-flash" },
];

/** Validate one group entry from the settings file. `undefined` means reject
 * it, with the reason the note carries. */
export function parseGroup(value: unknown): { group?: GroupDefinition; reason?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { reason: "not an object" };
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return { reason: "missing id" };
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    return { reason: `id is not a model id: ${id}` };
  }
  if (id === FULL_CHAIN_ID) return { reason: `the id "${FULL_CHAIN_ID}" is reserved for the full chain` };
  const match = typeof record.match === "string" ? record.match.trim() : "";
  if (!match) return { reason: `missing match (the canonical family key) on ${id}` };
  if (match !== canonicalModelKey(match)) {
    return { reason: `match is not canonical (lowercase, dots and underscores as dashes): ${match}` };
  }
  let strategy: Strategy | undefined;
  if (record.strategy !== undefined) {
    strategy = parseStrategy(record.strategy);
    if (strategy === undefined) {
      return { reason: `strategy is not one of ${STRATEGIES.join(", ")}: ${String(record.strategy)}` };
    }
  }
  let affinity: Affinity | undefined;
  if (record.affinity !== undefined) {
    affinity = parseAffinity(record.affinity);
    if (affinity === undefined) {
      return { reason: `affinity is not one of ${AFFINITIES.join(", ")}: ${String(record.affinity)}` };
    }
  }
  const name = typeof record.name === "string" && record.name.trim() !== "" ? record.name.trim() : `${match} fallback`;
  const group: GroupDefinition = { id, name, match };
  if (strategy !== undefined) group.strategy = strategy;
  if (affinity !== undefined) group.affinity = affinity;
  return { group };
}

/**
 * The candidates one group walks, in the group's own order.
 *
 * Inside one family every candidate serves the same model, so the AAII score
 * is not what tells them apart: the quota tier is. The family sorts by the
 * same tie-break the full chain uses below the score (`tieOrder`: the
 * allowance that replenishes soonest first, then label). That also keeps a
 * dated snapshot (`-1017`) or a fine-tune (`-uncensored`) from sinking to the
 * back of its own family just because the index carries no score under its
 * own key.
 */
export function candidatesForGroup(group: GroupDefinition, candidates: readonly Candidate[]): Candidate[] {
  const match = group.match;
  if (match === undefined) return [...candidates];
  return candidates.filter((candidate) => matchesFamily(candidate.id, match)).sort(tieOrder);
}
