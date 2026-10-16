/**
 * Composition of the fallback chains in a LiteLLM router config.
 *
 * The module is pure apart from the score snapshot it is handed: it takes the
 * config text plus a score table and returns rewritten text. All file I/O lives
 * in the extension entry point, so this stays reviewable and testable without a
 * running proxy.
 *
 * Chain order
 * -----------
 * Highest Artificial Analysis Intelligence Index first. Two entries that serve
 * the same model share a score, so the tie is broken by provider tier: the
 * allowance that replenishes soonest is spent first (free, then daily, weekly,
 * monthly, and credit last). See `providers.ts` and `scores.ts`.
 *
 * A model with no score has no place in a score-ordered chain, so it sorts
 * after every scored model and is reported by the caller rather than being
 * ranked silently.
 *
 * Zero-priced models
 * ------------------
 * A third input, optional, is the free-model snapshot. When it names a model at
 * zero input *and* zero output cost, that model becomes eligible for the chain
 * without anyone editing the config by hand:
 *
 *   - **It is added to `model_list`.** The upstream's listing is the discovery
 *     source, so the group is generated rather than typed. Generated groups use
 *     the `code-free-<upstream>-<model>` name, which is also the prune marker:
 *     they are removed and re-added on every compose, so a promo that ends takes
 *     its group with it.
 *   - **Its tier is `free`, whatever its host normally charges.** The host table
 *     in `providers.ts` classifies by host, which cannot express "free today".
 *     A zero price can, and it beats the host's standing tier — that is the same
 *     tie-break rule, with a better-informed tier in front of it.
 *
 * What it manages
 * ---------------
 * Inside `router_settings`, two blocks are regenerated from `model_list`:
 *
 *   model_group_alias:  <alias>: <head of its chain>
 *   fallbacks:          for each alias, the ordered remainder of its chain;
 *                       for each member, everything that comes after it.
 *
 * Plus, at the tail of `model_list`, the generated `code-free-*` groups. Hand-written
 * entries are never touched: they are not added to, reordered, or removed. Every
 * other byte of the config is preserved, and the rewrite is idempotent.
 */

import {
  coveredHosts,
  excludedByReason,
  freeModelGroupName,
  freeUpstreamKey,
  freeUpstreamKeys,
  isManagedModelName,
  targetForHost,
} from "./free-models.ts";
import type { FreeSnapshot } from "./free-models.ts";
import { TIER_FREE, tierForHost, unclassifiedHosts } from "./providers.ts";
import { scoreFor } from "./scores.ts";
import type { ScoreSnapshot } from "./scores.ts";

export interface ModelEntry {
  /** `model_name` in `model_list`, the id the router exposes. */
  readonly name: string;
  /** Last path segment of `litellm_params.model`, the upstream model. */
  readonly upstream: string;
  /** Hostname of `litellm_params.api_base`. */
  readonly host: string;
}

export interface ChainSpec {
  /** Aliases that address the chain head. The first alias also names the chain. */
  readonly aliases: readonly string[];
  /**
   * Whether an alias fallback list repeats the chain head. The shipped config
   * does this for the DashScope aliases but not for the coding alias, so the
   * flag records the existing shape rather than imposing one.
   */
  readonly aliasIncludesHead: boolean;
  readonly matches: (name: string) => boolean;
}

export interface ChainSummary {
  readonly alias: string;
  readonly head: string;
  readonly memberCount: number;
  /** Members with no score, in chain order. Empty means the chain is fully ranked. */
  readonly unscored: readonly string[];
}

/** What the free-model snapshot did to `model_list` on this compose. */
export interface FreeInclusionReport {
  /** Generated groups now present in `model_list`. */
  readonly included: readonly { readonly name: string; readonly id: string; readonly host: string }[];
  /** Generated groups removed because the listing no longer shows them at zero cost. */
  readonly pruned: readonly string[];
  /** Free models a hand-written group already serves, so no group was generated. */
  readonly alreadyPresent: readonly string[];
  /** Hosts the snapshot speaks for. Groups on any other host are left alone. */
  readonly covered: readonly string[];
  /** Ids the listing publishes with no usable price. Never treated as free. */
  readonly unpriced: readonly string[];
  /** No snapshot was readable, so `model_list` was left exactly as found. */
  readonly snapshotMissing: boolean;
}

export interface ComposeOutcomeOk {
  readonly ok: true;
  readonly text: string;
  readonly changed: boolean;
  readonly chains: readonly ChainSummary[];
  /** Order changes relative to the incoming text, for a dry-run report. */
  readonly reordered: readonly { readonly alias: string; readonly before: readonly string[]; readonly after: readonly string[] }[];
  readonly unclassifiedHosts: readonly string[];
  readonly free: FreeInclusionReport;
}

export type ComposeOutcome = ComposeOutcomeOk | { readonly ok: false; readonly reason: string };

export const CODING_CHAIN: ChainSpec = {
  aliases: ["coding-fallback"],
  aliasIncludesHead: false,
  // `code-<n>-` is hand-assigned; `code-free-<upstream>-` is generated from the
  // free-model snapshot. Both belong to the same chain.
  matches: (name) => /^code-(?:\d+-|free-)/.test(name),
};

export const DASH_SCOPE_CHAIN: ChainSpec = {
  aliases: ["dashscope-coding-fallback", "qwen-quota-fallback"],
  aliasIncludesHead: true,
  matches: (name) => /^ds-/.test(name),
};

export const CHAINS: readonly ChainSpec[] = [CODING_CHAIN, DASH_SCOPE_CHAIN];

function hostOf(base: string): string {
  try {
    return new URL(base).hostname;
  } catch {
    return "";
  }
}

interface BlockRange {
  readonly start: number;
  readonly end: number;
}

function findBlock(lines: readonly string[], key: string): BlockRange | undefined {
  const head = new RegExp(`^ {2}${key}:\\s*$`);
  const start = lines.findIndex((line) => head.test(line));
  if (start < 0) return undefined;

  const nextSibling = /^ {2}[A-Za-z_][A-Za-z0-9_]*:/;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextSibling.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

/**
 * Read `model_list` entries in file order. Stops at `router_settings` so a
 * later key can never be mistaken for part of the last entry.
 */
export function readModelEntries(lines: readonly string[]): ModelEntry[] {
  const entries: ModelEntry[] = [];
  let current: { name: string; upstream: string; base: string } | undefined;

  const flush = (): void => {
    if (!current) return;
    const upstream = current.upstream.split("/").pop() ?? "";
    entries.push({
      name: current.name,
      upstream: upstream === "" ? current.name : upstream,
      host: hostOf(current.base),
    });
    current = undefined;
  };

  for (const line of lines) {
    if (/^router_settings:\s*$/.test(line)) {
      flush();
      break;
    }

    const nameMatch = /^\s*-\s*model_name:\s*(\S+)/.exec(line);
    if (nameMatch) {
      flush();
      current = { name: nameMatch[1], upstream: "", base: "" };
      continue;
    }
    if (!current) continue;

    const modelMatch = /^\s{4}model:\s*(\S+)/.exec(line);
    if (modelMatch) {
      current.upstream = modelMatch[1];
      continue;
    }
    const baseMatch = /^\s{4}api_base:\s*(\S+)/.exec(line);
    if (baseMatch) current.base = baseMatch[1];
  }

  flush();
  return entries;
}

/**
 * The tier a single entry competes in. A model the snapshot reports at zero cost
 * is `free` on the day it is free, even though its host's standing tier is not:
 * the tie-break is still "spend the allowance that replenishes soonest first",
 * just with a price that is known to be nothing at all.
 */
export function tierForEntry(entry: ModelEntry, freeKeys: ReadonlySet<string>): number {
  if (freeKeys.has(freeUpstreamKey(entry.host, entry.upstream))) return TIER_FREE;
  return tierForHost(entry.host);
}

/** Score first, highest wins; unscored last; then the soonest-resetting tier. */
export function compareChainOrder(
  a: ModelEntry,
  b: ModelEntry,
  scores: ScoreSnapshot,
  freeKeys: ReadonlySet<string> = new Set(),
): number {
  const scoreA = scoreFor(scores, a.upstream);
  const scoreB = scoreFor(scores, b.upstream);
  const rankA = scoreA === undefined ? Number.NEGATIVE_INFINITY : scoreA;
  const rankB = scoreB === undefined ? Number.NEGATIVE_INFINITY : scoreB;
  if (rankA !== rankB) return rankB - rankA;

  const tierA = tierForEntry(a, freeKeys);
  const tierB = tierForEntry(b, freeKeys);
  if (tierA !== tierB) return tierA - tierB;

  return a.name.localeCompare(b.name);
}

export function orderChain(
  entries: readonly ModelEntry[],
  spec: ChainSpec,
  scores: ScoreSnapshot,
  freeKeys: ReadonlySet<string> = new Set(),
): ModelEntry[] {
  return entries
    .filter((entry) => spec.matches(entry.name))
    .sort((a, b) => compareChainOrder(a, b, scores, freeKeys));
}

/** Member names in the order an existing `fallbacks` block declares them. */
function readExistingOrder(lines: readonly string[], spec: ChainSpec): string[] {
  const block = findBlock(lines, "fallbacks");
  if (!block) return [];

  const head = `  - ${spec.aliases[0]}:`;
  const start = lines.findIndex((line, index) => index >= block.start && line === head);
  if (start < 0) return [];

  const order: string[] = [];
  for (let i = start + 1; i < block.end; i++) {
    const target = /^ {4}- (\S+)/.exec(lines[i]);
    if (target) {
      order.push(target[1]);
      continue;
    }
    break;
  }
  return order;
}

/** The head the existing `model_group_alias` block declares for a chain, if any. */
function readExistingHead(lines: readonly string[], spec: ChainSpec): string | undefined {
  const block = findBlock(lines, "model_group_alias");
  if (!block) return undefined;

  const head = new RegExp(`^ {4}${spec.aliases[0]}:\\s*(\\S+)\\s*$`);
  for (let i = block.start + 1; i < block.end; i++) {
    const match = head.exec(lines[i]);
    if (match) return match[1];
  }
  return undefined;
}

function renderAliasBlock(layouts: readonly { spec: ChainSpec; members: readonly ModelEntry[] }[]): string[] {
  const lines = ["  model_group_alias:"];
  for (const { spec, members } of layouts) {
    if (members.length === 0) continue;
    for (const alias of spec.aliases) {
      lines.push(`    ${alias}: ${members[0].name}`);
    }
  }
  return lines;
}

function renderFallbackBlock(layouts: readonly { spec: ChainSpec; members: readonly ModelEntry[] }[]): string[] {
  const lines = ["  fallbacks:"];
  for (const { spec, members } of layouts) {
    if (members.length < 2) continue;

    const aliasStart = spec.aliasIncludesHead ? 0 : 1;
    for (const alias of spec.aliases) {
      lines.push(`  - ${alias}:`);
      for (const target of members.slice(aliasStart)) {
        lines.push(`    - ${target.name}`);
      }
    }

    for (let i = 0; i < members.length - 1; i++) {
      lines.push(`  - ${members[i].name}:`);
      for (const target of members.slice(i + 1)) {
        lines.push(`    - ${target.name}`);
      }
    }
  }
  return lines;
}

interface ModelEntrySpan {
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  readonly name: string;
  readonly host: string;
  readonly upstream: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
}

/**
 * Locate `model_list` and the line span of each entry in it, so a generated group
 * can be removed without disturbing a hand-written one. Stops at the next
 * top-level key, which is `router_settings` in every config this manages.
 */
function scanModelList(
  lines: readonly string[],
): { readonly end: number; readonly spans: readonly ModelEntrySpan[] } | undefined {
  const start = lines.findIndex((line) => /^model_list:\s*$/.test(line));
  if (start < 0) return undefined;

  const next = lines.findIndex(
    (line, index) => index > start && /^[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(line),
  );
  const end = next < 0 ? lines.length : next;

  const spans: ModelEntrySpan[] = [];
  let open: { start: number; name: string; base: string; model: string; key?: string } | undefined;

  const flush = (stop: number): void => {
    if (!open) return;
    spans.push({
      start: open.start,
      end: stop,
      name: open.name,
      host: hostOf(open.base),
      upstream: open.model.split("/").pop() ?? open.model,
      baseUrl: open.base,
      apiKey: open.key,
    });
    open = undefined;
  };

  for (let i = start + 1; i < end; i++) {
    const name = /^-\s*model_name:\s*(\S+)/.exec(lines[i]);
    if (name) {
      flush(i);
      open = { start: i, name: name[1], base: "", model: "" };
      continue;
    }
    if (!open) continue;

    const model = /^\s{4}model:\s*(\S+)/.exec(lines[i]);
    if (model) {
      open.model = model[1];
      continue;
    }
    const base = /^\s{4}api_base:\s*(\S+)/.exec(lines[i]);
    if (base) {
      open.base = base[1];
      continue;
    }
    const key = /^\s{4}api_key:\s*(\S.*)$/.exec(lines[i]);
    if (key) open.key = key[1].trim();
  }

  flush(end);
  return { end, spans };
}

/** One `model_list` entry with the fields a re-render needs, in file order. */
export interface ModelEntryDetail {
  readonly name: string;
  readonly upstream: string;
  readonly host: string;
  readonly baseUrl: string;
  /** The `api_key` line as written, when the entry carries one. */
  readonly apiKey?: string;
}

/**
 * What `model_list` says about each entry, including the two fields the composer
 * itself never reads. Registering a group needs the base URL and the key line to
 * copy from an upstream the config already has, and reading them from the same
 * scan the composer prunes with keeps one parser in charge of what an entry is.
 */
export function readModelEntryDetails(lines: readonly string[]): ModelEntryDetail[] {
  return (scanModelList(lines)?.spans ?? []).map((span) => ({
    name: span.name,
    upstream: span.upstream,
    host: span.host,
    baseUrl: span.baseUrl,
    apiKey: span.apiKey,
  }));
}

/**
 * Add a group for every model the snapshot reports at zero cost, and remove the
 * groups whose promo has ended. Hand-written entries are never added to, moved, or
 * removed: a model that already has one is reported as covered instead.
 *
 * Pruning is limited to hosts the snapshot actually speaks for. A snapshot that is
 * missing, or that failed to read a host, must not look like "nothing is free any
 * more", because that would tear down a group that is still free.
 */
export function reconcileFreeEntries(
  lines: readonly string[],
  free: FreeSnapshot | undefined,
): { readonly lines: string[]; readonly report: FreeInclusionReport } {
  const scan = scanModelList(lines);
  const empty: FreeInclusionReport = {
    included: [],
    pruned: [],
    alreadyPresent: [],
    covered: [],
    unpriced: [],
    snapshotMissing: free === undefined,
  };
  if (!free || !scan) return { lines: [...lines], report: empty };

  const covered = coveredHosts(free);
  const prunable = scan.spans.filter(
    (span) => isManagedModelName(span.name) && covered.has(span.host.toLowerCase()),
  );
  const handWritten = new Set(
    scan.spans
      .filter((span) => !isManagedModelName(span.name))
      .map((span) => freeUpstreamKey(span.host, span.upstream)),
  );

  const included: { name: string; id: string; host: string }[] = [];
  const alreadyPresent: string[] = [];
  const rendered: string[] = [];

  for (const provider of free.providers) {
    const target = targetForHost(provider.host);
    if (!target) continue;
    for (const model of provider.free) {
      if (handWritten.has(freeUpstreamKey(provider.host, model.id))) {
        alreadyPresent.push(model.id);
        continue;
      }
      const name = freeModelGroupName(target.slug, model.id);
      included.push({ name, id: model.id, host: provider.host });
      rendered.push(
        `- model_name: ${name}`,
        "  litellm_params:",
        `    model: openai/${model.id}`,
        `    api_base: ${target.baseUrl}`,
        `    api_key: os.environ/${target.apiKeyEnv}`,
      );
    }
  }

  const next = [...lines];
  let removed = 0;
  for (const span of [...prunable].sort((a, b) => b.start - a.start)) {
    next.splice(span.start, span.end - span.start);
    removed += span.end - span.start;
  }
  if (rendered.length > 0) next.splice(scan.end - removed, 0, ...rendered);

  // A group that is removed and immediately regenerated was not pruned, it was
  // rewritten. Only the ones that do not come back are worth reporting.
  const includedNames = new Set(included.map((entry) => entry.name));

  return {
    lines: next,
    report: {
      included,
      pruned: prunable.map((span) => span.name).filter((name) => !includedNames.has(name)),
      alreadyPresent,
      covered: [...covered].sort(),
      unpriced: excludedByReason(free, "no-price"),
      snapshotMissing: false,
    },
  };
}

/**
 * Regenerate the fallback chains. Returns `ok: false` when the expected
 * structure is missing, so a caller never writes a config it did not understand.
 */
export function composeCodingFallback(
  configText: string,
  scores: ScoreSnapshot,
  free?: FreeSnapshot,
): ComposeOutcome {
  const eol = configText.includes("\r\n") ? "\r\n" : "\n";

  const reconciled = reconcileFreeEntries(configText.split(/\r?\n/), free);
  const lines = reconciled.lines;

  // Computed after reconciliation: generated groups shift every later line.
  const aliasBlock = findBlock(lines, "model_group_alias");
  if (!aliasBlock) return { ok: false, reason: 'no "model_group_alias" block under router_settings' };

  const fallbackBlock = findBlock(lines, "fallbacks");
  if (!fallbackBlock) return { ok: false, reason: 'no "fallbacks" block under router_settings' };

  const freeKeys = freeUpstreamKeys(free);
  const entries = readModelEntries(lines);

  const layouts: { spec: ChainSpec; members: ModelEntry[] }[] = [];
  const summary: ChainSummary[] = [];
  const reordered: { alias: string; before: readonly string[]; after: readonly string[] }[] = [];

  for (const spec of CHAINS) {
    const members = orderChain(entries, spec, scores, freeKeys);
    if (members.length === 0) {
      return { ok: false, reason: `no model_list entries match chain "${spec.aliases[0]}"` };
    }
    layouts.push({ spec, members });

    const after = members.map((member) => member.name);
    // The alias list omits the head when the chain does not repeat it, so the
    // order on disk is rebuilt as head plus list before it is compared: putting
    // a five-member chain up against its own four-member tail would report an
    // order change on every pass, including on a config that is already correct.
    const existingHead = readExistingHead(lines, spec);
    const existingTail = readExistingOrder(lines, spec);
    const before =
      existingHead === undefined || spec.aliasIncludesHead
        ? existingTail
        : [existingHead, ...existingTail].filter((name) => name !== "");
    const unscored = members
      .filter((member) => scoreFor(scores, member.upstream) === undefined)
      .map((member) => member.name);

    summary.push({ alias: spec.aliases[0], head: after[0], memberCount: after.length, unscored });
    if (before.length > 0 && before.join("\n") !== after.join("\n")) {
      reordered.push({ alias: spec.aliases[0], before, after });
    }
  }

  const aliasLines = renderAliasBlock(layouts);
  const fallbackLines = renderFallbackBlock(layouts);

  // Replace from the bottom up so earlier line indices stay valid.
  const ranges = [
    { range: fallbackBlock, replacement: fallbackLines },
    { range: aliasBlock, replacement: aliasLines },
  ].sort((a, b) => b.range.start - a.range.start);

  const next = [...lines];
  for (const { range, replacement } of ranges) {
    next.splice(range.start, range.end - range.start, ...replacement);
  }

  const text = next.join(eol);
  return {
    ok: true,
    text,
    changed: text !== configText,
    chains: summary,
    reordered,
    unclassifiedHosts: unclassifiedHosts(entries.map((entry) => entry.host)),
    free: reconciled.report,
  };
}
