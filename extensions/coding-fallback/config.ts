/**
 * File-level operations for the coding fallback config.
 *
 * Deliberately free of Pi SDK imports so it runs under plain `node --test`. The
 * caller passes both paths in and every function returns a plain result, which
 * keeps the write path (backup, replace, verify) testable without a running
 * proxy or a Pi session.
 */

import { copyFile, readFile, writeFile } from "node:fs/promises";
import { composeCodingFallback } from "./chain.ts";
import type { ChainSummary, FreeInclusionReport } from "./chain.ts";
import { describeTimestamp, loadFreeSnapshot } from "./free-models.ts";
import type { FreeSnapshot } from "./free-models.ts";
import { insertModelEntry } from "./register.ts";
import type { NewModel } from "./register.ts";
import { loadScores } from "./scores.ts";
import type { ScoreSnapshot } from "./scores.ts";

const LABEL = "coding-fallback";

export interface FallbackCheck {
  readonly state: "up-to-date" | "drifted" | "error";
  readonly message: string;
  readonly chains: readonly ChainSummary[];
}

export interface FallbackSync {
  readonly state: "written" | "no-change" | "error";
  readonly message: string;
  readonly backupPath?: string;
  readonly chains: readonly ChainSummary[];
}

export interface FallbackAdd {
  readonly state: "written" | "error";
  readonly message: string;
  readonly backupPath?: string;
  readonly chains: readonly ChainSummary[];
}

function summarize(chains: readonly ChainSummary[]): string {
  return chains.map((chain) => `${chain.alias} (${chain.memberCount} members, head ${chain.head})`).join("; ");
}

function noticeFor(
  chains: readonly ChainSummary[],
  unclassified: readonly string[],
  reordered: readonly { alias: string; before: readonly string[]; after: readonly string[] }[],
  free: FreeInclusionReport,
  freeRetrieved: string | null,
): string[] {
  const notices: string[] = [];

  if (free.snapshotMissing) {
    notices.push(
      "no free-model snapshot could be read, so model_list was left exactly as found " +
        "(a missing snapshot is not evidence that a promo ended)",
    );
  } else {
    for (const entry of free.included) {
      notices.push(`free model included: ${entry.name} (${entry.host} lists $0 in and $0 out)`);
    }
    if (free.pruned.length > 0) {
      notices.push(
        `removed ${free.pruned.length} group(s) the listing no longer shows at zero cost: ${free.pruned.join(", ")}`,
      );
    }
    if (free.alreadyPresent.length > 0) {
      notices.push(
        `already in the chain and now free: ${free.alreadyPresent.join(", ")} — ` +
          "each now outranks every other supplier of the same model",
      );
    }
    if (free.unpriced.length > 0) {
      notices.push(
        `listing publishes no price for ${free.unpriced.join(", ")} — reported, never treated as free`,
      );
    }
    if (free.covered.length > 0) {
      notices.push(`free-model snapshot read ${describeTimestamp(freeRetrieved)}`);
    }
  }

  for (const chain of chains) {
    if (chain.unscored.length > 0) {
      notices.push(
        `${chain.unscored.length} unranked in ${chain.alias} (no AAII score): ${chain.unscored.join(", ")}`,
      );
    }
  }
  if (unclassified.length > 0) {
    notices.push(`hosts with no quota tier, sorting last: ${unclassified.join(", ")}`);
  }
  for (const change of reordered) {
    // The list is compared whole, so an added member changes it without moving
    // the head. Naming the head move only when there was one keeps the notice
    // from reading "X -> X".
    const head = change.before[0];
    const now = change.after[0];
    const moved = head === now ? "" : `, head ${head} -> ${now}`;
    notices.push(
      `${change.alias}: the order changes (${change.before.length} -> ${change.after.length} members${moved})`,
    );
  }
  return notices;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function noticesFor(composed: Composed): string[] {
  const notices = noticeFor(
    composed.chains,
    composed.unclassifiedHosts,
    composed.reordered,
    composed.free,
    composed.freeRetrieved,
  );
  if (composed.freeReadError) notices.push(composed.freeReadError);
  return notices;
}

/** Staleness of the free-model snapshot, as a notice, or `null` when it is current. */
function freeStalenessNotice(composed: Composed): string | null {
  if (composed.free.snapshotMissing || !composed.freeRetrieved) return null;
  const at = Date.parse(composed.freeRetrieved);
  if (Number.isNaN(at)) return null;
  const age = Date.now() - at;
  return age > FREE_SNAPSHOT_STALE_MS
    ? `free-model snapshot at ${composed.freePath} is ${Math.floor(age / 86_400_000)}d old; ` +
        "refresh it before trusting which models are free"
    : null;
}

interface Composed {
  readonly freeReadError?: string;
  readonly text: string;
  readonly changed: boolean;
  readonly chains: readonly ChainSummary[];
  readonly reordered: readonly { alias: string; before: readonly string[]; after: readonly string[] }[];
  readonly unclassifiedHosts: readonly string[];
  readonly scoreCount: number;
  readonly free: FreeInclusionReport;
  readonly freeRetrieved: string | null;
  readonly freePath: string;
}

/** The three inputs a compose needs, before anything is composed. */
interface Inputs {
  readonly freeReadError?: string;
  readonly text: string;
  readonly scores: ScoreSnapshot;
  readonly free: FreeSnapshot | undefined;
}

async function readInputs(
  configPath: string,
  scoresPath: string,
  freePath?: string,
): Promise<Inputs | { readonly error: string }> {
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    return { error: `cannot read ${configPath} (${describeError(error)})` };
  }

  let scores: ScoreSnapshot;
  try {
    scores = await loadScores(scoresPath);
  } catch (error) {
    return { error: describeError(error) };
  }
  let free: FreeSnapshot | undefined;
  try {
    free = freePath ? await loadFreeSnapshot(freePath) : undefined;
  } catch (error) {
    return { text, scores, free: undefined, freeReadError: describeError(error) };
  }
  return { text, scores, free };
}

/**
 * Compose text that was already read. `where` names the file in the refusal,
 * which is what tells the operator which config was not understood.
 */
function composeText(
  inputs: Inputs,
  freePath: string | undefined,
  where: string,
): Composed | { readonly error: string } {
  const outcome = composeCodingFallback(inputs.text, inputs.scores, inputs.free);
  if (!outcome.ok) {
    return { error: `${where} was not understood — ${outcome.reason}` };
  }

  return {
    text: outcome.text,
    changed: outcome.changed,
    chains: outcome.chains,
    reordered: outcome.reordered,
    unclassifiedHosts: outcome.unclassifiedHosts,
    scoreCount: inputs.scores.scores.size,
    free: outcome.free,
    freeRetrieved: inputs.free?.retrieved ?? null,
    freePath: freePath ?? "(none)",
    freeReadError: inputs.freeReadError,
  };
}

/** The config as it is on disk, or the reason it cannot be read. */
export async function readConfig(
  configPath: string,
): Promise<{ readonly text: string } | { readonly error: string }> {
  try {
    return { text: await readFile(configPath, "utf8") };
  } catch (error) {
    return { error: `cannot read ${configPath} (${describeError(error)})` };
  }
}

async function compose(
  configPath: string,
  scoresPath: string,
  freePath?: string,
): Promise<Composed | { readonly error: string }> {
  const inputs = await readInputs(configPath, scoresPath, freePath);
  if ("error" in inputs) return { error: `${LABEL}: ${inputs.error}` };

  const composed = composeText(inputs, freePath, configPath);
  return "error" in composed ? { error: `${LABEL}: ${composed.error}` } : composed;
}

/** `true` when the snapshot is old enough that treating it as current would be a guess. */
const FREE_SNAPSHOT_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Report whether the generated blocks still match `model_list`. Read-only. */
export async function checkFallback(
  configPath: string,
  scoresPath: string,
  freePath?: string,
): Promise<FallbackCheck> {
  const composed = await compose(configPath, scoresPath, freePath);
  if ("error" in composed) {
    return { state: "error", message: composed.error, chains: [] };
  }

  const notices = noticesFor(composed);
  const stale = freeStalenessNotice(composed);
  if (stale) notices.push(stale);
  const detail = notices.length > 0 ? `\n  - ${notices.join("\n  - ")}` : "";

  if (composed.scoreCount === 0) {
    return {
      state: "error",
      message: `${LABEL}: no AAII scores loaded from ${scoresPath}; ordering would fall back to quota tier alone.${detail}`,
      chains: composed.chains,
    };
  }

  if (!composed.changed) {
    return {
      state: "up-to-date",
      message: `${LABEL}: up to date — ${summarize(composed.chains)}${detail}`,
      chains: composed.chains,
    };
  }

  return {
    state: "drifted",
    message: `${LABEL}: out of date — ${summarize(composed.chains)}${detail}. Run /${LABEL} sync to regenerate the fallback blocks.`,
    chains: composed.chains,
  };
}

/**
 * Rewrite the generated blocks. Writes only when the composed text differs from
 * the file, so a correct config is never churned, and copies the original to a
 * timestamped sibling first.
 *
 * Refuses to write when no scores loaded: reordering a chain with nothing to
 * rank by would replace a considered order with an arbitrary one.
 */
export async function syncFallback(
  configPath: string,
  scoresPath: string,
  freePath?: string,
): Promise<FallbackSync> {
  const composed = await compose(configPath, scoresPath, freePath);
  if ("error" in composed) {
    return { state: "error", message: composed.error, chains: [] };
  }

  const notices = noticesFor(composed);
  const stale = freeStalenessNotice(composed);
  if (stale) notices.push(stale);
  const detail = notices.length > 0 ? `\n  - ${notices.join("\n  - ")}` : "";

  if (composed.scoreCount === 0) {
    return {
      state: "error",
      message: `${LABEL}: refusing to write — no AAII scores loaded from ${scoresPath}, so the chain would be ordered by quota tier alone.${detail}`,
      chains: composed.chains,
    };
  }

  if (!composed.changed) {
    return {
      state: "no-change",
      message: `${LABEL}: nothing to do — ${summarize(composed.chains)}${detail}`,
      chains: composed.chains,
    };
  }

  const backupPath = `${configPath}.bak-${timestamp()}`;
  try {
    await copyFile(configPath, backupPath);
    await writeFile(configPath, composed.text, "utf8");
  } catch (error) {
    return {
      state: "error",
      message: `${LABEL}: write failed (${describeError(error)}); backup at ${backupPath}`,
      backupPath,
      chains: composed.chains,
    };
  }

  return {
    state: "written",
    message: `${LABEL}: rewrote the fallback blocks — ${summarize(composed.chains)}${detail}. Backup: ${backupPath}. Restart LiteLLM to apply.`,
    backupPath,
    chains: composed.chains,
  };
}

/**
 * Add one hand-written group and rewrite the generated blocks in the same pass.
 *
 * One write, not two: inserting the entry and composing it into the chains are
 * the same edit, and a file that briefly holds a group the chains do not know
 * about is a config no reader of it should see. The backup is taken before the
 * write, exactly as `sync` takes it, and both guards still apply — a config this
 * module does not understand, and a chain that would be ordered by quota tier
 * alone, are refused before anything is written.
 */
export async function addModels(
  configPath: string,
  scoresPath: string,
  freePath: string | undefined,
  models: readonly NewModel[],
): Promise<FallbackAdd> {
  if (models.length === 0) return { state: "error", message: `${LABEL}: nothing to add`, chains: [] };

  const inputs = await readInputs(configPath, scoresPath, freePath);
  if ("error" in inputs) return { state: "error", message: `${LABEL}: ${inputs.error}`, chains: [] };

  let text = inputs.text;
  for (const model of models) {
    const inserted = insertModelEntry(text, model);
    if (!inserted.ok) return { state: "error", message: `${LABEL}: ${inserted.reason}`, chains: [] };
    text = inserted.text;
  }

  const composed = composeText({ ...inputs, text }, freePath, configPath);
  if ("error" in composed) {
    // The entries are named back, not just refused: a batch is registered one
    // confirmation at a time, and the operator has to know that none of what was
    // just agreed to reached the file.
    const names = models.map((model) => model.name).join(", ");
    const subject = models.length === 1 ? `${names} was not added` : `none of ${names} was added`;
    return { state: "error", message: `${LABEL}: ${subject} — ${composed.error}`, chains: [] };
  }

  const notices = noticesFor(composed);
  const stale = freeStalenessNotice(composed);
  if (stale) notices.push(stale);
  const detail = notices.length > 0 ? `\n  - ${notices.join("\n  - ")}` : "";

  if (composed.scoreCount === 0) {
    return {
      state: "error",
      message: `${LABEL}: refusing to write — no AAII scores loaded from ${scoresPath}, so the chain would be ordered by quota tier alone.${detail}`,
      chains: composed.chains,
    };
  }

  const backupPath = `${configPath}.bak-${timestamp()}`;
  try {
    await copyFile(configPath, backupPath);
    await writeFile(configPath, composed.text, "utf8");
  } catch (error) {
    return {
      state: "error",
      message: `${LABEL}: write failed (${describeError(error)}); backup at ${backupPath}`,
      backupPath,
      chains: composed.chains,
    };
  }

  return {
    state: "written",
    message: `${LABEL}: added ${models.map((model) => model.name).join(", ")} — ${summarize(composed.chains)}${detail}. Backup: ${backupPath}. Restart LiteLLM to apply.`,
    backupPath,
    chains: composed.chains,
  };
}

/** One model, for the scriptable form and for a caller that has exactly one. */
export async function addModel(
  configPath: string,
  scoresPath: string,
  freePath: string | undefined,
  model: NewModel,
): Promise<FallbackAdd> {
  return addModels(configPath, scoresPath, freePath, [model]);
}
