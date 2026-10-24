/**
 * Artificial Analysis Intelligence Index (AAII) lookup.
 *
 * The fallback chain orders by this score, highest first, so the score table is
 * an input the chain cannot invent. Two rules keep that honest:
 *
 *   - A model with no score is never assigned one. It sorts after every scored
 *     model and is reported, so a gap is visible instead of silently ranked.
 *   - A model whose upstream has no AA entry of its own can be pointed at a
 *     sibling's score through the snapshot's `aliases` map. That is an explicit
 *     operator decision recorded in the file, not a guess made at runtime.
 *
 * Attribution: the index is published by Artificial Analysis
 * (https://artificialanalysis.ai). Scores carry `attribution_required`, and the
 * free API tier is licensed for internal use without redistribution, so the
 * snapshot stays in-repo metadata rather than something redistributed.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** The score owner resolves the override and its module-relative default. */
export function resolveScoresPath(): string {
  const override = process.env.PI_CODING_FALLBACK_SCORES;
  return override && override.trim() !== "" ? override : fileURLToPath(new URL("./aaii-scores.json", import.meta.url));
}

export interface AaiiScore {
  /** Artificial Analysis slug the score came from, when it resolved. */
  readonly slug: string | null;
  readonly score: number | null;
  /** Which upstream variant produced the score, e.g. `reasoning`. */
  readonly variant: string | null;
  readonly sourceUrl: string | null;
  readonly cronRunDate: string | null;
}

export interface ScoreSnapshot {
  readonly attribution: string;
  readonly retrieved: string | null;
  readonly scores: ReadonlyMap<string, AaiiScore>;
  readonly aliases: ReadonlyMap<string, string>;
}

/**
 * Collapse an upstream model id to the key both the table and the lookup use:
 * the last path segment, lowercased, with `.` and `_` folded to `-`. This makes
 * the router's `deepseek-v4.1-flash` and Artificial Analysis' `deepseek-v4-1-flash`
 * the same key without a hand-written mapping per supplier.
 */
export function canonicalModelKey(id: string): string {
  const base = id.split("/").pop() ?? id;
  return base.toLowerCase().replace(/[._]/g, "-");
}

const EMPTY: ScoreSnapshot = {
  attribution: "unavailable",
  retrieved: null,
  scores: new Map(),
  aliases: new Map(),
};

function toScore(value: unknown): AaiiScore | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;

  const score = record.score;
  if (score !== null && typeof score !== "number") return undefined;

  return {
    slug: typeof record.slug === "string" ? record.slug : null,
    score: typeof score === "number" ? score : null,
    variant: typeof record.variant === "string" ? record.variant : null,
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : null,
    cronRunDate: typeof record.cronRunDate === "string" ? record.cronRunDate : null,
  };
}

/** Parse a snapshot. Returns `undefined` when the text is not a usable snapshot. */
export function parseScores(text: string): ScoreSnapshot | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;

  const record = raw as Record<string, unknown>;
  const scores = new Map<string, AaiiScore>();
  const rawScores = record.scores;
  if (rawScores && typeof rawScores === "object") {
    for (const [key, value] of Object.entries(rawScores as Record<string, unknown>)) {
      const parsed = toScore(value);
      if (parsed) scores.set(canonicalModelKey(key), parsed);
    }
  }

  const aliases = new Map<string, string>();
  const rawAliases = record.aliases;
  if (rawAliases && typeof rawAliases === "object") {
    for (const [key, value] of Object.entries(rawAliases as Record<string, unknown>)) {
      if (typeof value === "string") aliases.set(canonicalModelKey(key), canonicalModelKey(value));
    }
  }

  return {
    attribution: typeof record.attribution === "string" ? record.attribution : "unavailable",
    retrieved: typeof record.retrieved === "string" ? record.retrieved : null,
    scores,
    aliases,
  };
}

/** Read a snapshot. Only a missing file yields an empty table. */
export async function loadScores(snapshotPath: string): Promise<ScoreSnapshot> {
  let text: string;
  try {
    text = await readFile(snapshotPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY;
    throw new Error(`cannot read scores ${snapshotPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const snapshot = parseScores(text);
  if (!snapshot) throw new Error(`invalid scores ${snapshotPath}: malformed JSON or unusable snapshot`);
  return snapshot;
}

/**
 * The `aliases` and `aliasNotes` maps as written in a snapshot file.
 *
 * A refresh regenerates `scores` from the index, so it must not also regenerate
 * the alias map: that map is the one part of the snapshot this repository's
 * operator writes by hand. Rebuilding it from `{}` on every refresh would erase a
 * decision the file elsewhere calls load-bearing — an alias was added because the
 * index has no entry for a model, so dropping it silently returns that model to
 * the back of its chain.
 *
 * Takes the text rather than a path so the caller decides what an absent file
 * means, and so this is testable without one.
 */
export function aliasMapsFromSnapshot(text: string): {
  readonly aliases: Record<string, string>;
  readonly aliasNotes: Record<string, string>;
} {
  const raw: unknown = JSON.parse(text);
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const strings = (value: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (typeof entry === "string") out[key] = entry;
      }
    }
    return out;
  };

  return { aliases: strings(record.aliases), aliasNotes: strings(record.aliasNotes) };
}

/** Follow one alias hop, then read the score. `undefined` means unscored. */
export function scoreFor(snapshot: ScoreSnapshot, modelId: string): number | undefined {
  const key = canonicalModelKey(modelId);
  const aliased = snapshot.aliases.get(key);
  const score = snapshot.scores.get(aliased ?? key)?.score;
  return typeof score === "number" ? score : undefined;
}

/** Model ids with no score of their own and no alias, in the order given. */
export function unscoredModels(snapshot: ScoreSnapshot, modelIds: readonly string[]): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const id of modelIds) {
    const key = canonicalModelKey(id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (scoreFor(snapshot, id) === undefined) missing.push(id);
  }
  return missing;
}
