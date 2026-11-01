/**
 * The routing decision explainer — why the last request went where it went.
 *
 * Both pi-router and pi-auto-router surface this; Magpie's TUI shows the same
 * by keeping the chain on screen. The router records one decision per request
 * in memory (the newest replaces the oldest — no session history here, that is
 * observability debt until it has a consumer), and the command draws it.
 */

import { coolingLabels, describeCooldown } from "./cooldown.ts";
import type { CooldownMap } from "./cooldown.ts";

/** Why the router chose what it chose. */
export type DecisionReason =
  | "fresh turn"
  | "continuation (kept the model)"
  | "retry after failure"
  | "no eligible model";

/** One routing decision, as `/aaii-router explain` shows it. */
export interface RoutingDecision {
  readonly route: string;
  readonly reason: DecisionReason;
  /** The chosen candidate label, when one was chosen. */
  readonly chosen?: string;
  /** The candidate the request failed on, for a retry. */
  readonly failed?: string;
  /** The failure signal class. */
  readonly signal?: string;
  /** Up to ten candidates in the order considered, `*` marking the chosen one. */
  readonly considered: readonly string[];
  /** How many candidates the order held in total. */
  readonly total: number;
  /** Candidates that were skipped as cooling, with their windows. */
  readonly cooling: readonly string[];
  /** Adjustments the operator or the configuration made, in words. */
  readonly notes: readonly string[];
}

let last: RoutingDecision | undefined;

/** Record the newest decision, replacing whatever was there. */
export function recordDecision(decision: RoutingDecision): void {
  last = decision;
}

/** The newest decision, for the `explain` command to draw. */
export function lastDecision(): RoutingDecision | undefined {
  return last;
}

/** Forget the decision — a new session has nothing to explain yet. */
export function forgetDecision(): void {
  last = undefined;
}

const CONSIDERED_LIMIT = 10;

/**
 * The decision as the command prints it, one line per fact. `undefined` when
 * nothing has been routed yet.
 */
export function describeDecision(decision: RoutingDecision | undefined): string | undefined {
  if (!decision) return undefined;
  const lines: string[] = [];
  const head =
    decision.chosen === undefined
      ? `${decision.route}: ${decision.reason}`
      : `${decision.route}: ${decision.chosen} — ${decision.reason}`;
  lines.push(head);
  if (decision.failed !== undefined) {
    lines.push(`  failed: ${decision.failed}${decision.signal ? ` (${decision.signal})` : ""}`);
  }
  if (decision.cooling.length > 0) lines.push(`  cooling: ${decision.cooling.join(", ")}`);
  if (decision.considered.length > 0) {
    const more = decision.total > decision.considered.length ? ` (+${decision.total - decision.considered.length} more)` : "";
    lines.push(`  order: ${decision.considered.map((label) => (label === decision.chosen ? `*${label}` : label)).join(" → ")}${more}`);
  }
  for (const note of decision.notes) lines.push(`  note: ${note}`);
  return lines.join("\n");
}

/** The considered-list lines for a decision, capped. */
export function consideredList(
  ordered: readonly { readonly label: string }[],
  limit: number = CONSIDERED_LIMIT,
): { readonly considered: readonly string[]; readonly total: number } {
  return {
    considered: ordered.slice(0, limit).map((candidate) => candidate.label),
    total: ordered.length,
  };
}

/** Cooling labels with their remaining windows, for the decision record.
 * The expiry order is `coolingLabels`' single rule — soonest to expire first —
 * narrowed here to the candidates the route actually walks. */
export function coolingDescriptions(cooldowns: CooldownMap, ordered: readonly { readonly label: string }[], now: number): string[] {
  const inChain = new Set(ordered.map((candidate) => candidate.label));
  return coolingLabels(cooldowns, now)
    .filter((label) => inChain.has(label))
    .map((label) => `${label} (${describeCooldown(cooldowns[label], now)})`);
}
