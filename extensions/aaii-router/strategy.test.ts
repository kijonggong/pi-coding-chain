/**
 * Tests for the distribution strategies: what order each one produces from the
 * same input, the state it carries between turns, and what it refuses to do.
 *
 * Run with:
 *   node --test extensions/aaii-router/strategy.test.ts
 *
 * The chain policy itself (score → tier → id) belongs to `candidates.ts` and
 * is tested there; every strategy here only re-orders what it is handed, and
 * the tests fix exactly that boundary.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyStrategy, parseStrategy, recordServed } from "./strategy.ts";
import type { Candidate } from "./candidates.ts";

const at = (label: string, score?: number): Candidate => ({
  label: `x/${label}`,
  provider: "x",
  id: label,
  score,
  tier: 0,
  supportsImages: false,
});

/** The chain order a strategy receives, as `candidatesForGroup` would hand it over. */
const CHAIN = [at("alpha", 90), at("beta", 60), at("gamma", 30)];

test("order is the chain order and carries no state", () => {
  const result = applyStrategy(CHAIN, { strategy: "order", pinnedModels: [], state: { turns: 3 } });
  assert.deepEqual(result.ordered.map((candidate) => candidate.id), ["alpha", "beta", "gamma"]);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.state, { turns: 3 }, "a passing state is kept, not reset");
});

test("free-first puts the free tier first and keeps score order inside a tier", () => {
  const chain: Candidate[] = [
    { ...at("monthly", 90), tier: 3 },
    { ...at("daily-low", 40), tier: 1 },
    { ...at("free", 10), tier: 0 },
    { ...at("daily-high", 50), tier: 1 },
  ];
  const result = applyStrategy(chain, { strategy: "free-first", pinnedModels: [] });
  assert.deepEqual(result.ordered.map((candidate) => candidate.id), ["free", "daily-high", "daily-low", "monthly"]);
});

test("free-first breaks a full tie (same tier, same score) by label", () => {
  // The snapshot decides the incoming order, so equal tier and score must not
  // leave the order dependent on it: label is the tie-break.
  const tied: Candidate[] = [
    { ...at("zeta", 50), tier: 1 },
    { ...at("alpha", 50), tier: 1 },
    { ...at("mid", 50), tier: 1 },
  ];
  const result = applyStrategy(tied, { strategy: "free-first", pinnedModels: [] });
  assert.deepEqual(result.ordered.map((candidate) => candidate.id), ["alpha", "mid", "zeta"]);
});

test("rotate starts the turn at a different candidate each turn and wraps around", () => {
  const context = { strategy: "rotate" as const, pinnedModels: [] };
  const first = applyStrategy(CHAIN, context);
  assert.deepEqual(first.ordered.map((candidate) => candidate.id), ["alpha", "beta", "gamma"]);
  assert.deepEqual(first.state, { turns: 1 });

  const second = applyStrategy(CHAIN, { ...context, state: first.state });
  assert.deepEqual(second.ordered.map((candidate) => candidate.id), ["beta", "gamma", "alpha"]);

  const wrapped = applyStrategy(CHAIN, { ...context, state: { turns: 3 } });
  assert.deepEqual(wrapped.ordered.map((candidate) => candidate.id), ["alpha", "beta", "gamma"]);
});

test("rotate recomputed from the stored counter minus one repeats the failed turn's order", () => {
  // A fresh turn stores `turns + 1`, so the retry path rewinds the counter by
  // one before recomputing; that must reproduce exactly the order the failed
  // turn walked, not the next turn's. (index.test.ts feeds the real stored
  // state back through the route; this fixes the unit boundary.)
  const failedTurn = applyStrategy(CHAIN, { strategy: "rotate" as const, pinnedModels: [], state: { turns: 1 } });
  assert.deepEqual(failedTurn.ordered.map((candidate) => candidate.id), ["beta", "gamma", "alpha"]);
  assert.deepEqual(failedTurn.state, { turns: 2 });
  const retry = applyStrategy(CHAIN, {
    strategy: "rotate" as const,
    pinnedModels: [],
    state: { turns: failedTurn.state.turns - 1 },
  });
  assert.deepEqual(retry.ordered.map((candidate) => candidate.id), ["beta", "gamma", "alpha"]);
  assert.deepEqual(retry.state, { turns: 2 }, "the retry leaves the counter where the failed turn left it");
});

test("rotate announces the position it starts from when it is not the head", () => {
  const result = applyStrategy(CHAIN, { strategy: "rotate" as const, pinnedModels: [], state: { turns: 1 } });
  assert.deepEqual(result.notes, ["rotate: starting at position 1"]);
  const head = applyStrategy(CHAIN, { strategy: "rotate" as const, pinnedModels: [], state: { turns: 3 } });
  assert.deepEqual(head.notes, []);
});

test("least-used serves the candidate with the fewest requests and counts what served", () => {
  const context = { strategy: "least-used" as const, pinnedModels: [] };
  const first = applyStrategy(CHAIN, context);
  assert.deepEqual(first.ordered.map((candidate) => candidate.id), ["alpha", "beta", "gamma"]);
  assert.deepEqual(recordServed(first.ordered[0], "least-used", first.state).served, { "x/alpha": 1 });

  const second = applyStrategy(CHAIN, { ...context, state: { served: { "x/alpha": 1 } } });
  assert.deepEqual(second.ordered.map((candidate) => candidate.id), ["beta", "gamma", "alpha"]);
});

test("least-used keeps the chain order on a tie", () => {
  const result = applyStrategy(CHAIN, { strategy: "least-used", pinnedModels: [] });
  assert.deepEqual(result.ordered.map((candidate) => candidate.id), ["alpha", "beta", "gamma"]);
});

test("recordServed counts the candidate that actually served, not the head of the order", () => {
  // A cooling head or a `turn` affinity move can displace the head; the count
  // must land on what answered.
  const state = recordServed(at("gamma"), "least-used", { served: { "x/alpha": 1 } });
  assert.deepEqual(state.served, { "x/alpha": 1, "x/gamma": 1 });
  // Every other strategy carries the state through untouched.
  assert.deepEqual(recordServed(at("gamma"), "rotate", { turns: 2 }), { turns: 2 });
});

test("manual holds the session to the pinned models, and demotes itself when nothing is pinned", () => {
  // The pin order itself is `applyChainSettings`' contract (pins lead); manual
  // only narrows the walk to the pinned subset, keeping the handed order.
  const pinned = applyStrategy(CHAIN, {
    strategy: "manual",
    pinnedModels: ["x/gamma", "x/alpha"],
  });
  assert.deepEqual(pinned.ordered.map((candidate) => candidate.id), ["alpha", "gamma"]);
  assert.deepEqual(pinned.notes, []);

  const unpinned = applyStrategy(CHAIN, { strategy: "manual", pinnedModels: ["x/absent"] });
  assert.deepEqual(unpinned.ordered.map((candidate) => candidate.id), ["alpha", "beta", "gamma"]);
  assert.deepEqual(unpinned.notes, ["manual: no pinned models, keeping the chain order"]);
});

test("a strategy only re-orders what it is handed: exclusions removed upstream stay out", () => {
  // `applyChainSettings` owns the exclusion; the strategy must not resurrect a
  // candidate that is no longer in the list.
  const withoutBeta = CHAIN.filter((candidate) => candidate.id !== "beta");
  for (const strategy of ["order", "free-first", "rotate", "least-used", "manual"] as const) {
    const result = applyStrategy(withoutBeta, { strategy, pinnedModels: ["x/beta"] });
    assert.deepEqual(
      result.ordered.map((candidate) => candidate.id),
      withoutBeta.map((candidate) => candidate.id),
      strategy,
    );
  }
});

test("an unknown strategy word is refused rather than silently becoming order", () => {
  assert.equal(parseStrategy("rotate"), "rotate");
  assert.equal(parseStrategy("order"), "order");
  assert.equal(parseStrategy("smart"), undefined);
  assert.equal(parseStrategy(42), undefined);
});
