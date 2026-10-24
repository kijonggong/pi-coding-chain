/**
 * The virtual models this extension registers: one for the whole chain, and
 * one per model family.
 *
 * All of them live under the `fallback` provider, so `/model` shows them as
 * `fallback/aaii`, `fallback/deepseek-v4.1-flash` and `fallback/glm-5.3-flash`. The
 * first walks every candidate in the policy order; a family route walks only
 * the candidates that serve that family, keeping the same order, cooldown
 * memory and stickiness inside the shorter list.
 *
 * Family membership is decided on the canonical model key — the last path
 * segment, lowercased, with `.` and `_` folded to `-`, the same fold the score
 * table uses — so supplier prefixes (`deepseek-ai/`, `z-ai/`) and spelling
 * variants (`GLM-5.3-Flash`, `zai_glm-5.3-flash`) do not split a family. A
 * dated snapshot (`-1017`), a fine-tune (`-uncensored`) and a tier suffix
 * (`-free`) are the same family; a different version is not: `deepseek-v4-flash`
 * (no `.1`) and `glm-5.2` are other families and stay out.
 */

import { canonicalModelKey } from "../coding-fallback/scores.ts";
import { tieOrder } from "./candidates.ts";
import type { Candidate } from "./candidates.ts";

/** The Pi provider id every route registers under. */
export const PROVIDER = "fallback";

export interface RouteDefinition {
  /** Pi catalog id under the `fallback` provider. */
  readonly id: string;
  /** The name `/model` shows for the virtual model. */
  readonly name: string;
  /**
   * Canonical model key of the family this route serves. `undefined` means
   * every candidate: the AAII order itself, unshortened.
   */
  readonly family?: string;
}

export const ROUTES: readonly RouteDefinition[] = [
  { id: "aaii", name: "AAII fallback (providers direct)" },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash fallback (providers direct)", family: "deepseek-v4-1-flash" },
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash fallback (providers direct)", family: "glm-5-3-flash" },
];

/** Whether a physical model id belongs to the family, on the canonical key.
 * The family is matched as a dash-delimited token, so a supplier prefix
 * (`zai-glm-5-3-flash`), a suffix (`zaicoding-glm-5-3`) and extensions
 * (`deepseek-v4-1-flash-1017`) all match, while a longer version number
 * (`glm-5-35`) does not. An OpenRouter tier suffix after `:` (`:free`,
 * `:batch`) is stripped first, because it is a tier of the same model, not a
 * different name. */
export function matchesFamily(modelId: string, family: string): boolean {
  const key = canonicalModelKey(modelId.split(":")[0]);
  return key === family || key.startsWith(`${family}-`) || key.endsWith(`-${family}`) || key.includes(`-${family}-`);
}

/**
 * The candidates one route walks, in the route's own order.
 *
 * Inside one family every candidate serves the same model, so the AAII score
 * is not what tells them apart: the quota tier is. The family sorts by the
 * same tie-break the full chain uses below the score (`tieOrder`: the
 * allowance that replenishes soonest first, then label). That also keeps a
 * dated snapshot (`-1017`) or a fine-tune (`-uncensored`) from sinking to the
 * back of its own family just because the index carries no score under its
 * own key.
 */
export function candidatesForRoute(route: RouteDefinition, candidates: readonly Candidate[]): Candidate[] {
  const { family } = route;
  if (family === undefined) return [...candidates];
  return candidates.filter((candidate) => matchesFamily(candidate.id, family)).sort(tieOrder);
}
