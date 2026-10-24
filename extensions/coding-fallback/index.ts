/**
 * Pi extension: keep the fallback chains in a LiteLLM router config composed
 * from `model_list`, ordered by Artificial Analysis Intelligence Index.
 *
 * The chains live entirely in LiteLLM: `coding-fallback` and the DashScope
 * aliases resolve to a head model group, and `router_settings.fallbacks` walks
 * the ordered remainder when a call fails after its retries. Pi's own automatic
 * retry re-sends the same model, so it does not compete with this chain.
 *
 * Commands
 * --------
 *   /coding-fallback                  report drift, unranked models, and order changes
 *   /coding-fallback check            same as above
 *   /coding-fallback sync             refresh the free-model snapshot, then rewrite
 *   /coding-fallback add              the picker: choose an upstream, then the models it serves
 *   /coding-fallback add <model> <host-or-slug> [<group-name>]
 *                                     the same registration without the picker
 *
 * A session start only reports drift. Rewriting another tool's config file is
 * left to an explicit command, and the factory touches no files, so loading the
 * extension without a session stays side-effect free. `add` writes the config —
 * through the same compose, guard, and backup path `sync` uses — so it asks for
 * confirmation when there is a UI to ask with.
 *
 * The free-model snapshot is different from the config in one way: reading it is
 * harmless, and the promo it records can appear and disappear inside a working
 * day, so a session start refreshes it in the background when it is stale. That
 * refresh is never awaited — a session must not wait on a network call to start —
 * and a failure leaves the previous snapshot in place. The config itself is only
 * ever written by `sync` and `add`, which refresh the snapshot first so the
 * groups they generate or prune reflect the listing as of that moment.
 *
 * The window is linear rather than a menu that loops: each answer is needed
 * before the next question, and the last step writes a proxy's config. Only the
 * upstream comes from a list, because it is the one choice with a wrong answer
 * the config would not survive — a base URL the operator never configured.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { addModels, checkFallback, readConfig, syncFallback } from "./config.ts";
import {
  candidatesFrom,
  claimNames,
  describeBatch,
  knownUpstreams,
  pickerHint,
  pickerTitle,
  routerLabel,
} from "./catalog.ts";
import type { Candidate, PickSource } from "./catalog.ts";
import { DEFAULT_FRESHNESS_MS, refreshFreeSnapshot } from "./free-fetch.ts";
import { listUpstreamModels } from "./listing.ts";
import { ModelPicker } from "./picker.ts";
import type { PickerOutcome } from "./picker.ts";
import {
  completionsFor,
  describeAddition,
  existingGroupNames,
  groupName,
  nextCodeNumber,
  optionForSlug,
  upstreamOptions,
  validateGroupName,
  validateModelId,
  validateSlug,
} from "./register.ts";
import type { NewModel, UpstreamOption } from "./register.ts";
import { loadScores, resolveScoresPath, scoreFor } from "./scores.ts";

const COMMAND = "coding-fallback";

/** Set to `off` to keep the extension from reading the network at all. */
const REFRESH_ENV = "PI_CODING_FALLBACK_FREE_REFRESH";

/** The scriptable form, quoted in every message that has to name it. */
const ADD_USAGE = `/${COMMAND} add <model-id> <host-or-slug> [<group-name>]`;

function extensionDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function resolveConfigPath(): string {
  const override = process.env.PI_CODING_FALLBACK_CONFIG;
  return override && override.trim() !== "" ? override : join(getAgentDir(), "litellm_config.yaml");
}

function resolveFreePath(): string {
  const override = process.env.PI_CODING_FALLBACK_FREE;
  return override && override.trim() !== "" ? override : join(extensionDir(), "free-models.json");
}

function refreshEnabled(): boolean {
  const value = process.env[REFRESH_ENV];
  return value === undefined || value.trim().toLowerCase() !== "off";
}

/**
 * Probe the upstream listings and cache them. Never throws, and never awaited by
 * a caller that cannot afford to wait: a failed probe leaves the previous
 * snapshot to be used, which is a fact older than ideal rather than a wrong one.
 */
async function refreshQuietly(timeoutMs: number, force: boolean): Promise<void> {
  if (!refreshEnabled()) return;
  try {
    const result = await refreshFreeSnapshot({
      path: resolveFreePath(),
      timeoutMs,
      freshnessMs: DEFAULT_FRESHNESS_MS,
      force,
    });
    if (result.state === "error") console.error(`coding-fallback: ${result.message}`);
  } catch (error) {
    console.error(`coding-fallback: free-model refresh failed (${String(error)})`);
  }
}

/** The upstreams the config offers, or the reason it could not be read. */
async function optionsOnDisk(): Promise<
  { readonly options: readonly UpstreamOption[]; readonly text: string } | { readonly error: string }
> {
  const read = await readConfig(resolveConfigPath());
  if ("error" in read) return { error: read.error };
  return { options: upstreamOptions(read.text), text: read.text };
}

/**
 * Host slugs for the argument completion. Read once and dropped after a write,
 * because a registration with a hand-typed slug can add one that was not there.
 */
let cachedSlugs: readonly string[] | undefined;

async function hostSlugs(): Promise<readonly string[]> {
  if (cachedSlugs) return cachedSlugs;
  const onDisk = await optionsOnDisk();
  if ("error" in onDisk) return [];
  cachedSlugs = onDisk.options.flatMap((option) => (option.slug === undefined ? [] : [option.slug]));
  return cachedSlugs;
}

/** One line per upstream, as the window's list shows it. */
function describeOption(option: UpstreamOption): string {
  const slug = option.slug ?? "no slug in its names";
  return `${option.host} — ${slug}, ${option.tierLabel} — ${option.baseUrl}`;
}

/** The score the chain will rank this model by, or `undefined` when it has none. */
async function scoreOf(modelId: string): Promise<number | undefined> {
  return scoreFor(await loadScores(resolveScoresPath()), modelId);
}

/** Ask before writing, when there is a UI to ask with. */
async function confirmed(ctx: ExtensionCommandContext, model: NewModel, option: UpstreamOption): Promise<boolean> {
  if (ctx?.hasUI !== true) return true;
  const score = await scoreOf(model.modelId);
  return ctx.ui.confirm(
    `Add ${model.name}?`,
    `${describeAddition(model, option, score)}\n\nThe config is copied to a timestamped backup first, then the fallback blocks are regenerated. ` +
      "LiteLLM reads the file at startup, so it needs a restart to apply.",
  );
}

/**
 * The models an upstream offers: its own listing when it answers, and what this
 * config already uses elsewhere when it does not. The picker's title says which
 * of the two it is looking at, so a fallback list is never mistaken for the
 * host's own answer.
 */
async function offersFor(
  option: UpstreamOption,
  configText: string,
): Promise<{
  readonly source: PickSource;
  readonly candidates: readonly Candidate[];
  readonly alreadyServed: number;
}> {
  const scores = await loadScores(resolveScoresPath());
  const listing = await listUpstreamModels({ baseUrl: option.baseUrl, apiKey: option.apiKey });
  const source: PickSource = listing.ok ? { kind: "listing" } : { kind: "config", reason: listing.reason };
  const ids = listing.ok ? listing.ids : knownUpstreams(configText, option.host);
  // A listing is the chosen upstream's own answer, so every row belongs to it.
  // The fallback list's rows have no listing behind them, and each names the
  // host that already serves it instead.
  const set = candidatesFrom(ids, configText, option.host, scores, listing.ok ? routerLabel(option) : undefined);
  return { source, candidates: set.candidates, alreadyServed: set.alreadyServed };
}

/**
 * Register the groups. The free-model listing is read before the compose for the
 * same reason `sync` reads it: the same pass prunes the generated groups whose
 * promo ended, and that is a decision which has to be made from the listing as it
 * is now. One write for the whole batch, so a file never holds a group outside
 * the chains.
 */
async function writeAddition(ctx: ExtensionCommandContext, models: readonly NewModel[]): Promise<void> {
  await refreshQuietly(20_000, true);
  const result = await addModels(resolveConfigPath(), resolveScoresPath(), resolveFreePath(), models);
  cachedSlugs = undefined;
  ctx?.ui?.notify?.(result.message, result.state === "error" ? "error" : "info");
}

/**
 * The picker: an upstream, the models it serves, the names, one confirmation.
 *
 * The model is never typed here — the list is the host's own answer, so anything
 * chosen is something that host says it has. Names are proposed rather than asked
 * for: of `code-<n>-<slug>-<model>`, the only part worth deciding is the number,
 * and a batch takes the next free one per model.
 */
async function addWithWindow(ctx: ExtensionCommandContext): Promise<void> {
  const notify = (message: string, type?: "info" | "warning" | "error") => ctx?.ui?.notify?.(message, type);

  if (ctx?.hasUI !== true) {
    notify(
      `${COMMAND}: the picker needs an interactive session. Use \`${ADD_USAGE}\`, ` +
        `or edit ${resolveConfigPath()} and run /${COMMAND} sync.`,
      "warning",
    );
    return;
  }
  // `ctx.ui.custom` belongs to the interactive TUI: RPC and print modes answer
  // `undefined` for it, so the picker is only offered where it can be drawn.
  if (ctx.mode !== "tui") {
    notify(
      `${COMMAND}: the picker needs the TUI (this session is "${ctx.mode}"). Use \`${ADD_USAGE}\` here.`,
      "warning",
    );
    return;
  }

  const onDisk = await optionsOnDisk();
  if ("error" in onDisk) {
    notify(`${COMMAND}: ${onDisk.error}`, "error");
    return;
  }
  if (onDisk.options.length === 0) {
    notify(
      `${COMMAND}: no upstream to register against — model_list has no entry with an api_base.`,
      "warning",
    );
    return;
  }

  const labels = onDisk.options.map(describeOption);
  const choice = await ctx.ui.select(`${COMMAND} add — which upstream?`, [...labels, "Cancel"]);
  if (choice === undefined || choice === "Cancel") return;
  const option = onDisk.options[labels.indexOf(choice)];
  if (option === undefined) return;

  // A host whose own names carry no slug cannot be named after one, so the
  // operator names it here rather than the picker inventing "dashscope-intl".
  let slug = option.slug;
  if (slug === undefined) {
    const slugAnswer = await ctx.ui.input(`Short name for ${option.host}`, "used in the group name, e.g. nvidia");
    if (slugAnswer === undefined) return;
    slug = slugAnswer.trim();
    const badSlug = validateSlug(slug);
    if (badSlug) {
      notify(`${COMMAND}: ${badSlug}`, "error");
      return;
    }
  }

  const { source, candidates, alreadyServed } = await offersFor(option, onDisk.text);
  if (candidates.length === 0) {
    notify(
      source.kind === "listing"
        ? `${COMMAND}: ${option.host} lists nothing this config does not already have.`
        : `${COMMAND}: nothing to offer — ${source.reason}, and this config uses no model on another host.`,
      "warning",
    );
    return;
  }

  // `undefined` as well as `null`: a mode that cannot draw the component (RPC)
  // answers `undefined` for it, which is a cancel here rather than a crash.
  const picked: PickerOutcome | undefined = await ctx.ui.custom<PickerOutcome>((_tui, theme, _keybindings, done) =>
    new ModelPicker(
      {
        title: pickerTitle(option.host, source, candidates.length, alreadyServed),
        hint: pickerHint(),
        candidates,
      },
      theme,
      done,
    ),
  );
  if (picked === undefined || picked === null || picked.length === 0) return;

  const names = claimNames(
    picked.length,
    existingGroupNames(onDisk.text),
    slug,
    picked.map((candidate) => candidate.id),
  );
  const models: NewModel[] = picked.map((candidate, index) => ({
    name: names[index] ?? "",
    modelId: candidate.id,
    baseUrl: option.baseUrl,
    apiKey: option.apiKey,
  }));

  const badName = models.map((model) => validateGroupName(model.name)).find((reason) => reason !== undefined);
  if (badName !== undefined) {
    notify(`${COMMAND}: ${badName}`, "error");
    return;
  }

  const picks = picked.map((candidate, index) => ({ candidate, name: names[index] ?? "" }));
  const confirmed = await ctx.ui.confirm(
    models.length === 1 ? `Add ${models[0].name}?` : `Add ${models.length} models?`,
    `${describeBatch(picks, option, source)}\n\n` +
      "The config is copied to a timestamped backup first, then the fallback blocks are regenerated in one pass. " +
      "LiteLLM reads the file at startup, so it needs a restart to apply.",
  );
  if (!confirmed) return;
  await writeAddition(ctx, models);
}

/**
 * The scriptable form: `/coding-fallback add <model> <host-or-slug> [<name>]`.
 *
 * The upstream is named by its slug or by its hostname. A host whose names carry
 * no slug has nothing to derive a name from, so the group name is required
 * there — spelled out, not guessed.
 */
async function addFromArguments(ctx: ExtensionCommandContext, rest: readonly string[]): Promise<void> {
  const notify = (message: string, type?: "info" | "warning" | "error") => ctx?.ui?.notify?.(message, type);
  const [modelId = "", selector, explicitName] = rest;

  const badModel = validateModelId(modelId);
  if (badModel) {
    notify(`${COMMAND}: ${badModel}. Usage: ${ADD_USAGE}`, "error");
    return;
  }

  const onDisk = await optionsOnDisk();
  if ("error" in onDisk) {
    notify(`${COMMAND}: ${onDisk.error}`, "error");
    return;
  }
  if (onDisk.options.length === 0) {
    notify(`${COMMAND}: no upstream to register against — model_list has no entry with an api_base.`, "warning");
    return;
  }

  const wanted = selector?.trim().toLowerCase();
  const option =
    (wanted === undefined ? undefined : optionForSlug(onDisk.options, wanted)) ??
    (wanted === undefined ? undefined : onDisk.options.find((entry) => entry.host.toLowerCase() === wanted)) ??
    (selector === undefined && onDisk.options.length === 1 ? onDisk.options[0] : undefined);

  if (option === undefined) {
    const available = onDisk.options.map((entry) => entry.slug ?? entry.host).join(", ");
    notify(`${COMMAND}: name one upstream — ${available}`, "error");
    return;
  }

  const name =
    explicitName ??
    (option.slug === undefined
      ? undefined
      : groupName(nextCodeNumber(existingGroupNames(onDisk.text)), option.slug, modelId));
  if (name === undefined) {
    notify(
      `${COMMAND}: no group on ${option.host} carries a slug, so pass the name: ` +
        `/${COMMAND} add ${modelId} ${selector ?? option.host} code-<n>-<slug>-${modelId}`,
      "error",
    );
    return;
  }

  const badName = validateGroupName(name);
  if (badName) {
    notify(`${COMMAND}: ${badName}`, "error");
    return;
  }

  const model: NewModel = { name, modelId, baseUrl: option.baseUrl, apiKey: option.apiKey };
  if (!(await confirmed(ctx, model, option))) return;
  await writeAddition(ctx, [model]);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand(COMMAND, {
    description: "Check, regenerate, or extend the LiteLLM fallback chains (ordered by AAII score)",
    getArgumentCompletions: async (prefix) =>
      completionsFor(prefix, await hostSlugs()).map((item) => ({
        value: item.value,
        label: item.value,
        description: item.description,
      })),
    handler: async (args, ctx) => {
      const configPath = resolveConfigPath();
      const scoresPath = resolveScoresPath();
      const freePath = resolveFreePath();
      const words = (args ?? "")
        .trim()
        .split(/\s+/)
        .filter((word) => word !== "");
      const subcommand = (words[0] ?? "check").toLowerCase();

      if (subcommand === "add") {
        const rest = words.slice(1);
        if (rest.length === 0) await addWithWindow(ctx);
        else await addFromArguments(ctx, rest);
        return;
      }

      if (subcommand !== "check" && subcommand !== "sync") {
        ctx?.ui?.notify?.(`${COMMAND}: unknown subcommand \`${subcommand}\`. Try check, sync, add`, "warning");
        return;
      }

      // A sync may add or drop a group, so the listing it decides from has to be
      // read now rather than reused from the cache.
      if (subcommand === "sync") await refreshQuietly(20_000, true);

      const result =
        subcommand === "sync"
          ? await syncFallback(configPath, scoresPath, freePath)
          : await checkFallback(configPath, scoresPath, freePath);

      ctx?.ui?.notify?.(result.message, result.state === "error" ? "error" : "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx?.hasUI === false) return;

    // Kick the snapshot refresh off and move on: the report below reads whatever
    // snapshot is on disk, and the next session sees the refreshed one.
    void refreshQuietly(12_000, false);

    const result = await checkFallback(resolveConfigPath(), resolveScoresPath(), resolveFreePath());
    if (result.state === "drifted" || result.state === "error") {
      ctx?.ui?.notify?.(result.message, "warning");
    }
  });
}
