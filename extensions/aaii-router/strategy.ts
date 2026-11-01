/**
 * Distribution strategies for the routing groups — the subset of Magpie's
 * routing modes that has a use here, set per group or globally.
 *
 * The chain policy itself (AAII score, then the quota tier, then provider/id)
 * is owned by `candidates.ts` and stays the single source: every strategy
 * below only re-orders what `candidatesForGroup` handed it, and `order` — the
 * default — is exactly that chain order. Nothing here re-derives a score or a
 * tier.
 *
 * Pins and model exclusions are applied by `applyChainSettings` before a
 * strategy runs, so an exclusion removes candidates from every strategy and a
 * pin leads it. The one exception is `manual`, which holds the session to the
 * pinned models alone — Magpie's "manual" locks requests to the pinned member
 * — and falls back to the chain order, with a note, when nothing is pinned.
 *
 * Vision demotion is deliberately applied before any strategy: seeing the
 * request is a capability constraint, the strategy is a distribution
 * preference, and the capability wins.
 */

import type { Candidate } from "./candidates.ts";

/** The strategies a settings file or an operator may name. */
export const STRATEGIES = ["order", "free-first", "rotate", "least-used", "manual"] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** Default when a group or the settings name none. */
export const DEFAULT_STRATEGY: Strategy = "order";

export function parseStrategy(value: unknown): Strategy | undefined {
  return typeof value === "string" && (STRATEGIES as readonly string[]).includes(value)
    ? (value as Strategy)
    : undefined;
}

/** Counterpart state a rotating or counting strategy carries between turns. */
export interface StrategyState {
  /** Turn counter for `rotate`, advanced per user turn on the same group. */
  readonly turns?: number;
  /** How many requests each label served this session, for `least-used`. */
  readonly served?: Readonly<Record<string, number>>;
}

export interface StrategyContext {
  readonly strategy: Strategy;
  readonly pinnedModels: readonly string[];
  readonly state?: StrategyState;
}

/**
 * Re-order one group's candidates for a fresh request, and return the state
 * to store with the turn. The notes carry what the operator should know — a
 * strategy that could not do its job says so instead of pretending.
 */
export function applyStrategy(
  ordered: readonly Candidate[],
  context: StrategyContext,
): { readonly ordered: readonly Candidate[]; readonly notes: readonly string[]; readonly state: StrategyState } {
  const { strategy } = context;
  const state = context.state ?? {};

  if (strategy === "manual") {
    const pinned = ordered.filter((candidate) => context.pinnedModels.includes(candidate.label));
    if (pinned.length === 0) {
      return { ordered, notes: ["manual: no pinned models, keeping the chain order"], state };
    }
    return { ordered: pinned, notes: [], state };
  }

  if (strategy === "free-first") {
    const reordered = [...ordered].sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const scoreA = a.score ?? Number.NEGATIVE_INFINITY;
      const scoreB = b.score ?? Number.NEGATIVE_INFINITY;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.label.localeCompare(b.label);
    });
    return { ordered: reordered, notes: [], state };
  }

  if (strategy === "rotate") {
    const turns = state.turns ?? 0;
    const offset = ordered.length === 0 ? 0 : turns % ordered.length;
    return {
      ordered: [...ordered.slice(offset), ...ordered.slice(0, offset)],
      // The offset decides where the walk starts; when it is not the chain
      // head, say so — the turn order is otherwise invisible.
      notes: offset === 0 ? [] : [`rotate: starting at position ${offset}`],
      state: { ...state, turns: turns + 1 },
    };
  }

  if (strategy === "least-used") {
    const served = state.served ?? {};
    // Ties keep the incoming order, which is the policy order: Array.prototype.sort
    // is stable, so equal counts never shuffle the chain.
    const reordered = [...ordered].sort((a, b) => (served[a.label] ?? 0) - (served[b.label] ?? 0));
    return { ordered: reordered, notes: [], state: { ...state, served } };
  }

  return { ordered, notes: [], state };
}

/**
 * The state to carry out of a fresh turn that `chosen` served. Only
 * `least-used` counts requests, and it counts the candidate that actually
 * served — not the head of the order, which a cooling candidate or an
 * affinity move can displace.
 */
export function recordServed(
  chosen: { readonly label: string },
  strategy: Strategy,
  state: StrategyState,
): StrategyState {
  if (strategy !== "least-used") return state;
  return {
    ...state,
    served: { ...(state.served ?? {}), [chosen.label]: (state.served?.[chosen.label] ?? 0) + 1 },
  };
}
