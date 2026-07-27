// F8 — client-safe, pure follow-up logic: schedule computation, plan clamping,
// due-selection, and quiet-hours. Shared by the scheduler, the cron, and the UI;
// unit-tested (this is the core the acceptance criteria hinge on).

export type FollowupKind = "REMINDER" | "EXPIRY_WARNING" | "EXPIRED";
export type FollowupStatus = "SCHEDULED" | "SENT" | "CANCELLED";

export interface FollowupPolicy {
  enabled: boolean;
  expiryDays: number;
  cadenceDays: number[];
  maxNudges: number;
}

export const DEFAULT_POLICY: FollowupPolicy = {
  enabled: false,
  expiryDays: 14,
  cadenceDays: [3, 7, 12],
  maxNudges: 3,
};

const DAY_MS = 86_400_000;

/**
 * Clamp a cadence to the plan's max nudges. Starter (max 1) keeps a single
 * (manual) reminder; Growth keeps the full list. Pure.
 */
export function clampCadence(cadenceDays: number[], planMax: number): number[] {
  const clean = [...new Set(cadenceDays.filter((d) => Number.isInteger(d) && d > 0))].sort((a, b) => a - b);
  return clean.slice(0, Math.max(0, planMax));
}

export interface ScheduledItem {
  kind: FollowupKind;
  scheduledFor: Date;
}

/**
 * The follow-up schedule for a quote: reminder nudges on the cadence (capped by
 * maxNudges and the plan max, and only before expiry), an expiry warning the day
 * before, and the expiry itself. Pure.
 */
export function computeSchedule(
  submittedAt: Date,
  expiresAt: Date,
  policy: FollowupPolicy,
  planMax: number,
): ScheduledItem[] {
  const items: ScheduledItem[] = [];
  if (!policy.enabled) return items;

  const cadence = clampCadence(policy.cadenceDays, planMax).slice(0, Math.max(0, policy.maxNudges));
  for (const d of cadence) {
    const when = new Date(submittedAt.getTime() + d * DAY_MS);
    if (when < expiresAt) items.push({ kind: "REMINDER", scheduledFor: when });
  }

  const warnAt = new Date(expiresAt.getTime() - DAY_MS);
  if (warnAt > submittedAt) items.push({ kind: "EXPIRY_WARNING", scheduledFor: warnAt });

  items.push({ kind: "EXPIRED", scheduledFor: expiresAt });
  return items;
}

export interface DueContext {
  now: Date;
  unsubscribed: boolean;
  /** Is `now` inside the store's business hours? (Ignored for EXPIRED.) */
  businessHoursOk: boolean;
}

export interface FollowupLike {
  id: string;
  kind: FollowupKind;
  status: FollowupStatus;
  scheduledFor: Date | string;
}

/**
 * Which follow-ups are due to dispatch right now. SCHEDULED + past due; skips
 * everything for an unsubscribed buyer EXCEPT the terminal EXPIRED transition;
 * reminders/warnings respect quiet hours. Pure.
 */
export function dueFollowups(followups: FollowupLike[], ctx: DueContext): FollowupLike[] {
  return followups.filter((f) => {
    if (f.status !== "SCHEDULED") return false;
    if (new Date(f.scheduledFor).getTime() > ctx.now.getTime()) return false;
    if (f.kind === "EXPIRED") return true; // the state transition always runs
    if (ctx.unsubscribed) return false;
    return ctx.businessHoursOk;
  });
}

/** The hour (0–23) at `date` in an IANA timezone. Falls back to UTC. Pure-ish. */
export function hourInZone(date: Date, tz: string | null | undefined): number {
  if (!tz) return date.getUTCHours();
  try {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(date);
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? n % 24 : date.getUTCHours();
  } catch {
    return date.getUTCHours();
  }
}

/** Weekday index (0=Sun..6=Sat) at `date` in a timezone. */
export function weekdayInZone(date: Date, tz: string | null | undefined): number {
  if (!tz) return date.getUTCDay();
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  } catch {
    return date.getUTCDay();
  }
}

/** Quiet-hours-safe: Mon–Fri, 9:00–17:59 in the store timezone. Pure. */
export function isBusinessHours(date: Date, tz: string | null | undefined): boolean {
  const h = hourInZone(date, tz);
  const wd = weekdayInZone(date, tz);
  return wd >= 1 && wd <= 5 && h >= 9 && h < 18;
}
