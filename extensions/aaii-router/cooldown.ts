/**
 * Failure memory for the AAII router: which candidates failed recently, and for
 * how long they stay out of the running.
 *
 * Pure. The router owns the clock, keeps the resulting map in its session state,
 * and passes it back in on the next request, so a model that just answered a
 * rate limit is not the first thing the next turn tries. That is the rule the
 * LiteLLM config on the other side of this migration already applies with
 * `cooldown_time: 300` and `allowed_fails: 1`; without it, a failing upstream is
 * retried once per turn and every retry costs a request and a turn.
 *
 * A window is a hint, not a lock. When every remaining candidate is cooling,
 * `stepForward` still advances, because turning a cooldown into "no model is
 * available" would fail a turn that has a usable model.
 */

import type { Candidate } from "./candidates.ts";

/** Five minutes, matching the `cooldown_time: 300` of the config this replaces. */
export const DEFAULT_COOLDOWN_MS = 300_000;

/** Why a request failed, as far as the error text tells us. */
export type FailureKind = "rate-limit" | "auth" | "error";

/** Why a candidate is out. `manual` is the `/aaii-router next` escape hatch. */
export type CooldownReason = FailureKind | "manual";

export interface CooldownEntry {
  /** Epoch milliseconds at which the candidate becomes usable again. */
  readonly until: number;
  readonly reason: CooldownReason;
}

export type CooldownMap = Readonly<Record<string, CooldownEntry>>;

/**
 * The failure fields of the request. A context overflow is its own signal: Pi
 * compacts the context and retries, so the model did not fail and is not
 * remembered — only stepped past.
 */
export type FailureSignal = FailureKind | "overflow";

export interface FailureMessage {
  readonly stopReason?: string;
  readonly errorMessage?: string;
}

const RATE_LIMIT = /rate.?limit|too many requests|\b429\b|quota|overloaded|over capacity|capacity exceeded/i;
const AUTH = /\b401\b|\b403\b|unauthor|authentication|invalid api key|forbidden/i;
const OVERFLOW = /context (length|window|limit)|maximum context|too long|token limit|exceed(s|ed)? the (maximum|context)/i;

/**
 * What a failed request says happened, or `undefined` when it was not a
 * failure at all. An aborted turn is the user pressing ESC, and a stopped turn
 * is a normal finish, so neither is recorded: benching a model because the
 * operator cancelled it would move the chain for the wrong reason.
 */
export function classifyFailure(message: FailureMessage | undefined): FailureSignal | undefined {
  if (!message) return "error";
  const stop = message.stopReason;
  if (stop === "aborted" || stop === "stop" || stop === "toolUse" || stop === "pending") return undefined;

  const text = message.errorMessage ?? "";
  if (OVERFLOW.test(text)) return "overflow";
  if (RATE_LIMIT.test(text)) return "rate-limit";
  if (AUTH.test(text)) return "auth";
  return "error";
}

/** Whether a signal earns a cooldown window. See {@link FailureSignal}. */
export function remembers(signal: FailureSignal | undefined): signal is FailureKind {
  return signal === "rate-limit" || signal === "auth" || signal === "error";
}

/** Drop expired entries, so the map a session carries stays bounded. */
export function pruneCooldowns(cooldowns: CooldownMap | undefined, now: number): CooldownMap {
  if (!cooldowns) return {};
  const kept: Record<string, CooldownEntry> = {};
  for (const [label, entry] of Object.entries(cooldowns)) {
    if (entry && entry.until > now) kept[label] = entry;
  }
  return kept;
}

/** The window an entry would start, or `undefined` when the label is usable. */
export function coolingFor(
  cooldowns: CooldownMap | undefined,
  label: string | undefined,
  now: number,
): CooldownEntry | undefined {
  if (!cooldowns || !label) return undefined;
  const entry = cooldowns[label];
  return entry && entry.until > now ? entry : undefined;
}

/**
 * Record a failure. A window of zero or less disables the memory entirely,
 * which is why there is no separate switch for it.
 */
export function rememberFailure(
  cooldowns: CooldownMap | undefined,
  label: string,
  reason: CooldownReason,
  now: number,
  windowMs: number,
): CooldownMap {
  if (!(windowMs > 0)) return pruneCooldowns(cooldowns, now);
  return { ...pruneCooldowns(cooldowns, now), [label]: { until: now + windowMs, reason } };
}

/** Cooling labels, soonest to expire first, for a report. */
export function coolingLabels(cooldowns: CooldownMap | undefined, now: number): string[] {
  const live = Object.entries(pruneCooldowns(cooldowns, now));
  return live.sort(([, a], [, b]) => a.until - b.until).map(([label]) => label);
}

/** Candidates that can be used now, in the order given. */
export function available<T extends { label: string }>(
  ordered: readonly T[],
  cooldowns: CooldownMap | undefined,
  now: number,
): T[] {
  return ordered.filter((item) => coolingFor(cooldowns, item.label, now) === undefined);
}

/**
 * The candidate a fresh request should use: the first one that is not cooling,
 * and the head of the order when every one of them is. This is what keeps a
 * failed model from being retried on the next turn.
 */
export function preferred<T extends { label: string }>(
  ordered: readonly T[],
  cooldowns: CooldownMap | undefined,
  now: number,
): T | undefined {
  return available(ordered, cooldowns, now)[0] ?? ordered[0];
}

/**
 * The candidate to use after `from` failed: the first later one that is not
 * cooling. When every later candidate is cooling the next one in policy order
 * is returned anyway, so a cooldown never exhausts the chain on its own.
 * `undefined` means the model that failed was the last in the order.
 */
export function stepForward<T extends { label: string }>(
  ordered: readonly T[],
  cooldowns: CooldownMap | undefined,
  from: string | undefined,
  now: number,
): T | undefined {
  const start = from === undefined ? -1 : ordered.findIndex((item) => item.label === from);
  const rest = ordered.slice(start + 1);
  if (rest.length === 0) return undefined;
  return available(rest, cooldowns, now)[0] ?? rest[0];
}

/** Remaining window in words, for a report. */
export function remainingText(entry: CooldownEntry, now: number): string {
  const seconds = Math.max(0, Math.ceil((entry.until - now) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m${seconds % 60}s`;
}

/** The label a candidate is reported under, for the reader of a report. */
export function describeCooldown(entry: CooldownEntry, now: number): string {
  return `cooling ${remainingText(entry, now)}, ${entry.reason}`;
}

/** Candidates paired with their cooldown, for a report. */
export function withCooldown(
  candidates: readonly Candidate[],
  cooldowns: CooldownMap | undefined,
  now: number,
): { candidate: Candidate; cooling: CooldownEntry | undefined }[] {
  return candidates.map((candidate) => ({
    candidate,
    cooling: coolingFor(cooldowns, candidate.label, now),
  }));
}
