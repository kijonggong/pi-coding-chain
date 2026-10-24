/**
 * Tests for the AAII router's failure memory.
 *
 * Run with:
 *   node --test extensions/aaii-router/cooldown.test.ts
 *
 * Every clock value here is a literal, and every label is made up, so nothing
 * depends on how long a real request takes or on which providers this machine
 * has.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_COOLDOWN_MS,
  chooseTurnCandidate,
  classifyFailure,
  coolingFor,
  coolingLabels,
  describeCooldown,
  preferred,
  pruneCooldowns,
  rememberFailure,
  remembers,
  remainingText,
  stepForward,
  withCooldown,
} from "./cooldown.ts";
import type { CooldownMap } from "./cooldown.ts";

const NOW = 1_000_000;

const item = (label: string) => ({ label });
const ORDER = [item("a/alpha"), item("b/beta"), item("c/gamma"), item("d/delta")];

test("an aborted or finished turn is not a failure", () => {
  // ESC is the operator, not the model. Benching a model for it would move the
  // chain for the wrong reason.
  assert.equal(classifyFailure({ stopReason: "aborted" }), undefined);
  assert.equal(classifyFailure({ stopReason: "stop" }), undefined);
  assert.equal(classifyFailure({ stopReason: "toolUse" }), undefined);
  assert.equal(classifyFailure({ stopReason: "pending" }), undefined);
  assert.equal(remembers(classifyFailure({ stopReason: "aborted" })), false);
});

test("classifies the error text the provider returned", () => {
  assert.equal(classifyFailure({ stopReason: "error", errorMessage: "429 Too Many Requests" }), "rate-limit");
  assert.equal(
    classifyFailure({ stopReason: "error", errorMessage: "rate limit exceeded for this key" }),
    "rate-limit",
  );
  assert.equal(classifyFailure({ stopReason: "error", errorMessage: "overloaded_error" }), "rate-limit");
  assert.equal(
    classifyFailure({ stopReason: "error", errorMessage: "401 Unauthorized: invalid api key" }),
    "auth",
  );
  assert.equal(classifyFailure({ stopReason: "error", errorMessage: "the request failed" }), "error");
  // Nothing to read is still a failure: the chain would not have stepped otherwise.
  assert.equal(classifyFailure(undefined), "error");
  assert.equal(classifyFailure({}), "error");
});

test("a context overflow is stepped past but not remembered", () => {
  // Pi compacts and retries for an overflow, so the model did not fail and a
  // five-minute bench would be charged to the wrong candidate.
  const overflow = classifyFailure({
    stopReason: "error",
    errorMessage: "This model's maximum context length is 200000 tokens",
  });
  assert.equal(overflow, "overflow");
  assert.equal(remembers(overflow), false);
  assert.equal(remembers("rate-limit"), true);
  assert.equal(remembers("auth"), true);
  assert.equal(remembers("error"), true);
  assert.equal(remembers(undefined), false);
});

test("keeps a failure for the window, then forgets it", () => {
  const after = rememberFailure(undefined, "b/beta", "rate-limit", NOW, DEFAULT_COOLDOWN_MS);

  assert.deepEqual(after["b/beta"], { until: NOW + DEFAULT_COOLDOWN_MS, reason: "rate-limit" });
  assert.notEqual(coolingFor(after, "b/beta", NOW + 1000), undefined);
  assert.equal(
    coolingFor(after, "b/beta", NOW + DEFAULT_COOLDOWN_MS),
    undefined,
    "the window ends exactly at its end time",
  );
});

test("prunes what expired, so the state a session carries stays bounded", () => {
  const map: CooldownMap = {
    "a/alpha": { until: NOW - 1, reason: "error" },
    "b/beta": { until: NOW + 60_000, reason: "auth" },
  };
  assert.deepEqual(Object.keys(pruneCooldowns(map, NOW)), ["b/beta"]);
  assert.deepEqual(pruneCooldowns(undefined, NOW), {});
  assert.deepEqual(coolingLabels(map, NOW), ["b/beta"]);
});

test("a zero window disables the memory instead of keeping everything out", () => {
  const disabled = rememberFailure(undefined, "b/beta", "error", NOW, 0);
  assert.deepEqual(disabled, {});
  assert.equal(preferred(ORDER, disabled, NOW)?.label, "a/alpha");
});

test("prefers the first candidate that is not cooling, and the head when all are", () => {
  const cooldowns = rememberFailure(undefined, "a/alpha", "rate-limit", NOW, 60_000);
  assert.equal(preferred(ORDER, cooldowns, NOW)?.label, "b/beta");

  let all: CooldownMap | undefined = cooldowns;
  for (const model of ORDER.slice(1)) {
    all = rememberFailure(all, model.label, "error", NOW, 60_000);
  }
  assert.equal(all && Object.keys(all).length, ORDER.length);
  assert.equal(
    preferred(ORDER, all, NOW)?.label,
    "a/alpha",
    "a cooldown must not turn into no model available",
  );
});

test("steps past a cooling candidate instead of trying it again", () => {
  const cooldowns = rememberFailure(undefined, "b/beta", "rate-limit", NOW, 60_000);

  // Stepping from `a/alpha` skips the cooling `b/beta`.
  assert.equal(stepForward(ORDER, cooldowns, "a/alpha", NOW)?.label, "c/gamma");
  // The failed model itself is stepped past as before.
  assert.equal(stepForward(ORDER, undefined, "c/gamma", NOW)?.label, "d/delta");
  assert.equal(stepForward(ORDER, undefined, "d/delta", NOW), undefined, "the last candidate has nowhere to go");
  assert.equal(stepForward(ORDER, undefined, "unknown/label", NOW)?.label, "a/alpha", "an unknown failure restarts");
  assert.equal(stepForward(ORDER, undefined, undefined, NOW)?.label, "a/alpha");
});

test("takes the next candidate anyway when every remaining one is cooling", () => {
  // Otherwise the last window would fail a turn that has a usable model.
  let cooldowns: CooldownMap | undefined;
  for (const model of ORDER.slice(1)) {
    cooldowns = rememberFailure(cooldowns, model.label, "error", NOW, 60_000);
  }
  assert.equal(stepForward(ORDER, cooldowns, "a/alpha", NOW)?.label, "b/beta");
  assert.equal(
    stepForward(ORDER, cooldowns, "a/alpha", NOW + 60_000)?.label,
    "b/beta",
    "the same step once the windows closed",
  );
});

test("reports a window in words, soonest expiry first", () => {
  let cooldowns: CooldownMap | undefined = rememberFailure(undefined, "c/gamma", "auth", NOW, 300_000);
  cooldowns = rememberFailure(cooldowns, "b/beta", "rate-limit", NOW, 42_000);

  assert.deepEqual(coolingLabels(cooldowns, NOW), ["b/beta", "c/gamma"]);
  const beta = coolingFor(cooldowns, "b/beta", NOW) as NonNullable<ReturnType<typeof coolingFor>>;
  assert.equal(remainingText(beta, NOW), "42s");
  assert.equal(describeCooldown(beta, NOW), "cooling 42s, rate-limit");

  const gamma = coolingFor(cooldowns, "c/gamma", NOW) as NonNullable<ReturnType<typeof coolingFor>>;
  assert.equal(remainingText(gamma, NOW), "5m");
  assert.equal(remainingText(gamma, NOW + 120_000), "3m");
  assert.equal(remainingText(gamma, NOW + 30_000), "4m30s");
  assert.equal(remainingText(gamma, NOW + 999_000), "0s", "an expired window never goes negative");
});

test("pairs each candidate with the window it is under", () => {
  const cooldowns = rememberFailure(undefined, "b/beta", "manual", NOW, 60_000);
  const candidates = ORDER.map((entry, index) => ({ ...entry, index }));
  const paired = withCooldown(candidates, cooldowns, NOW);

  assert.deepEqual(paired.map(({ candidate }) => candidate.label), ORDER.map((entry) => entry.label));
  assert.equal(paired[0].cooling, undefined);
  assert.equal(paired[1].cooling?.reason, "manual");
  // The candidate the report prints is the whole one, not a copy.
  assert.equal(paired[2].candidate.index, 2);
});

test("chooseTurnCandidate respects valid session epoch, falls back when epoch changed or candidate is cooling", () => {
  // 1. Fresh turn with no state picks preferred (head).
  assert.equal(chooseTurnCandidate(ORDER, undefined, undefined, 0, NOW).label, "a/alpha");

  // 2. Remembered candidate with matching epoch is retained when not cooling.
  assert.equal(chooseTurnCandidate(ORDER, undefined, { label: "c/gamma", epoch: 1 }, 1, NOW).label, "c/gamma");

  // 3. Legacy session state with undefined epoch is treated as valid.
  assert.equal(chooseTurnCandidate(ORDER, undefined, { label: "c/gamma" }, 2, NOW).label, "c/gamma");

  // 4. Mismatched epoch treats remembered candidate as invalid and picks preferred (head).
  assert.equal(chooseTurnCandidate(ORDER, undefined, { label: "c/gamma", epoch: 1 }, 2, NOW).label, "a/alpha");

  // 5. Remembered candidate under cooldown falls back to preferred non-cooling candidate.
  const coolingGamma = rememberFailure(undefined, "c/gamma", "rate-limit", NOW, 60_000);
  assert.equal(chooseTurnCandidate(ORDER, coolingGamma, { label: "c/gamma", epoch: 1 }, 1, NOW).label, "a/alpha");

  // 6. When remembered candidate is cooling and head is also cooling, picks next non-cooling.
  const coolingAlphaAndGamma = rememberFailure(coolingGamma, "a/alpha", "rate-limit", NOW, 60_000);
  assert.equal(chooseTurnCandidate(ORDER, coolingAlphaAndGamma, { label: "c/gamma", epoch: 1 }, 1, NOW).label, "b/beta");

  // 7. When all candidates are cooling, falls back to head.
  let allCooling: CooldownMap | undefined = coolingAlphaAndGamma;
  for (const item of ORDER) {
    allCooling = rememberFailure(allCooling, item.label, "rate-limit", NOW, 60_000);
  }
  assert.equal(chooseTurnCandidate(ORDER, allCooling, { label: "c/gamma", epoch: 1 }, 1, NOW).label, "a/alpha");
});
