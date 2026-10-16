/**
 * What the model picker offers, and what the keys on it mean.
 *
 * The list comes from the upstream the operator chose, so every entry on it is
 * something that host says it serves. When that listing cannot be read, the
 * fallback is not the score table: the table's keys are Artificial Analysis'
 * own slugs with the dots folded (`deepseek-v4-1-flash`), which is not what the
 * host calls the model, and registering one would write a group that fails on
 * every call. The fallback is instead **the models this config already uses on
 * its other hosts** — ids whose spelling some upstream already accepts — and the
 * picker's title says so, so a fallback list is never mistaken for the host's own
 * answer. An id nobody uses yet is typed through the scriptable form, where the
 * operator is the one who knows how the host spells it.
 *
 * Pure: text and a score table in, candidates out. The component that draws the
 * list is `picker.ts`; this module is the part a test can check without a
 * terminal.
 */

import { readModelEntryDetails } from "./chain.ts";
import { freeUpstreamKey } from "./free-models.ts";
import { describeAddition, groupName, nextCodeNumber, upstreamOptions } from "./register.ts";
import type { UpstreamOption } from "./register.ts";
import { scoreFor } from "./scores.ts";
import type { ScoreSnapshot } from "./scores.ts";

/** One model the operator can register. */
export interface Candidate {
  readonly id: string;
  /** AAII score when the table covers it — what the chain will rank it by. */
  readonly score?: number;
  /**
   * The router this row is registered on, as the picker names it: the chosen
   * upstream for a listing, or the upstream(s) this config already serves the id
   * on when the listing could not be read. Two rows whose ids differ only by a
   * path prefix (`z-ai/glm-5.3-flash` and `glm-5.3-flash`) produce the same group
   * name, so the router is what tells them apart before the name is claimed.
   */
  readonly router?: string;
}

/** Where the list came from. The title says which, because one of them is a guess. */
export type PickSource =
  | { readonly kind: "listing" }
  | { readonly kind: "config"; readonly reason: string };

export interface CandidateSet {
  readonly candidates: readonly Candidate[];
  /** Listed ids this host already serves, left out of the picker. */
  readonly alreadyServed: number;
}

export const MARK_ON = "☑";
export const MARK_OFF = "☐";

/** How the picker names an upstream: its slug when the config attests one, else its hostname. */
export function routerLabel(option: UpstreamOption): string {
  return option.slug ?? option.host;
}

/** The same name for every upstream in the config, keyed by hostname. */
export function routerLabels(text: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const option of upstreamOptions(text)) labels.set(option.host, routerLabel(option));
  return labels;
}

/**
 * Which upstreams already serve each model id, in the picker's names. The key is
 * the comparison key the rest of the package uses, so a host that spells an id
 * with dots and one that spells it with dashes are one entry.
 */
function sourcesById(text: string, host: string): Map<string, string> {
  const labels = routerLabels(text);
  const found = new Map<string, Set<string>>();

  for (const detail of readModelEntryDetails(text.split(/\r?\n/))) {
    if (detail.host === host || detail.upstream === "") continue;
    const key = freeUpstreamKey("", detail.upstream);
    const set = found.get(key) ?? new Set<string>();
    set.add(labels.get(detail.host) ?? detail.host);
    found.set(key, set);
  }

  const sources = new Map<string, string>();
  for (const [key, set] of found) {
    sources.set(key, [...set].sort((a, b) => a.localeCompare(b)).join("·"));
  }
  return sources;
}

/**
 * Upstream ids the host already has a group for. The key is the one the free
 * model reconciliation uses, so `deepseek-v4.1-flash` and `deepseek-v4-1-flash`
 * count as the same model on the same host — the reading the rest of the package
 * already applies.
 */
export function servedUpstreams(text: string, host: string): Set<string> {
  const served = new Set<string>();
  for (const detail of readModelEntryDetails(text.split(/\r?\n/))) {
    if (detail.host === host) served.add(freeUpstreamKey(host, detail.upstream));
  }
  return served;
}

/** Model ids this config uses on a host other than this one. */
export function knownUpstreams(text: string, host: string): string[] {
  const ids = new Set<string>();
  for (const detail of readModelEntryDetails(text.split(/\r?\n/))) {
    if (detail.host !== host && detail.upstream !== "") ids.add(detail.upstream);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Scored first, highest score first; without a score, alphabetically. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const scoreA = a.score ?? Number.NEGATIVE_INFINITY;
  const scoreB = b.score ?? Number.NEGATIVE_INFINITY;
  if (scoreA !== scoreB) return scoreB - scoreA;
  return a.id.localeCompare(b.id);
}

/**
 * The candidates for one host: the ids offered, minus what it already serves,
 * each with the score the chain would rank it by and the router the row belongs
 * to.
 *
 * `router` names the upstream the list came from — the one the operator chose.
 * Left out, the id's routers are read from the config instead, which is the
 * fallback list's case: those ids have no listing behind them, so the hosts that
 * already serve one are the only thing that says where it comes from.
 */
export function candidatesFrom(
  ids: readonly string[],
  text: string,
  host: string,
  scores: ScoreSnapshot,
  router?: string,
): CandidateSet {
  const served = servedUpstreams(text, host);
  const sources = router === undefined ? sourcesById(text, host) : undefined;
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  let alreadyServed = 0;

  for (const id of ids) {
    if (id.trim() === "" || seen.has(id)) continue;
    seen.add(id);
    if (served.has(freeUpstreamKey(host, id))) {
      alreadyServed += 1;
      continue;
    }
    candidates.push({
      id,
      score: scoreFor(scores, id),
      router: router ?? sources?.get(freeUpstreamKey("", id)) ?? host,
    });
  }

  candidates.sort(compareCandidates);
  return { candidates, alreadyServed };
}

/**
 * A row: the mark, the router the model would be registered on, and the id. The
 * router leads because the group name it produces leads with the slug too.
 */
export function candidateLabel(candidate: Candidate, marked: boolean): string {
  const router = candidate.router === undefined || candidate.router === "" ? "" : `${candidate.router}/`;
  return `${marked ? MARK_ON : MARK_OFF} ${router}${candidate.id}`;
}

export function candidateDescription(candidate: Candidate): string {
  return candidate.score === undefined ? "no AAII score — it would sort last" : `AAII ${candidate.score}`;
}

/** Space on one row. A set is returned rather than mutated, so the caller owns it. */
export function toggleMarked(marked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(marked);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * What Enter means: the marked models, in the order the list shows them, or the
 * one under the cursor when nothing is marked. The order is the list's, not the
 * order the operator happened to press space in, so the numbers a batch claims
 * follow the picker's own reading.
 */
export function resolveSelection(
  marked: ReadonlySet<string>,
  highlighted: string | undefined,
  order: readonly string[],
): string[] {
  if (marked.size === 0) return highlighted === undefined ? [] : [highlighted];
  return order.filter((id) => marked.has(id));
}

/**
 * One name per id, numbered after the highest in use. A number is skipped when
 * the name it would produce is already taken, so a batch cannot collide with a
 * group that was written by hand outside this numbering.
 */
export function claimNames(
  count: number,
  taken: readonly string[],
  slug: string,
  ids: readonly string[],
): string[] {
  const used = new Set(taken);
  let code = nextCodeNumber(taken);
  const names: string[] = [];

  for (let index = 0; index < count; index++) {
    const id = ids[index];
    if (id === undefined) break;
    let name = groupName(code, slug, id);
    while (used.has(name)) {
      code += 1;
      name = groupName(code, slug, id);
    }
    names.push(name);
    used.add(name);
    code += 1;
  }
  return names;
}

/** The picker's title: which list this is, and how much of it is left to add. */
export function pickerTitle(host: string, source: PickSource, shown: number, alreadyServed: number): string {
  const tail = alreadyServed === 0 ? "" : ` (${alreadyServed} already in model_list)`;
  return source.kind === "listing"
    ? `add — ${host} lists ${shown} to add${tail}`
    : `add — ${host} could not be listed (${source.reason}); showing the models this config uses elsewhere${tail}`;
}

/** The line under the list: what the keys do, and where a hand-typed id goes. */
export function pickerHint(): string {
  return "space mark · enter add · esc cancel · type to filter";
}

/** Where the list came from, as the confirmation dialog states it. */
export function sourceLine(host: string, source: PickSource): string {
  return source.kind === "listing"
    ? `list: ${host}'s own /models listing, read just now`
    : `list: the models this config already uses elsewhere — ${host} could not be listed (${source.reason})`;
}

/**
 * The whole of what a batch will write, for the confirmation dialog: one block
 * per model, in the order the picker showed them, plus where the list came from.
 * Long batches are cut off rather than scrolled — the dialog is agreed to, not
 * read line by line, and the report after the write names every group.
 */
export function describeBatch(
  picks: readonly { readonly candidate: Candidate; readonly name: string }[],
  option: UpstreamOption,
  source: PickSource,
  limit = 6,
): string {
  const blocks = picks.slice(0, limit).map((pick) =>
    describeAddition(
      { name: pick.name, modelId: pick.candidate.id, baseUrl: option.baseUrl, apiKey: option.apiKey },
      option,
      pick.candidate.score,
    ),
  );
  if (picks.length > limit) blocks.push(`… and ${picks.length - limit} more`);
  return [sourceLine(option.host, source), ...blocks].join("\n\n");
}
