/**
 * Pi extension: an AAII-ordered fail-over router that calls providers directly.
 *
 * It registers `aaii/fallback`, a virtual model. Pi picks it like any other
 * model, and for each request the router chooses a physical model from the
 * providers this Pi already has credentials for. When a request fails, Pi
 * retries; the router sees `reason: "retry"` with the model that failed and
 * returns the next one in the order.
 *
 * The order is the same one the LiteLLM config composer uses: Artificial
 * Analysis Intelligence Index descending first, then the quota tier that
 * replenishes soonest, then provider/id. No LiteLLM proxy is involved, so this
 * replaces the `fallbacks` matrix rather than feeding it.
 *
 * Failure memory
 * --------------
 * A failure does more than step the chain on: its model goes out for one
 * cooldown window, and the window is kept in the router state, so the next turn
 * does not start by retrying what just failed. This is the rule the config on
 * the other side of this migration states as `cooldown_time: 300`. An aborted
 * turn is never remembered — that is the operator pressing ESC, not a model
 * failing — and neither is a context overflow, which Pi answers by compacting
 * and retrying. Candidates still cooling are skipped while an alternative
 * exists, and taken anyway when they are all that is left, so a cooldown never
 * turns into "no model available".
 *
 * Images
 * ------
 * Pi substitutes placeholders for a model without image support, so a
 * screenshot sent to a text-only candidate is silently not seen. A request that
 * carries an image puts the candidates that can see it ahead of the ones that
 * cannot, keeping every model in the list and the tier tie-break inside each
 * group.
 *
 * Visibility
 * ----------
 * The footer carries the physical candidate the session is on, and how many
 * candidates are cooling. It is written in a `try`, so a UI that refuses the
 * call cannot fail a request: the status line is decoration, the route is not.
 *
 * Settings
 * --------
 * `/aaii-router settings` is the settings window: one entry per setting, with
 * the current value as its label, and a dialog per entry — a confirmation for a
 * toggle, a text field for a number or a list. Each value is validated by
 * `settings.ts` before it is stored, so a typo is refused in the dialog rather
 * than silently replaced by a default. The same command carries the scriptable
 * form for a session with no UI: `set <key> <value>`, `reset`, and argument
 * completions that list the subcommands, the keys and the short values.
 *
 * The chain itself is edited in `/aaii-router fallback`: the candidates as a
 * list, where `p` tries a model first and `x` leaves one out without excluding
 * its whole provider. A pin is stored as an order of labels, so the score order
 * still decides everything the operator did not touch. Both lists are global
 * only: they decide where a request goes, so a checked-out repository may not
 * set them, and the editor writes the global file rather than asking which one.
 *
 * Three sources, in this order: the global file
 * (`~/.pi/agent/aaii-router.json`, or `PI_AAII_ROUTER_SETTINGS`), a
 * project-local `.pi/aaii-router.json` that only counts when Pi trusts the
 * project, and the environment. A project may set only the keys that change how
 * the router treats the operator — how long a failure is remembered, whether an
 * image matters, whether the footer is drawn — not the ones that decide where a
 * request goes, so a checked-out repository cannot redirect the chain. The
 * environment wins over both files, which keeps a headless session configurable
 * without the window. A value the router could not use is reported by
 * `/aaii-router` instead of being dropped quietly.
 *
 * What it does not do
 * -------------------
 * It does not touch any config file, and it does not remove anything. The
 * LiteLLM entries in `models.json` and the `fallbacks` matrix stay exactly as
 * they are until they are deleted deliberately.
 *
 * Commands
 * --------
 *   /aaii-router            list the candidates in order, with score and tier
 *   /aaii-router fallback   edit the chain: pin, exclude and reorder candidates
 *   /aaii-router settings   open the settings window
 *   /aaii-router set <key> <value>   write one setting without the window
 *   /aaii-router reset      write the default settings
 *   /aaii-router next       take the current candidate out for one cooldown window
 *   /aaii-router reload     rebuild the list after a score or credential change
 */

import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { TIER_UNKNOWN } from "../coding-fallback/providers.ts";
import type {
  CustomEntry,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  VirtualModelStateData,
} from "@earendil-works/pi-coding-agent";

import { VIRTUAL_MODEL_STATE_ENTRY, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  buildCandidates,
  containsImage,
  orderForRequest,
  unclassifiedCandidates,
  unscoredCandidates,
} from "./candidates.ts";
import type { Candidate, PhysicalModel } from "./candidates.ts";
import { applyChainSettings } from "./chain-order.ts";
import {
  chooseTurnCandidate,
  classifyFailure,
  coolingFor,
  coolingLabels,
  describeCooldown,
  preferred,
  pruneCooldowns,
  rememberFailure,
  remembers,
  stepForward,
  withCooldown,
} from "./cooldown.ts";
import type { CooldownMap } from "./cooldown.ts";
import { FallbackEditor } from "./fallback-tui.ts";
import type { FallbackOutcome } from "./fallback-tui.ts";
import {
  DEFAULT_SETTINGS,
  SETTINGS,
  SETTINGS_FILE,
  completionsFor,
  describeSettings,
  editSetting,
  loadSettings,
  routingChanged,
  saveSettings,
} from "./settings.ts";
import type { SettingDescriptor, Settings } from "./settings.ts";
import { loadScores, resolveScoresPath } from "../coding-fallback/scores.ts";
import type { ScoreSnapshot } from "../coding-fallback/scores.ts";

const PROVIDER = "aaii";
const MODEL_ID = "fallback";
const COMMAND = "aaii-router";
const STATUS_KEY = "aaii-router";

/** Path to the settings file, when it is not the default one. */
const SETTINGS_ENV = "PI_AAII_ROUTER_SETTINGS";

/** API id Pi gives virtual catalog entries; they must never be candidates. */
const VIRTUAL_API = "pi-virtual";

export interface RouterState {
  /** `provider/id` of the candidate the session is currently on. */
  label: string;
  /** Candidates that failed recently, keyed by their label. */
  cooldowns?: CooldownMap;
  /** Monotonic counter incremented whenever chain configuration changes. */
  epoch?: number;
}

let chainEpoch = 0;

function bumpChainEpoch(): void {
  chainEpoch++;
}



/**
 * Failures recorded by a command, merged into the state on the next request.
 * The command cannot write the session itself — `ctx.sessionManager` is
 * read-only — so it leaves the entry here for the next `route()` to pick up,
 * and `route()` clears it as it takes it.
 */
let pendingCooldowns: CooldownMap = {};

let cache: Registry | undefined;
let settingsCache: Settings | undefined;
let settingsNotes: readonly string[] = [];

/** The global settings file: what the window and `set` write. */
function globalSettingsPath(): string {
  const override = process.env[SETTINGS_ENV];
  return override && override.trim() !== "" ? override : join(getAgentDir(), SETTINGS_FILE);
}

/** The project settings file, which only a trusted project may contribute. */
function projectSettingsPath(ctx: ExtensionContext): string {
  return join(ctx.cwd, ".pi", SETTINGS_FILE);
}

/**
 * The settings in force. A project file is read only when Pi trusts the project,
 * so a checked-out repository cannot configure the router that is about to send
 * its prompts somewhere. When one is present and ignored, the report says so
 * rather than leaving the operator to wonder why their file did nothing.
 */
async function currentSettings(ctx: ExtensionContext): Promise<Settings> {
  if (settingsCache) return settingsCache;
  const trusted = ctx.isProjectTrusted();
  const parsed = await loadSettings(
    trusted ? { global: globalSettingsPath(), project: projectSettingsPath(ctx) } : { global: globalSettingsPath() },
    process.env,
  );
  const notes = [...parsed.notes];
  if (!trusted) {
    const path = projectSettingsPath(ctx);
    try {
      await lstat(path);
      notes.push(`ignored ${path}: the project is not trusted`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const reason = error instanceof Error ? error.message : String(error);
        notes.push(`ignored ${path}: the project is not trusted; could not check existence: ${reason}`);
      }
    }
  }
  settingsCache = parsed.settings;
  settingsNotes = notes;
  return settingsCache;
}

/** A settings write, or a new session, invalidates both caches. */
function forget(): void {
  settingsCache = undefined;
  settingsNotes = [];
  cache = undefined;
}

/** Environment variables that are holding a value the window cannot change. */
function envHeldKeys(): string[] {
  return SETTINGS.filter((descriptor) => (process.env[descriptor.envVar] ?? "").trim() !== "").map(
    (descriptor) => descriptor.envVar,
  );
}

interface Registry {
  readonly snapshot: ScoreSnapshot;
  readonly candidates: Candidate[];
}

function physicalModels(ctx: ExtensionContext): PhysicalModel[] {
  return ctx.modelRegistry
    .getModelsOfType("chat")
    .filter((model) => model.api !== VIRTUAL_API && model.provider !== PROVIDER)
    .filter((model) => ctx.modelRegistry.hasConfiguredAuth(model))
    .map((model) => ({
      provider: model.provider,
      id: model.id,
      baseUrl: model.baseUrl,
      supportsImages: model.input.includes("image"),
    }));
}

async function registry(ctx: ExtensionContext, settings: Settings): Promise<Registry> {
  if (cache) return cache;
  const snapshot = await loadScores(resolveScoresPath());
  cache = {
    snapshot,
    candidates: buildCandidates(physicalModels(ctx), snapshot, {
      excludedOrigins: settings.excludedOrigins,
      excludedProviders: settings.excludedProviders,
    }),
  };
  return cache;
}

/** The router state the branch recorded last, if any. */
function branchState(ctx: ExtensionContext | undefined): RouterState | undefined {
  if (!ctx) return undefined;
  const branch = ctx.sessionManager.getBranch();
  for (const entry of [...branch].reverse()) {
    if (entry.type !== "custom" || entry.customType !== VIRTUAL_MODEL_STATE_ENTRY) continue;
    const data = (entry as CustomEntry<VirtualModelStateData<RouterState>>).data;
    if (data?.provider === PROVIDER && data.modelId === MODEL_ID) return data.state;
  }
  return undefined;
}

/** The cooldown map in force now: what the branch recorded, plus what a command just set. */
function currentCooldowns(ctx: ExtensionContext | undefined, now: number): CooldownMap {
  return pruneCooldowns({ ...branchState(ctx)?.cooldowns, ...pendingCooldowns }, now);
}

function describe(candidate: Candidate): string {
  const score = candidate.score === undefined ? "unranked" : String(candidate.score);
  const tier = candidate.tier >= TIER_UNKNOWN ? "no tier" : "tier " + candidate.tier;
  return `${candidate.label} [${score}, ${tier}]`;
}

/** Resolve a candidate to a catalog model, or undefined when it vanished. */
function resolve(ctx: ExtensionContext, candidate: Candidate | undefined) {
  if (!candidate) return undefined;
  return ctx.modelRegistry.find(candidate.provider, candidate.id);
}

/** Publish status through the SDK UI, which is a no-op when headless. */
function publishStatus(
  ctx: ExtensionContext,
  label: string | undefined,
  cooldowns: CooldownMap,
  total: number,
  now: number,
  enabled: boolean,
): void {
  if (!enabled || !label) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }
  const cooling = coolingLabels(cooldowns, now).length;
  ctx.ui.setStatus(STATUS_KEY, `${PROVIDER} → ${label}${cooling > 0 ? ` · ${cooling}/${total} cooling` : ""}`);
}

function report(
  snapshot: ScoreSnapshot,
  candidates: readonly Candidate[],
  cooldowns: CooldownMap,
  settings: Settings,
  notes: readonly string[],
): string {
  const now = Date.now();
  const settingsLine = `settings: ${describeSettings(settings).join(" · ")}`;
  const ignored = notes.map((note) => `! ${note}`);
  if (candidates.length === 0) {
    return [
      `${COMMAND}: no eligible models. Every candidate either lacks credentials or is excluded by an origin or provider setting.`,
      settingsLine,
      ...ignored,
    ].join("\n");
  }

  const lines = withCooldown(candidates, cooldowns, now).map(({ candidate, cooling }, index) => {
    const note = cooling ? ` — ${describeCooldown(cooling, now)}` : "";
    return `${index + 1}. ${describe(candidate)}${note}`;
  });

  const summary: string[] = [];
  const unscored = unscoredCandidates(candidates);
  if (unscored.length > 0) summary.push(`${unscored.length} unranked (no AAII score)`);
  const unclassified = unclassifiedCandidates(candidates);
  if (unclassified.length > 0) summary.push(`${unclassified.length} with no quota tier`);
  const cooling = coolingLabels(cooldowns, now).length;
  if (cooling > 0) summary.push(`${cooling} cooling`);

  return [
    `${COMMAND}: ${candidates.length} candidates${
      snapshot.retrieved ? `, scores ${snapshot.retrieved}` : ", no score snapshot"
    }${summary.length ? ` (${summary.join(", ")})` : ""}`,
    settingsLine,
    ...ignored,
    ...lines,
  ].join("\n");
}

/**
 * The settings window: one dialog per setting. A toggle is a confirmation, a
 * number or a list is a text field, and every answer is validated before it is
 * written, so a typo is refused here rather than stored.
 */
async function editSettingDialog(
  ctx: ExtensionCommandContext,
  descriptor: SettingDescriptor,
  settings: Settings,
): Promise<Settings | undefined> {
  if (descriptor.kind === "toggle") {
    const on = descriptor.value(settings) === "on";
    const confirmed = await ctx.ui.confirm(descriptor.label, `${descriptor.help}\n\nTurn it ${on ? "off" : "on"}?`);
    if (!confirmed) return undefined;
    const edited = editSetting(settings, descriptor.key, on ? "off" : "on");
    return edited.ok ? edited.settings : undefined;
  }

  const answer = await ctx.ui.input(descriptor.label, descriptor.help);
  if (answer === undefined) return undefined;
  const edited = editSetting(settings, descriptor.key, answer);
  if (!edited.ok) {
    ctx.ui.notify(`${COMMAND}: ${edited.reason}`, "error");
    return undefined;
  }
  return edited.settings;
}

/**
 * Commit settings changes across all entry points:
 * save → bump the chain epoch only if routingChanged → forget (cache invalidation) → refresh the status line → report the keys env is overriding.
 */
async function commitSettings(
  ctx: ExtensionCommandContext,
  before: Settings,
  after: Settings,
  path: string,
  infoMessage: string,
): Promise<void> {
  await saveSettings(path, after);
  if (routingChanged(before, after)) bumpChainEpoch();
  forget();
  publishStatus(ctx, undefined, {}, 0, Date.now(), false);
  ctx.ui?.notify?.(infoMessage, "info");
  const held = envHeldKeys();
  if (held.length > 0) {
    ctx.ui?.notify?.(`${COMMAND}: ${held.join(", ")} still override this session`, "warning");
  }
}

async function openSettings(ctx: ExtensionCommandContext): Promise<void> {
  const path = globalSettingsPath();
  if (!ctx.hasUI) {
    ctx.ui?.notify?.(
      `${COMMAND}: the settings window needs an interactive session. Use \`/aaii-router set <key> <value>\`, edit ${path}, or set the environment instead.`,
      "warning",
    );
    return;
  }

  let settings = await currentSettings(ctx);

  for (;;) {
    const options = [...describeSettings(settings, process.env), "Reset to defaults", "Done"];
    const choice = await ctx.ui.select(`${COMMAND} settings — ${path}`, options);
    if (!choice || choice === "Done") return;

    let nextSettings: Settings;
    if (choice === "Reset to defaults") {
      const confirmed = await ctx.ui.confirm(
        "Reset to defaults",
        `Write the default settings to ${path}? An environment override still wins over the file.`,
      );
      if (!confirmed) continue;
      nextSettings = DEFAULT_SETTINGS;
    } else {
      const descriptor = SETTINGS.find((entry) => choice.startsWith(`${entry.label}:`));
      if (!descriptor) continue;
      const edited = await editSettingDialog(ctx, descriptor, settings);
      if (!edited) continue;
      nextSettings = edited;
    }

    try {
      await commitSettings(ctx, settings, nextSettings, path, `${COMMAND}: settings written to ${path}`);
      settings = nextSettings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`${COMMAND}: could not write ${path}: ${message}`, "error");
      continue;
    }
  }
}

async function openFallbackEditor(ctx: ExtensionCommandContext): Promise<void> {
  const path = globalSettingsPath();
  // `ctx.ui.custom` belongs to the interactive TUI: RPC and print modes answer
  // `undefined` for it, so the editor is only offered where it can be drawn.
  if (ctx?.hasUI !== true || ctx.mode !== "tui") {
    notify(
      `${COMMAND}: the chain editor needs the TUI (this session is "${ctx?.mode ?? "none"}"). ` +
        `Use \`/aaii-router set pinned <provider/id,...>\` or \`/aaii-router set models <provider/id,...>\` here, or edit ${path}.`,
      "warning",
    );
    return;
  }

  const settings = await currentSettings(ctx);
  const { candidates } = await registry(ctx, settings);

  const held = SETTINGS.filter(
    (descriptor) =>
      (descriptor.key === "pinned" || descriptor.key === "models") &&
      (process.env[descriptor.envVar] ?? "").trim() !== "",
  );
  const heldEnvVars = held.map((descriptor) => descriptor.envVar);

  // The component owns the draft; writing it is handled through onSave, keeping
  // the editor open if writing fails so the draft is not lost.
  await ctx.ui.custom<FallbackOutcome>((tui, theme, _keybindings, done) =>
    new FallbackEditor(
      {
        candidates,
        settings,
        path,
        heldEnvVars,
        onSave: async (savedSettings) => {
          await commitSettings(ctx, settings, savedSettings, path, `${COMMAND}: chain written to ${path}`);
        },
      },
      theme,
      done,
      () => tui.requestRender(),
    ),
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerVirtualModel<RouterState>({
    provider: PROVIDER,
    id: MODEL_ID,
    name: "AAII fallback (providers direct)",
    thinkingLevels: ["off", "minimal", "low", "medium", "high"],
    async route(request, ctx) {
      const settings = await currentSettings(ctx);
      const { candidates } = await registry(ctx, settings);
      const now = Date.now();
      const window = settings.cooldownMs;
      const carried = { ...request.state?.cooldowns, ...pendingCooldowns };
      pendingCooldowns = {};
      const cooldowns = pruneCooldowns(carried, now);
      const ordered = orderForRequest(
        applyChainSettings(candidates, settings),
        settings.preferVision && containsImage(request.messages),
      );

      const head = ordered[0];
      if (!head) {
        throw new Error(
          `[${COMMAND}] no eligible model: every chat model with credentials is unavailable or excluded by the settings`,
        );
      }

      const stick = (candidate: Candidate, next: CooldownMap, epoch = chainEpoch) => {
        const model = resolve(ctx, candidate);
        if (!model) throw new Error(`[${COMMAND}] ${candidate.label} is no longer in the catalog`);
        publishStatus(ctx, candidate.label, next, ordered.length, now, settings.statusLine);
        return { model, thinkingLevel: request.thinkingLevel, state: { label: candidate.label, cooldowns: next, epoch } };
      };

      // Never move the chain on a follow-up: keeping the model keeps the prompt cache.
      if (request.reason === "continuation") {
        const previous = request.previous?.model;
        const sticky = ordered.find(
          (candidate) => candidate.provider === previous?.provider && candidate.id === previous?.id,
        );
        if (sticky) return stick(sticky, cooldowns, request.state?.epoch ?? chainEpoch);
        const remembered = ordered.find((candidate) => candidate.label === request.state?.label);
        return stick(remembered ?? head, cooldowns, request.state?.epoch ?? chainEpoch);
      }

      // A failed request: remember why, then step past the model that failed.
      if (request.reason === "retry" && request.failed) {
        const failed = request.failed.model;
        const failedLabel = `${failed.provider}/${failed.id}`;
        const signal = classifyFailure(request.failed.message);
        const next = remembers(signal) ? rememberFailure(cooldowns, failedLabel, signal, now, window) : cooldowns;
        const candidate = stepForward(ordered, next, failedLabel, now);
        if (!candidate) {
          throw new Error(
            `[${COMMAND}] ${failedLabel} failed and the chain is exhausted after ${ordered.length} candidates`,
          );
        }
        return stick(candidate, next, chainEpoch);
      }

      // A new user turn, or a request outside the agent loop.
      const candidate = chooseTurnCandidate(ordered, cooldowns, request.state, chainEpoch, now);
      return stick(candidate, cooldowns, chainEpoch);
    },
  });

  pi.registerCommand(COMMAND, {
    description: "List the candidates, edit the chain or the settings, or step past the current model",
    // The subcommands and the setting keys are discoverable from the prompt, so
    // the command does not have to be remembered to be used.
    getArgumentCompletions: (prefix) =>
      completionsFor(prefix).map((item) => ({ value: item.value, label: item.value, description: item.description })),
    handler: async (args, ctx) => {
      const argument = (args ?? "").trim();
      const subcommand = argument.toLowerCase();
      if (!ctx) return;

      if (subcommand === "reload") {
        forget();
        return;
      }

      if (subcommand === "settings" || subcommand === "config") {
        await openSettings(ctx);
        return;
      }

      if (subcommand === "fallback") {
        await openFallbackEditor(ctx);
        return;
      }

      // The scriptable form, for a session with no UI and for a line copied out
      // of a shell alias. It writes the global file, never the project one.
      if (subcommand === "set" || subcommand.startsWith("set ")) {
        const [key, ...value] = argument.split(/\s+/).slice(1);
        const raw = value.join(" ");
        if (!key || raw === "") {
          ctx.ui?.notify?.(
            `${COMMAND}: set needs a key and a value, e.g. \`/aaii-router set cooldown 5m\`. Keys: ${SETTINGS.map((d) => d.key).join(", ")}`,
            "warning",
          );
          return;
        }
        const descriptor = SETTINGS.find((entry) => entry.key === key);
        if (!descriptor) {
          ctx.ui?.notify?.(
            `${COMMAND}: unknown setting \`${key}\`. Keys: ${SETTINGS.map((d) => d.key).join(", ")}`,
            "warning",
          );
          return;
        }
        const settings = await currentSettings(ctx);
        const edited = editSetting(settings, descriptor.key, raw);
        if (!edited.ok) {
          ctx.ui?.notify?.(`${COMMAND}: ${edited.reason}`, "error");
          return;
        }
        try {
          await commitSettings(
            ctx,
            settings,
            edited.settings,
            globalSettingsPath(),
            `${COMMAND}: ${descriptor.label} = ${descriptor.value(edited.settings)}`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui?.notify?.(`${COMMAND}: could not write ${globalSettingsPath()}: ${message}`, "error");
          return;
        }
        return;
      }

      if (subcommand === "reset") {
        const path = globalSettingsPath();
        if (ctx.hasUI && !(await ctx.ui.confirm("Reset to defaults", `Write the default settings to ${path}?`))) {
          return;
        }
        const settings = await currentSettings(ctx);
        try {
          await commitSettings(ctx, settings, DEFAULT_SETTINGS, path, `${COMMAND}: defaults written to ${path}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui?.notify?.(`${COMMAND}: could not write ${path}: ${message}`, "error");
          return;
        }
        return;
      }

      if (subcommand === "next") {
        const settings = await currentSettings(ctx);
        const { candidates } = await registry(ctx, settings);
        const label = branchState(ctx)?.label ?? applyChainSettings(candidates, settings)[0]?.label;
        if (!label) {
          ctx.ui?.notify?.(`${COMMAND}: no candidate to step past`, "warning");
          return;
        }
        pendingCooldowns = {
          ...pendingCooldowns,
          [label]: { until: Date.now() + settings.cooldownMs, reason: "manual" },
        };
        ctx.ui?.notify?.(
          settings.cooldownMs > 0
            ? `${COMMAND}: ${label} is out for ${Math.round(settings.cooldownMs / 1000)}s; the next request moves on`
            : `${COMMAND}: the cooldown window is off, so there is no window to step past`,
          "info",
        );
        return;
      }

      const settings = await currentSettings(ctx);
      const { snapshot, candidates } = await registry(ctx, settings);
      const now = Date.now();
      ctx.ui?.notify?.(
        report(
          snapshot,
          applyChainSettings(candidates, settings),
          currentCooldowns(ctx, now),
          settings,
          settingsNotes,
        ),
        "info",
      );
    },
  });

  // Credentials, scores and the settings file all change between sessions.
  pi.on("session_start", (_event, ctx) => {
    forget();
    pendingCooldowns = {};
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
