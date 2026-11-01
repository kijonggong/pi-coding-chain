/**
 * Tests for the decision explainer's record shape: the cooling list a decision
 * carries is ordered by expiry, soonest first, and names only candidates the
 * route actually walks.
 *
 * Run with:
 *   node --test extensions/aaii-router/explain.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { coolingDescriptions } from "./explain.ts";

test("coolingDescriptions lists the windows about to expire first, in the chain only", () => {
  const now = 1_000_000;
  // Inserted in the wrong order on purpose: the sort, not the map's insertion
  // order, decides what `/aaii-router explain` shows.
  const cooldowns = {
    "x/late": { until: now + 300_000, reason: "rate-limit" as const },
    "x/soon": { until: now + 30_000, reason: "error" as const },
    "x/away": { until: now + 3_600_000, reason: "manual" as const },
    "x/elsewhere": { until: now + 10_000, reason: "error" as const },
  };
  // The order this route walks: everything but `x/elsewhere`.
  const ordered = [{ label: "x/soon" }, { label: "x/late" }, { label: "x/away" }];
  assert.deepEqual(
    coolingDescriptions(cooldowns, ordered, now).map((line) => line.split(" ")[0]),
    ["x/soon", "x/late", "x/away"],
  );
});
