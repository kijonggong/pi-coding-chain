/**
 * Registering a model into the coding chain from the extension's own UI.
 *
 * The chain is composed from `model_list`, so "registering a model" is one
 * hand-written entry:
 *
 *   - model_name: code-<n>-<slug>-<model>
 *     litellm_params:
 *       model: openai/<model>
 *       api_base: <the upstream already in the config>
 *       api_key: os.environ/<VAR>
 *
 * The composer then ranks it by AAII score like every other member. Nothing here
 * invents an upstream: the base URL and the key line are copied from a group the
 * config already carries, so a mistyped host cannot send a request somewhere the
 * operator never configured. The one thing the operator chooses per host that the
 * config does not hold is the short slug in the name, and even that is read from
 * the names already used for that host rather than invented — a host whose names
 * do not attest one asks for it.
 *
 * Pure: text in, text out. File I/O stays in the extension entry point, so every
 * rule below is a function of its inputs and testable without a Pi session or a
 * running proxy.
 *
 * The number in `code-<n>-` is hand-assigned and has no meaning to the composer —
 * ordering is by score — so a new entry takes the next free number and can be
 * renamed in the scriptable form. It is there to make a group identifiable in a
 * LiteLLM log, not to encode a rank, because a rank changes every time a score
 * changes and a group name cannot.
 */

import { CODING_CHAIN, readModelEntryDetails } from "./chain.ts";
import { MANAGED_PREFIX, isManagedModelName } from "./free-models.ts";
import { TIER_UNKNOWN, tierForHost, tierLabelForHost } from "./providers.ts";

/** An upstream the config already has a group for, as the window offers it. */
export interface UpstreamOption {
  /** Hostname from `litellm_params.api_base`. Unique per option. */
  readonly host: string;
  readonly baseUrl: string;
  /** The `api_key` line as written, if the existing groups carry one. */
  readonly apiKey?: string;
  /**
   * The short name in the group names already used for this host, e.g. `nvidia`
   * in `code-2-nvidia-deepseek-v4.1-flash`. `undefined` when no existing name
   * attests one: the window then asks instead of guessing.
   */
  readonly slug?: string;
  /** Standing quota tier of the host, as `providers.ts` classifies it. */
  readonly tier: number;
  readonly tierLabel: string;
  /** Group names already on this host, for the window's label. */
  readonly groups: readonly string[];
}

/** The entry to add. Everything the rendered YAML needs, and nothing else. */
export interface NewModel {
  /** `model_name`, e.g. `code-8-nvidia-deepseek-v4.1-flash`. */
  readonly name: string;
  /** Upstream id, written as `openai/<modelId>`. */
  readonly modelId: string;
  readonly baseUrl: string;
  /** Written as `api_key:` only when the host's existing groups have one. */
  readonly apiKey?: string;
}

/** A subcommand, as the command's argument completion offers it. */
export interface Subcommand {
  readonly value: string;
  readonly description: string;
}

export const SUBCOMMANDS: readonly Subcommand[] = [
  { value: "check", description: "Report drift, unranked models and unclassified hosts" },
  { value: "sync", description: "Refresh the free-model listing, then rewrite the generated blocks" },
  { value: "add", description: "Register a model on an upstream already in model_list: add <model> [host-slug] [name]" },
];

/** `code-<n>-<slug>-` is the pre-change shape; `code-free-<slug>-` is generated. */
const HAND_WRITTEN = /^code-(\d+)-(.+)$/;
const GENERATED = /^code-free-(.+)$/;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)*$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const GROUP_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * The slug an existing group name attests for its host, or `undefined` when the
 * name carries none. Two shapes count: the upstream id with a short prefix in
 * front of it, and a name that is the upstream id alone (which attests nothing —
 * `code-7-qwen3.8-flash-next-iq3s` names no upstream).
 */
function attestedSlug(name: string, upstream: string): string | undefined {
  const rest = GENERATED.exec(name)?.[1] ?? HAND_WRITTEN.exec(name)?.[2];
  if (rest === undefined || upstream === "") return undefined;

  const suffix = `-${upstream}`;
  if (rest === upstream) return undefined;
  if (rest.endsWith(suffix)) {
    const slug = rest.slice(0, -suffix.length);
    return slug === "" ? undefined : slug;
  }
  // The name does not end with the upstream it serves, so the first token is all
  // that can be read as a slug.
  return rest.split("-")[0] || undefined;
}

/**
 * Every upstream already wired into `model_list`, in file order, one per host.
 *
 * A group whose entry is missing `api_base` is skipped: an option that cannot
 * render a complete entry is not an option, and offering it would put a
 * half-configured group in the file.
 */
export function upstreamOptions(text: string): UpstreamOption[] {
  const details = readModelEntryDetails(text.split(/\r?\n/));
  const byHost = new Map<string, { baseUrl: string; apiKey?: string; slug?: string; groups: string[] }>();

  for (const detail of details) {
    if (detail.baseUrl === "" || detail.host === "") continue;
    const existing = byHost.get(detail.host);
    const attests = attestedSlug(detail.name, detail.upstream);
    if (existing) {
      existing.groups.push(detail.name);
      existing.slug ??= attests;
      existing.apiKey ??= detail.apiKey;
      continue;
    }
    byHost.set(detail.host, {
      baseUrl: detail.baseUrl,
      apiKey: detail.apiKey,
      slug: attests,
      groups: [detail.name],
    });
  }

  return [...byHost.entries()].map(([host, entry]) => ({
    host,
    baseUrl: entry.baseUrl,
    apiKey: entry.apiKey,
    slug: entry.slug,
    tier: tierForHost(host),
    tierLabel: tierLabelForHost(host),
    groups: entry.groups,
  }));
}

/** The option a host slug names, case-insensitively. */
export function optionForSlug(
  options: readonly UpstreamOption[],
  slug: string,
): UpstreamOption | undefined {
  const wanted = slug.trim().toLowerCase();
  if (wanted === "") return undefined;
  return options.find((option) => option.slug?.toLowerCase() === wanted);
}

/** Group names already in `model_list`, in file order. */
export function existingGroupNames(text: string): string[] {
  return readModelEntryDetails(text.split(/\r?\n/)).map((detail) => detail.name);
}

/**
 * The next free number for `code-<n>-`. Highest wins rather than lowest: the
 * names read as "added in this order", and reusing a gap left by a deleted group
 * would put the newest entry in the middle of that reading.
 */
export function nextCodeNumber(names: readonly string[]): number {
  let highest = 0;
  for (const name of names) {
    const match = HAND_WRITTEN.exec(name);
    if (!match) continue;
    highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

/**
 * The group name for a new entry. The model id keeps its dots (the convention in
 * the live config) and loses any path prefix, because a slash inside the name
 * would read as `provider/upstream` to LiteLLM.
 */
export function groupName(code: number, slug: string, modelId: string): string {
  const model = modelId.split("/").pop() ?? modelId;
  return `code-${code}-${slug}-${model}`;
}

/** Why a model id cannot be used, or `undefined` when it can. */
export function validateModelId(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return "a model id is required";
  if (!MODEL_ID.test(trimmed)) {
    return `not a model id: ${JSON.stringify(trimmed)} (letters, digits, dot, dash and slash only)`;
  }
  return undefined;
}

/**
 * Why a group name cannot be registered, or `undefined` when it can.
 *
 * The name has to be one the coding chain matches: a group the composer does not
 * match would be written into `model_list` and then ignored by every compose,
 * which is the one outcome a wizard must not be able to produce. The generated
 * prefix is refused for the opposite reason — reconciliation deletes those groups
 * on the next pass, so a hand-registered one would vanish without explanation.
 */
export function validateGroupName(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return "a group name is required";
  if (!GROUP_NAME.test(trimmed)) {
    return `not a group name: ${JSON.stringify(trimmed)} (letters, digits, dot, dash and underscore only)`;
  }
  if (isManagedModelName(trimmed)) {
    return `${trimmed} uses the generated prefix ${MANAGED_PREFIX}, which the free-model snapshot owns`;
  }
  if (!CODING_CHAIN.matches(trimmed)) {
    return `not a coding-chain group name: ${JSON.stringify(trimmed)} (code-<n>-<slug>-<model>)`;
  }
  return undefined;
}

/** Why a slug cannot be used, or `undefined` when it can. */
export function validateSlug(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return "a slug is required";
  if (!SLUG.test(trimmed)) {
    return `not a slug: ${JSON.stringify(trimmed)} (lowercase letters, digits and dashes)`;
  }
  return undefined;
}

/**
 * Put the entry in `model_list`.
 *
 * A hand-written entry belongs with the other hand-written ones, so it goes in
 * front of the generated `code-free-*` groups when there are any, and at the end
 * of `model_list` otherwise. Both placements end up identical after a compose —
 * reconciliation removes and re-appends every generated group at the tail — so
 * this only decides how the file reads before the next sync.
 */
export function insertModelEntry(
  text: string,
  model: NewModel,
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);

  const start = lines.findIndex((line) => /^model_list:\s*$/.test(line));
  if (start < 0) return { ok: false, reason: 'there is no "model_list" block to add the group to' };
  if (existingGroupNames(text).includes(model.name)) {
    return { ok: false, reason: `${model.name} is already in model_list` };
  }

  const nextKey = lines.findIndex(
    (line, index) => index > start && /^[A-Za-z_][A-Za-z0-9_]*:\s*$/.test(line),
  );
  const end = nextKey < 0 ? lines.length : nextKey;

  const generated = lines.findIndex(
    (line, index) => index > start && index < end && /^-\s*model_name:\s*code-free-/.test(line),
  );
  // Without a following top-level key the file's own trailing newline splits into
  // an empty last element; inserting before it keeps the file ending as it did.
  const at =
    generated >= 0
      ? generated
      : nextKey < 0 && end - 1 > start && lines[end - 1].trim() === ""
        ? end - 1
        : end;

  const rendered = [
    `- model_name: ${model.name}`,
    "  litellm_params:",
    `    model: openai/${model.modelId}`,
    `    api_base: ${model.baseUrl}`,
    ...(model.apiKey === undefined ? [] : [`    api_key: ${model.apiKey}`]),
  ];

  lines.splice(at, 0, ...rendered);
  return { ok: true, text: lines.join(eol) };
}

/** How this entry will be ranked, in the words the confirmation dialog uses. */
export function describeRanking(option: UpstreamOption, score: number | undefined): string {
  const ranking =
    score === undefined
      ? "no AAII score — it sorts after every scored model in the chain"
      : `AAII ${score} — the chain is ordered by this, highest first`;
  const tier =
    option.tier >= TIER_UNKNOWN
      ? `${option.tierLabel} — not in the tier table, so it sorts after every classified host`
      : `${option.tierLabel} — the tie-break when another supplier serves the same model`;
  return `ranking: ${ranking}\ntier:     ${tier}`;
}

/**
 * The whole of what is about to happen, for the confirmation dialog. Written as
 * the lines the operator is agreeing to, not as a summary of them.
 */
export function describeAddition(
  model: NewModel,
  option: UpstreamOption,
  score: number | undefined,
): string {
  return [
    `- model_name: ${model.name}`,
    "  litellm_params:",
    `    model: openai/${model.modelId}`,
    `    api_base: ${model.baseUrl}`,
    ...(model.apiKey === undefined ? [] : [`    api_key: ${model.apiKey}`]),
    "",
    describeRanking(option, score),
  ].join("\n");
}

/**
 * Argument completions for `/coding-fallback`: the subcommands, then the host
 * slugs once `add` has an argument. The model id is the operator's to type — the
 * score snapshot and the config do not agree on a list of what a host serves, so
 * anything offered here would be a guess.
 */
export function completionsFor(prefix: string, slugs: readonly string[] = []): Subcommand[] {
  const trimmed = prefix.replace(/^\s+/, "");
  const words = trimmed.split(/\s+/);

  // Exactly three words: `add <model>` and the slug being typed. A fourth means
  // the slug is complete and the group name is next, which is the operator's —
  // a number and a slug are not something a completion list should offer twice.
  if (words[0] === "add" && words.length === 3) {
    const typed = words[2] ?? "";
    return slugs
      .filter((slug) => slug.startsWith(typed))
      .map((slug) => ({ value: `add ${words[1]} ${slug} `, description: "Upstream already in model_list" }));
  }

  return SUBCOMMANDS.filter((subcommand) => subcommand.value.startsWith(trimmed));
}
