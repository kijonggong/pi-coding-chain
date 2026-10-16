/**
 * Tests for zero-priced model discovery and its effect on the chain.
 *
 * Run with:
 *   node --test extensions/coding-fallback/free-models.test.ts
 *
 * The fixtures are synthetic: no test asserts that a particular model is free
 * today, because the listing that says so is live and volatile. What is asserted
 * is the *shape* of the decision — a present price of zero on both meters is free,
 * a missing price is not — plus what the chain does with a free model.
 *
 * One test does read the live config, in the same read-only way `chain.test.ts`
 * does, to check that the generated block is well formed against a real file.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CODING_CHAIN, composeCodingFallback, orderChain, readModelEntries, reconcileFreeEntries, tierForEntry } from "./chain.ts";
import { checkFallback, syncFallback } from "./config.ts";
import { FREE_PROBE_TARGETS, buildProviderSnapshot, classifyListingEntry, freeModelGroupName, freeUpstreamKey, freeUpstreamKeys, isManagedModelName, parseFreeSnapshot } from "./free-models.ts";
import type { FreeSnapshot } from "./free-models.ts";
import { TIER_FREE, TIER_MONTHLY, tierForHost } from "./providers.ts";
import { parseScores } from "./scores.ts";
import type { ScoreSnapshot } from "./scores.ts";

const SCORES = parseScores(
  JSON.stringify({
    attribution: "fixture",
    retrieved: null,
    scores: {
      "model-x": { slug: "model-x", score: 40, variant: "reasoning" },
      "model-top": { slug: "model-top", score: 60, variant: "reasoning" },
    },
    aliases: {},
  }),
) as ScoreSnapshot;

/** Three suppliers of the same scored model: daily, monthly, daily. */
const CONFIG = [
  "model_list:",
  "- model_name: code-2-cline-model-x",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: http://127.0.0.1:28180/v1",
  "- model_name: code-7-explabs-model-x",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: https://api.experientiallabs.ai/v1",
  "    api_key: os.environ/EXPLABS_API_KEY",
  "- model_name: code-5-nvidia-model-x",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: https://integrate.api.nvidia.com/v1",
  // The second chain has to match something too, or the whole compose is refused.
  "- model_name: ds-qwen3.5-27b",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "router_settings:",
  "  model_group_alias:",
  "    coding-fallback: stale",
  "  fallbacks:",
  "  - stale:",
  "    - stale",
  "  num_retries: 2",
  "",
].join("\n");

const EXP_LABS = "api.experientiallabs.ai";

interface FreeSpec {
  readonly id: string;
  readonly contextWindow?: number;
}

function snapshotWith(free: readonly FreeSpec[], host = EXP_LABS): FreeSnapshot {
  const parsed = parseFreeSnapshot(
    JSON.stringify({
      attribution: "fixture",
      retrieved: "2026-10-14T12:00:00.000Z",
      providers: [
        {
          host,
          baseUrl: `https://${host}/v1`,
          endpoint: `https://${host}/v1/models`,
          retrieved: "2026-10-14T12:00:00.000Z",
          listed: 294,
          free: free.map((entry) => ({
            id: entry.id,
            contextWindow: entry.contextWindow ?? 262144,
            maxOutput: 65536,
            reasoning: true,
            tools: true,
            uncensored: false,
          })),
          excluded: [],
        },
      ],
    }),
  );
  assert.ok(parsed, "the fixture snapshot must parse");
  return parsed;
}

/** One listing entry in the shape the upstream endpoint actually returns. */
function listingEntry(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "model-a",
    object: "model",
    supports_completions: true,
    supports_embeddings: null,
    supports_reasoning: true,
    supports_tools: true,
    uncensored: false,
    context_window_tokens: 262144,
    maximum_output_tokens: 65536,
    pricing: {
      input_nano_usd_per_million_tokens: 300_000_000,
      output_nano_usd_per_million_tokens: 1_200_000_000,
    },
    ...overrides,
  };
}

function compose(text: string, free?: FreeSnapshot) {
  const outcome = composeCodingFallback(text, SCORES, free);
  assert.ok(outcome.ok, "the fixture must compose");
  return outcome;
}

test("a present price of zero on both meters is free", () => {
  const result = classifyListingEntry(
    listingEntry({
      id: "ling-3.1-flash",
      pricing: { input_nano_usd_per_million_tokens: 0, output_nano_usd_per_million_tokens: 0 },
    }),
  );
  assert.equal(result?.reason, undefined);
  assert.equal(result?.model?.id, "ling-3.1-flash");
  assert.equal(result?.model?.contextWindow, 262144);
});

test("a missing price is not a zero price", () => {
  const stub = classifyListingEntry({ id: "qwen3-max", object: "model", owned_by: "exp" });
  assert.equal(stub?.reason, "no-price");
  assert.equal(stub?.model, undefined);

  const nullMeter = classifyListingEntry(
    listingEntry({
      pricing: { input_nano_usd_per_million_tokens: null, output_nano_usd_per_million_tokens: 0 },
    }),
  );
  assert.equal(nullMeter?.reason, "no-price");

  const noPricingObject = classifyListingEntry(listingEntry({ pricing: undefined }));
  assert.equal(noPricingObject?.reason, "no-price");
});

test("an ordinary paid model is not reported at all", () => {
  assert.equal(classifyListingEntry(listingEntry({})), undefined);
  // An embedding endpoint meters output at zero structurally; that is a cheap
  // direction, not a free model, and not worth reporting.
  assert.equal(
    classifyListingEntry(
      listingEntry({
        id: "text-embedding-3-small",
        supports_completions: false,
        supports_embeddings: true,
        pricing: { input_nano_usd_per_million_tokens: 20_000_000, output_nano_usd_per_million_tokens: 0 },
      }),
    ),
    undefined,
  );
});

test("one zero meter on a chat model is reported as partial, never as free", () => {
  const result = classifyListingEntry(
    listingEntry({
      id: "clef",
      supports_completions: true,
      pricing: { input_nano_usd_per_million_tokens: 240_000_000, output_nano_usd_per_million_tokens: 0 },
    }),
  );
  assert.equal(result?.reason, "partial-free");
  assert.equal(result?.model, undefined);
});

test("a zero-priced non-chat or undescribed entry is excluded with a reason", () => {
  const zero = { input_nano_usd_per_million_tokens: 0, output_nano_usd_per_million_tokens: 0 };
  assert.equal(classifyListingEntry(listingEntry({ pricing: zero, supports_completions: false }))?.reason, "not-chat");
  assert.equal(classifyListingEntry(listingEntry({ pricing: zero, supports_embeddings: true }))?.reason, "not-chat");
  assert.equal(classifyListingEntry(listingEntry({ pricing: zero, context_window_tokens: null }))?.reason, "no-context-window");
});

test("a live-shaped listing is reduced to its free models, sorted", () => {
  const target = FREE_PROBE_TARGETS[0];
  const listing = {
    object: "list",
    data: [
      listingEntry({ id: "z-model" }),
      listingEntry({
        id: "ling-3.1-flash",
        pricing: { input_nano_usd_per_million_tokens: 0, output_nano_usd_per_million_tokens: 0 },
      }),
      { id: "qwen3-max", object: "model" },
      listingEntry({
        id: "a-model",
        pricing: { input_nano_usd_per_million_tokens: 0, output_nano_usd_per_million_tokens: 0 },
      }),
    ],
  };

  const provider = buildProviderSnapshot(target, listing, "2026-10-14T12:00:00.000Z");
  assert.equal(provider.listed, 4);
  assert.deepEqual(provider.free.map((model) => model.id), ["a-model", "ling-3.1-flash"]);
  assert.deepEqual(provider.excluded, [{ id: "qwen3-max", reason: "no-price" }]);
});

test("a written snapshot round-trips, and a malformed one is not a snapshot", () => {
  const snapshot = snapshotWith([{ id: "ling-3.1-flash" }]);
  const reparsed = parseFreeSnapshot(JSON.stringify(snapshot));
  assert.deepEqual(reparsed?.providers[0].free, snapshot.providers[0].free);
  assert.deepEqual(reparsed?.providers[0].free.map((model) => model.id), ["ling-3.1-flash"]);

  assert.equal(parseFreeSnapshot("{ not json"), undefined);
  assert.equal(parseFreeSnapshot("[]"), undefined);
  const empty = parseFreeSnapshot(JSON.stringify({ attribution: "x", retrieved: null, providers: [] }));
  assert.deepEqual(empty?.providers, []);
});

test("generated group names are recognised as managed, and join the coding chain", () => {
  const name = freeModelGroupName("explabs", "ling-3.1-flash");
  assert.equal(name, "code-free-explabs-ling-3.1-flash");
  assert.ok(isManagedModelName(name));
  assert.ok(CODING_CHAIN.matches(name), "a generated group must belong to the coding chain");
  assert.ok(CODING_CHAIN.matches("code-7-explabs-model-x"));
  assert.ok(!CODING_CHAIN.matches("ds-qwen3.5-27b"));
});

test("a free model not in model_list is added as a generated group", () => {
  const outcome = compose(CONFIG, snapshotWith([{ id: "ling-3.1-flash" }]));

  assert.deepEqual(outcome.free.included, [
    { name: "code-free-explabs-ling-3.1-flash", id: "ling-3.1-flash", host: EXP_LABS },
  ]);
  assert.ok(outcome.changed);

  const added = outcome.text.split("\n");
  const at = added.indexOf("- model_name: code-free-explabs-ling-3.1-flash");
  assert.ok(at > 0, "the generated group must be in the output");
  assert.deepEqual(added.slice(at, at + 5), [
    "- model_name: code-free-explabs-ling-3.1-flash",
    "  litellm_params:",
    "    model: openai/ling-3.1-flash",
    "    api_base: https://api.experientiallabs.ai/v1",
    "    api_key: os.environ/EXPLABS_API_KEY",
  ]);
  // It belongs to the chain, so it must appear in the generated fallback matrix.
  assert.match(outcome.text, /- code-free-explabs-ling-3\.1-flash$/m);

  // The hand-written entry is untouched, and no second one appeared for it.
  const entryLines = (text: string) =>
    text.split("\n").filter((line) => /^- model_name:/.test(line));
  assert.deepEqual(entryLines(outcome.text), [
    ...entryLines(CONFIG),
    "- model_name: code-free-explabs-ling-3.1-flash",
  ]);
});

test("adding a free model is idempotent", () => {
  const first = compose(CONFIG, snapshotWith([{ id: "ling-3.1-flash" }]));
  const second = compose(first.text, snapshotWith([{ id: "ling-3.1-flash" }]));
  assert.equal(second.changed, false, "a second compose must not churn the file");
  assert.equal(second.free.pruned.length, 0);
  assert.deepEqual(second.free.included, first.free.included);
});

test("a promo that ends takes its generated group with it", () => {
  const withPromo = compose(CONFIG, snapshotWith([{ id: "ling-3.1-flash" }])).text;
  const ended = compose(withPromo, snapshotWith([]));

  assert.deepEqual(ended.free.pruned, ["code-free-explabs-ling-3.1-flash"]);
  assert.ok(!ended.text.includes("code-free-explabs"), "the group must be gone");
  assert.equal(ended.changed, true);

  // ...and settling back is stable.
  assert.equal(compose(ended.text, snapshotWith([])).changed, false);
});

test("a missing snapshot leaves model_list exactly as found", () => {
  const withPromo = compose(CONFIG, snapshotWith([{ id: "ling-3.1-flash" }])).text;
  const unreadable = compose(withPromo, undefined);

  assert.equal(unreadable.free.snapshotMissing, true);
  assert.deepEqual(unreadable.free.pruned, [], "an unreadable snapshot is not evidence a promo ended");
  assert.ok(unreadable.text.includes("code-free-explabs-ling-3.1-flash"), "the group must survive");
});

test("a host the snapshot does not cover keeps its generated groups", () => {
  const withPromo = compose(CONFIG, snapshotWith([{ id: "ling-3.1-flash" }])).text;
  const otherHost = compose(withPromo, snapshotWith([{ id: "x" }], "relay.example.invalid"));

  assert.deepEqual(otherHost.free.pruned, []);
  assert.ok(otherHost.text.includes("code-free-explabs-ling-3.1-flash"));
});

test("a free model a hand-written group already serves gets no second group", () => {
  // The fixture's code-7-explabs-model-x already targets openai/model-x on ExpLabs.
  const outcome = compose(CONFIG, snapshotWith([{ id: "model-x" }]));

  assert.deepEqual(outcome.free.included, []);
  assert.deepEqual(outcome.free.alreadyPresent, ["model-x"]);
  assert.ok(!outcome.text.includes("code-free-"), "no duplicate group may be generated");
});

test("a zero price beats the host's standing tier in the tie-break", () => {
  const freeKeys = new Set([freeUpstreamKey(EXP_LABS, "model-x")]);

  // ExpLabs is the monthly tier, which loses the tie to the two daily hosts.
  assert.equal(tierForHost(EXP_LABS), TIER_MONTHLY);
  assert.equal(tierForEntry({ name: "code-7-explabs-model-x", upstream: "model-x", host: EXP_LABS }, new Set()), TIER_MONTHLY);
  assert.equal(tierForEntry({ name: "code-7-explabs-model-x", upstream: "model-x", host: EXP_LABS }, freeKeys), TIER_FREE);

  const ranked = compose(CONFIG, snapshotWith([{ id: "model-x" }]));
  const head = ranked.chains.find((chain) => chain.alias === "coding-fallback");
  assert.equal(head?.head, "code-7-explabs-model-x", "the free supplier must win the tie and head the chain");
});

/**
 * The shape the live config actually has: an existing supplier of one model going
 * free, with a better-scored model that it must still come after. The tier
 * override reorders within a tie; it does not promote a model past a better score.
 */
test("a zero price reorders within its tie and cannot outrank a better score", () => {
  const config = [
    "model_list:",
    "- model_name: code-20-cline-model-top",
    "  litellm_params:",
    "    model: openai/model-top",
    "    api_base: http://127.0.0.1:28180/v1",
    "- model_name: code-2-cline-model-x",
    "  litellm_params:",
    "    model: openai/model-x",
    "    api_base: http://127.0.0.1:28180/v1",
    "- model_name: code-5-nvidia-model-x",
    "  litellm_params:",
    "    model: openai/model-x",
    "    api_base: https://integrate.api.nvidia.com/v1",
    "- model_name: code-7-explabs-model-x",
    "  litellm_params:",
    "    model: openai/model-x",
    "    api_base: https://api.experientiallabs.ai/v1",
    "- model_name: ds-qwen3.5-27b",
    "  litellm_params:",
    "    model: openai/model-x",
    "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "router_settings:",
    "  model_group_alias:",
    "    coding-fallback: stale",
    "  fallbacks:",
    "  - stale:",
    "    - stale",
    "  num_retries: 2",
    "",
  ].join("\n");

  const entries = readModelEntries(config.split("\n"));
  const plain = orderChain(entries, CODING_CHAIN, SCORES).map((entry) => entry.name);
  const boosted = orderChain(entries, CODING_CHAIN, SCORES, freeUpstreamKeys(snapshotWith([{ id: "model-x" }]))).map(
    (entry) => entry.name,
  );

  assert.deepEqual(plain, [
    "code-20-cline-model-top",
    "code-2-cline-model-x",
    "code-5-nvidia-model-x",
    "code-7-explabs-model-x",
  ]);
  assert.deepEqual(boosted, [
    "code-20-cline-model-top",
    "code-7-explabs-model-x",
    "code-2-cline-model-x",
    "code-5-nvidia-model-x",
  ]);
});

test("reconcileFreeEntries is a no-op without a snapshot", () => {
  const lines = CONFIG.split("\n");
  const result = reconcileFreeEntries(lines, undefined);
  assert.deepEqual(result.lines, lines);
  assert.equal(result.report.snapshotMissing, true);
});

test("the live config accepts a generated group without disturbing its own entries", async () => {
  const live = await readFile(join(process.env.HOME ?? "", ".pi", "agent", "litellm_config.yaml"), "utf8").catch(() => "");
  if (live === "") return; // no live config on this machine; nothing to check

  const outcome = compose(live, snapshotWith([{ id: "ling-3.1-flash" }]));
  const liveNames = live.split(/\r?\n/).filter((line) => /^- model_name:/.test(line));
  const composedNames = outcome.text.split(/\r?\n/).filter((line) => /^- model_name:/.test(line));
  assert.deepEqual(composedNames, [...liveNames, "- model_name: code-free-explabs-ling-3.1-flash"]);
  assert.equal(outcome.free.covered.length, 1);
  assert.deepEqual(outcome.free.unpriced, [], "the snapshot fixture reports no exclusions");
});

test("sync writes a generated group into the config and reports it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coding-fallback-free-"));
  const config = join(dir, "litellm_config.yaml");
  const scores = join(dir, "aaii-scores.json");
  const free = join(dir, "free-models.json");
  try {
    await writeFile(config, CONFIG, "utf8");
    await writeFile(scores, JSON.stringify({ attribution: "fixture", scores: { "model-x": { score: 40 } }, aliases: {} }), "utf8");
    await writeFile(free, JSON.stringify(snapshotWith([{ id: "ling-3.1-flash" }])), "utf8");

    const check = await checkFallback(config, scores, free);
    assert.equal(check.state, "drifted");
    assert.match(check.message, /free model included: code-free-explabs-ling-3\.1-flash/);

    const sync = await syncFallback(config, scores, free);
    assert.equal(sync.state, "written");
    assert.match(sync.message, /free model included/);
    assert.match(await readFile(config, "utf8"), /^- model_name: code-free-explabs-ling-3\.1-flash$/m);

    // The promo ends: the next sync takes the group back out.
    await writeFile(free, JSON.stringify(snapshotWith([])), "utf8");
    const ended = await syncFallback(config, scores, free);
    assert.equal(ended.state, "written");
    assert.match(ended.message, /removed 1 group/);
    assert.ok(!(await readFile(config, "utf8")).includes("code-free-explabs"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
