/**
 * Tests for the file-level fallback operations (backup, write, verify).
 *
 * Run with:
 *   node --test extensions/coding-fallback/config.test.ts
 *
 * Every test works on throwaway copies in the system temp directory. The live
 * config is only ever read, never written, and no fixture carries credential
 * material: the composer reads `model_name`, `litellm_params.model`, and
 * `api_base` only.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { composeCodingFallback } from "./chain.ts";
import { addModel, addModels, checkFallback, syncFallback } from "./config.ts";
import { parseScores } from "./scores.ts";
import type { ScoreSnapshot } from "./scores.ts";

const SCORE_JSON = JSON.stringify({
  attribution: "fixture",
  scores: {
    "model-x": { slug: "model-x", score: 40, variant: "reasoning" },
    "model-y": { slug: "model-y", score: 30, variant: "reasoning" },
  },
  aliases: {},
});
const EMPTY_SCORE_JSON = JSON.stringify({ attribution: "fixture", scores: {}, aliases: {} });
/** The same table plus a model that outranks everything the fixture already serves. */
const BEST_SCORE_JSON = JSON.stringify({
  attribution: "fixture",
  scores: {
    "model-x": { slug: "model-x", score: 40, variant: "reasoning" },
    "model-y": { slug: "model-y", score: 30, variant: "reasoning" },
    "model-z": { slug: "model-z", score: 50, variant: "reasoning" },
  },
  aliases: {},
});
const SCORES = parseScores(SCORE_JSON) as ScoreSnapshot;

const CONFIG = [
  "model_list:",
  "- model_name: code-1-explabs",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: https://api.experientiallabs.ai/v1",
  "- model_name: code-2-nvidia",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: https://integrate.api.nvidia.com/v1",
  "- model_name: ds-qwen3.5-27b",
  "  litellm_params:",
  "    model: openai/model-y",
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

/** A config that already matches the policy, so a check must report no drift. */
const SETTLED = (() => {
  const outcome = composeCodingFallback(CONFIG, SCORES);
  if (!outcome.ok) throw new Error(`fixture did not compose: ${outcome.reason}`);
  return outcome.text;
})();

const UNREADABLE = ["model_list:", "- model_name: code-1-a", ""].join("\n");

/**
 * A config whose `model_list` belongs to no chain this package composes. The
 * generated blocks are there, the names are not, so every compose refuses it.
 */
const FOREIGN = CONFIG.replace(/^- model_name: (?:code|ds)-/gm, "- model_name: other-");

/**
 * The fixture without its DashScope member: one chain, not two. A config
 * trimmed this way is still managed (the live config was, on 2026-10-16).
 */
const TRIMMED = CONFIG.replace(
  "- model_name: ds-qwen3.5-27b\n  litellm_params:\n    model: openai/model-y\n    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1\n",
  "",
);

interface Temp {
  readonly dir: string;
  readonly config: string;
  readonly scores: string;
}

async function makeTemp(configText: string, scoreText: string): Promise<Temp> {
  const dir = await mkdtemp(join(tmpdir(), "coding-fallback-"));
  const config = join(dir, "litellm_config.yaml");
  const scores = join(dir, "aaii-scores.json");
  await writeFile(config, configText, "utf8");
  await writeFile(scores, scoreText, "utf8");
  return { dir, config, scores };
}

async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

test("reports an unreadable config instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coding-fallback-"));
  try {
    const result = await checkFallback(join(dir, "missing.yaml"), join(dir, "missing.json"));
    assert.equal(result.state, "error");
    assert.match(result.message, /cannot read/);
  } finally {
    await cleanup(dir);
  }
});

test("reports a config it does not understand instead of writing", async () => {
  const temp = await makeTemp(UNREADABLE, SCORE_JSON);
  try {
    const check = await checkFallback(temp.config, temp.scores);
    assert.equal(check.state, "error");
    assert.match(check.message, /model_group_alias/);

    const sync = await syncFallback(temp.config, temp.scores);
    assert.equal(sync.state, "error");
    assert.equal(await readFile(temp.config, "utf8"), UNREADABLE, "unreadable config must be left alone");
    assert.deepEqual((await readdir(temp.dir)).sort(), ["aaii-scores.json", "litellm_config.yaml"]);
  } finally {
    await cleanup(temp.dir);
  }
});

test("refuses to write when no AAII scores are loaded", async () => {
  const temp = await makeTemp(CONFIG, EMPTY_SCORE_JSON);
  try {
    const sync = await syncFallback(temp.config, temp.scores);
    assert.equal(sync.state, "error");
    assert.match(sync.message, /refusing to write/);
    assert.equal(await readFile(temp.config, "utf8"), CONFIG, "the config must be untouched");
    assert.deepEqual((await readdir(temp.dir)).sort(), ["aaii-scores.json", "litellm_config.yaml"]);

    const check = await checkFallback(temp.config, temp.scores);
    assert.equal(check.state, "error", "a check must also flag the missing scores");
  } finally {
    await cleanup(temp.dir);
  }
});

test("reports an already-correct config as up to date", async () => {
  const temp = await makeTemp(SETTLED, SCORE_JSON);
  try {
    const result = await checkFallback(temp.config, temp.scores);
    assert.equal(result.state, "up-to-date");
    assert.equal(result.chains.length, 2);
  } finally {
    await cleanup(temp.dir);
  }
});

test("detects drift and names the head that moves", async () => {
  const temp = await makeTemp(CONFIG, SCORE_JSON);
  try {
    const result = await checkFallback(temp.config, temp.scores);
    assert.equal(result.state, "drifted");
    assert.match(result.message, /code-2-nvidia/, "the new head should be reported");
    assert.match(result.message, /sync/);
  } finally {
    await cleanup(temp.dir);
  }
});

test("sync writes the config, keeps a backup, and settles the drift", async () => {
  const temp = await makeTemp(CONFIG, SCORE_JSON);
  try {
    const result = await syncFallback(temp.config, temp.scores);
    assert.equal(result.state, "written");
    assert.ok(result.backupPath, "a backup path should be reported");
    assert.equal(await readFile(result.backupPath!, "utf8"), CONFIG, "backup must hold the pre-write text");
    assert.equal(await readFile(temp.config, "utf8"), SETTLED);

    const second = await syncFallback(temp.config, temp.scores);
    assert.equal(second.state, "no-change", "a second sync must be a no-op");
    assert.equal((await readdir(temp.dir)).length, 3, "a no-op sync must not add another backup");
  } finally {
    await cleanup(temp.dir);
  }
});

test("adds a group, keeps a backup, and the chain picks it up", async () => {
  const temp = await makeTemp(CONFIG, BEST_SCORE_JSON);
  try {
    const result = await addModel(temp.config, temp.scores, undefined, {
      name: "code-3-nvidia-model-z",
      modelId: "model-z",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: "os.environ/NVIDIA_API_KEY",
    });

    assert.equal(result.state, "written");
    assert.ok(result.backupPath, "a backup path should be reported");
    assert.equal(await readFile(result.backupPath!, "utf8"), CONFIG, "backup must hold the pre-write text");

    const written = await readFile(temp.config, "utf8");
    assert.match(written, /^- model_name: code-3-nvidia-model-z$/m);
    assert.match(written, /^    api_key: os\.environ\/NVIDIA_API_KEY$/m);
    assert.equal(
      result.chains.find((chain) => chain.alias === "coding-fallback")?.head,
      "code-3-nvidia-model-z",
      "a better score takes the head",
    );
    assert.match(result.message, /added code-3-nvidia-model-z/);
    assert.match(result.message, /Restart LiteLLM/);

    const check = await checkFallback(temp.config, temp.scores);
    assert.equal(check.state, "up-to-date", "one write leaves the config settled");
  } finally {
    await cleanup(temp.dir);
  }
});

test("reports an unranked model it added, and leaves it at the back", async () => {
  const temp = await makeTemp(CONFIG, SCORE_JSON);
  try {
    const result = await addModel(temp.config, temp.scores, undefined, {
      name: "code-3-nvidia-model-never-scored",
      modelId: "model-never-scored",
      baseUrl: "https://integrate.api.nvidia.com/v1",
    });

    assert.equal(result.state, "written");
    assert.match(result.message, /unranked/);
    assert.match(result.message, /code-3-nvidia-model-never-scored/);
    assert.equal(
      result.chains.find((chain) => chain.alias === "coding-fallback")?.head,
      "code-2-nvidia",
      "a scored model keeps the head",
    );
  } finally {
    await cleanup(temp.dir);
  }
});

test("a name already in model_list is refused without a write", async () => {
  const temp = await makeTemp(CONFIG, SCORE_JSON);
  try {
    const result = await addModel(temp.config, temp.scores, undefined, {
      name: "code-1-explabs",
      modelId: "model-x",
      baseUrl: "https://api.experientiallabs.ai/v1",
    });

    assert.equal(result.state, "error");
    assert.match(result.message, /already in model_list/);
    assert.equal(await readFile(temp.config, "utf8"), CONFIG, "the config must be untouched");
    assert.deepEqual(
      (await readdir(temp.dir)).sort(),
      ["aaii-scores.json", "litellm_config.yaml"],
      "a refused add leaves no backup behind",
    );
  } finally {
    await cleanup(temp.dir);
  }
});

test("a config trimmed to one chain is still composed and written", async () => {
  // One chain with no member is not a config this module fails to read: the
  // missing chain is skipped, and the generated blocks say nothing about it.
  const temp = await makeTemp(TRIMMED, SCORE_JSON);
  try {
    const result = await addModel(temp.config, temp.scores, undefined, {
      name: "code-3-nvidia-model-z",
      modelId: "model-z",
      baseUrl: "https://integrate.api.nvidia.com/v1",
    });

    assert.equal(result.state, "written", result.message);
    const written = await readFile(temp.config, "utf8");
    assert.match(written, /^- model_name: code-3-nvidia-model-z$/m);
    assert.doesNotMatch(written, /dashscope-coding-fallback/, "a chain that is not there is not invented");
    assert.doesNotMatch(written, /qwen-quota-fallback/);
    assert.equal((await checkFallback(temp.config, temp.scores)).state, "up-to-date");
  } finally {
    await cleanup(temp.dir);
  }
});

test("a config it does not understand is refused, and the entry is not left behind", async () => {
  // Neither the entry being added nor anything already in the file belongs to a
  // chain this module composes, so the file is not its to rewrite.
  const temp = await makeTemp(FOREIGN, SCORE_JSON);
  try {
    const result = await addModel(temp.config, temp.scores, undefined, {
      name: "other-3-nvidia-model-x",
      modelId: "model-x",
      baseUrl: "https://integrate.api.nvidia.com/v1",
    });

    assert.equal(result.state, "error");
    assert.match(result.message, /other-3-nvidia-model-x was not added/);
    assert.match(result.message, /no model_list entries match "coding-fallback" or "dashscope-coding-fallback"/);
    assert.equal(await readFile(temp.config, "utf8"), FOREIGN, "the config must be untouched");
    assert.deepEqual((await readdir(temp.dir)).sort(), ["aaii-scores.json", "litellm_config.yaml"]);
  } finally {
    await cleanup(temp.dir);
  }
});

test("a batch is one write, one backup, and the chains pick it up", async () => {
  const temp = await makeTemp(CONFIG, BEST_SCORE_JSON);
  try {
    const result = await addModels(temp.config, temp.scores, undefined, [
      { name: "code-3-nvidia-model-z", modelId: "model-z", baseUrl: "https://integrate.api.nvidia.com/v1" },
      { name: "code-4-nvidia-model-never-scored", modelId: "model-never-scored", baseUrl: "https://integrate.api.nvidia.com/v1" },
    ]);

    assert.equal(result.state, "written");
    assert.equal(await readFile(result.backupPath!, "utf8"), CONFIG, "backup must hold the pre-write text");

    const written = await readFile(temp.config, "utf8");
    assert.match(written, /^- model_name: code-3-nvidia-model-z$/m);
    assert.match(written, /^- model_name: code-4-nvidia-model-never-scored$/m);
    assert.match(result.message, /added code-3-nvidia-model-z, code-4-nvidia-model-never-scored/);

    const backups = (await readdir(temp.dir)).filter((entry) => entry.includes(".bak-"));
    assert.equal(backups.length, 1, "a batch is written once, so it is backed up once");
    assert.equal(await checkFallback(temp.config, temp.scores).then((check) => check.state), "up-to-date");
  } finally {
    await cleanup(temp.dir);
  }
});

test("a batch the file cannot take is refused whole, and named back", async () => {
  const temp = await makeTemp(FOREIGN, SCORE_JSON);
  try {
    const result = await addModels(temp.config, temp.scores, undefined, [
      { name: "other-3-nvidia-model-z", modelId: "model-z", baseUrl: "https://integrate.api.nvidia.com/v1" },
      { name: "other-4-nvidia-model-x", modelId: "model-x", baseUrl: "https://integrate.api.nvidia.com/v1" },
    ]);

    assert.equal(result.state, "error");
    assert.match(result.message, /none of other-3-nvidia-model-z, other-4-nvidia-model-x was added/);
    assert.equal(await readFile(temp.config, "utf8"), FOREIGN, "the config must be untouched");
    assert.deepEqual((await readdir(temp.dir)).sort(), ["aaii-scores.json", "litellm_config.yaml"]);
  } finally {
    await cleanup(temp.dir);
  }
});

test("a batch naming one group twice writes neither entry", async () => {
  const temp = await makeTemp(CONFIG, SCORE_JSON);
  try {
    const result = await addModels(temp.config, temp.scores, undefined, [
      { name: "code-3-nvidia-model-z", modelId: "model-z", baseUrl: "https://integrate.api.nvidia.com/v1" },
      { name: "code-3-nvidia-model-z", modelId: "model-z", baseUrl: "https://integrate.api.nvidia.com/v1" },
    ]);

    assert.equal(result.state, "error");
    assert.match(result.message, /code-3-nvidia-model-z is already in model_list/);
    assert.equal(await readFile(temp.config, "utf8"), CONFIG, "the first entry must not be left behind either");
    assert.deepEqual((await readdir(temp.dir)).sort(), ["aaii-scores.json", "litellm_config.yaml"]);
  } finally {
    await cleanup(temp.dir);
  }
});

test("reports models with no score instead of ranking them silently", async () => {
  const withUnknown = CONFIG.replace(
    "- model_name: ds-qwen3.5-27b",
    "- model_name: ds-qwen3.9-mystery\n  litellm_params:\n    model: openai/model-unheard-of\n    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1\n- model_name: ds-qwen3.5-27b",
  );
  const temp = await makeTemp(withUnknown, SCORE_JSON);
  try {
    const result = await checkFallback(temp.config, temp.scores);
    assert.equal(result.state, "drifted");
    assert.match(result.message, /unranked/);
    assert.match(result.message, /ds-qwen3\.9-mystery/);
  } finally {
    await cleanup(temp.dir);
  }
});

test("reports a host that has no quota tier", async () => {
  const withHost = CONFIG.replace(
    "api_base: https://api.experientiallabs.ai/v1",
    "api_base: https://relay.example.invalid/v1",
  );
  const temp = await makeTemp(withHost, SCORE_JSON);
  try {
    const result = await checkFallback(temp.config, temp.scores);
    assert.match(result.message, /no quota tier/);
    assert.match(result.message, /relay\.example\.invalid/);
  } finally {
    await cleanup(temp.dir);
  }
});


test("check and sync refuse corrupt or unreadable scores without backup or write", async () => {
  const temp = await makeTemp(CONFIG, "{broken");
  try {
    for (const path of [temp.scores, temp.dir]) {
      for (const operation of [checkFallback, syncFallback]) {
        const result = await operation(temp.config, path);
        assert.equal(result.state, "error");
        assert.ok(result.message.includes(path));
        assert.match(result.message, /invalid scores|cannot read scores/);
      }
    }
    assert.equal(await readFile(temp.config, "utf8"), CONFIG);
    assert.deepEqual((await readdir(temp.dir)).sort(), ["aaii-scores.json", "litellm_config.yaml"]);
  } finally { await cleanup(temp.dir); }
});
