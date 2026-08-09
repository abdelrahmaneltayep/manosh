// Dual-mode plan config (client-safe + pure). The single source of truth for
// WHO gets Claude features and WHEN. Every dual-mode screen (F1–F15) imports
// `claudeAccess()` to decide whether to show the "✦ …with Claude" controls, the
// trial countdown, or the upgrade nudge — and the server guard
// (app/services/claude-access.server.ts) enforces the same decision before any
// model call.
//
// The rules (from the build brief):
//   • Growth / Scale  → Claude is INCLUDED (always allowed).
//   • Starter         → a ONE-TIME 7-day Claude trial, then locked.
//   • Free            → locked from the start.
//
// We key off the existing v3 capability map (aiCounter) + effective plan handle
// in app/lib/billing-v3.ts, so grandfathering and the Shopify trial are already
// handled correctly (a legacy Starter maps up to Growth capabilities → included;
// a fresh Starter → the 7-day Claude trial).
//
// Pure and deterministic: `now` is always injected so this is exhaustively
// unit-testable and never reads the clock itself.

import {
  effectivePlanHandle,
  getPlanCapabilities,
  type PlanHandle,
  type PrismaPlan,
} from "../lib/billing-v3";

/** How long the one-time Claude trial lasts for Starter shops. A setting, not a
 *  magic number buried in a handler (CLAUDE.md: settings, not constants). */
export const CLAUDE_TRIAL_DAYS = 7;

/** The only model Mannon calls for Claude features (CLAUDE.md tech stack). */
export const CLAUDE_MODEL = "claude-haiku-4-5";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ClaudeAccessState = "included" | "trial" | "locked" | "off";

export type ClaudeAccessReason =
  | "included" // Growth/Scale — Claude is part of the plan
  | "trial-available" // Starter, trial not yet started
  | "trial-active" // Starter, inside the 7-day window
  | "trial-ended" // Starter, window elapsed → locked
  | "plan-locked" // Free — never had access
  | "toggled-off"; // plan grants Claude, but the merchant turned it off

export interface ClaudeAccess {
  /** included = paid in; trial = Starter's 7-day window; off = plan grants Claude
   *  but the merchant toggled it off; locked = plan doesn't grant it. */
  state: ClaudeAccessState;
  /** Convenience: may the shop invoke a Claude feature right now? */
  allowed: boolean;
  /** Whole days left in the Starter trial (ceil). null when not on trial. */
  daysLeft: number | null;
  reason: ClaudeAccessReason;
  /** The effective v3 plan handle this decision was computed from. */
  handle: PlanHandle;
  /** True the first time a Starter shop is granted the trial — the server guard
   *  must persist `claudeTrialStartedAt = now` exactly once when it sees this. */
  shouldStartTrial: boolean;
  /** Does the PLAN grant Claude (ignoring the merchant toggle)? True for
   *  included + trial (and their toggled-off form). The settings toggle is only
   *  shown when this is true. */
  planGrantsClaude: boolean;
}

/** The minimal shape of a Shop row the gating needs. */
export interface ShopClaudeState {
  plan: PrismaPlan | string | null | undefined;
  legacyPlan?: boolean | null;
  claudeTrialStartedAt?: Date | string | null;
  /** Merchant on/off toggle. Undefined = on (default). Only applies where the
   *  plan grants Claude. */
  claudeEnabled?: boolean | null;
}

/** Whole days remaining in a trial that started at `startedAt`, evaluated at
 *  `now`. 0 once the window has elapsed. Never negative. Pure. */
export function trialDaysLeft(startedAt: Date, now: Date): number {
  const endMs = startedAt.getTime() + CLAUDE_TRIAL_DAYS * DAY_MS;
  const remainingMs = endMs - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / DAY_MS);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * The Claude-access decision for a shop at time `now`. Pure — inject `now`.
 *
 * Note it never mutates: for a Starter shop that hasn't started its trial it
 * returns `state: "trial"` with `shouldStartTrial: true` and a full
 * `CLAUDE_TRIAL_DAYS` countdown. The server guard is responsible for persisting
 * `claudeTrialStartedAt` the first time it acts on that flag (one-time).
 */
export function claudeAccess(shop: ShopClaudeState, now: Date): ClaudeAccess {
  const legacy = shop.legacyPlan ?? false;
  const handle = effectivePlanHandle(shop.plan, legacy);
  const caps = getPlanCapabilities(shop.plan, legacy);

  // First compute the PLAN decision, ignoring the merchant toggle. Then, if the
  // plan grants Claude but the merchant has switched it off, downgrade to "off".
  const base = planClaudeDecision(shop, now, handle, caps.aiCounter);

  // The toggle only bites where the plan actually grants Claude. A Free/locked
  // shop stays locked regardless of the flag (there's nothing to turn off).
  if (base.planGrantsClaude && shop.claudeEnabled === false) {
    return {
      state: "off",
      allowed: false,
      daysLeft: null,
      reason: "toggled-off",
      handle,
      shouldStartTrial: false,
      planGrantsClaude: true,
    };
  }

  return base;
}

/** The plan-only Claude decision (before the merchant on/off toggle). Split out
 *  so `claudeAccess` can layer the toggle on top without duplicating the ladder. */
function planClaudeDecision(
  shop: ShopClaudeState,
  now: Date,
  handle: PlanHandle,
  included: boolean,
): ClaudeAccess {
  // Growth / Scale (and grandfathered-up legacy plans) — Claude is included.
  if (included) {
    return {
      state: "included",
      allowed: true,
      daysLeft: null,
      reason: "included",
      handle,
      shouldStartTrial: false,
      planGrantsClaude: true,
    };
  }

  // Free — no Claude, ever (until they upgrade).
  if (handle === "free") {
    return {
      state: "locked",
      allowed: false,
      daysLeft: null,
      reason: "plan-locked",
      handle,
      shouldStartTrial: false,
      planGrantsClaude: false,
    };
  }

  // Starter — the one-time 7-day Claude trial.
  const startedAt = toDate(shop.claudeTrialStartedAt);
  if (!startedAt) {
    return {
      state: "trial",
      allowed: true,
      daysLeft: CLAUDE_TRIAL_DAYS,
      reason: "trial-available",
      handle,
      shouldStartTrial: true,
      planGrantsClaude: true,
    };
  }

  const daysLeft = trialDaysLeft(startedAt, now);
  if (daysLeft > 0) {
    return {
      state: "trial",
      allowed: true,
      daysLeft,
      reason: "trial-active",
      handle,
      shouldStartTrial: false,
      planGrantsClaude: true,
    };
  }

  // Trial elapsed → locked. The plan no longer grants Claude, so the toggle is
  // hidden (nothing to turn on/off until they upgrade).
  return {
    state: "locked",
    allowed: false,
    daysLeft: 0,
    reason: "trial-ended",
    handle,
    shouldStartTrial: false,
    planGrantsClaude: false,
  };
}

// --- quote allowance (Free is capped; every paid tier is unlimited) ----------

export interface QuoteAllowance {
  allowed: boolean;
  /** Quotes used in the current 30-day window. */
  used: number;
  /** The cap for the shop's plan. Infinity = unlimited. */
  cap: number;
  /** True only when the shop is on a capped (Free) plan. */
  capped: boolean;
}

/** How far back the rolling quote window looks. */
export const QUOTE_WINDOW_DAYS = 30;

/** The quote cap for a shop's plan (Infinity for every paid tier). Pure. */
export function quoteCapFor(shop: Pick<ShopClaudeState, "plan" | "legacyPlan">): number {
  return getPlanCapabilities(shop.plan, shop.legacyPlan ?? false).quotesCap;
}

/** Pure allowance decision: a new quote is allowed while `used < cap`. */
export function evaluateQuoteAllowance(
  shop: Pick<ShopClaudeState, "plan" | "legacyPlan">,
  used: number,
): QuoteAllowance {
  const cap = quoteCapFor(shop);
  return {
    allowed: used < cap,
    used,
    cap,
    capped: Number.isFinite(cap),
  };
}

/** Merchant-facing copy when the Free quote cap is hit (they can upgrade). */
export function quoteCapMessage(cap: number): string {
  return `You've reached the Free plan limit of ${cap} quotes this month. Upgrade to Starter for unlimited quotes.`;
}

// --- shared trust + upgrade copy (used by the dual-mode components) ----------

/** The trust line that closes EVERY Claude result block. Non-negotiable copy —
 *  keep it identical everywhere so the promise reads the same on all 15 screens. */
export const DRAFTED_BY_CLAUDE_TRUST =
  "✦ Drafted by Claude · review before sending. You send it, not the AI.";

/** Short label for the ✦ action that opens Claude assist on any screen. */
export const WITH_CLAUDE_LABEL = "Draft with Claude";

/** Upgrade nudge shown to Free (and post-trial Starter) shops in place of the
 *  Claude controls. Kept honest: it says what Claude does, never oversells. */
export const CLAUDE_UPGRADE_COPY =
  "Let Claude draft this for you — pre-filled and ready for your review. Included on Growth and Scale.";

/** Copy shown to a Starter shop once its 7-day Claude trial has ended. */
export const CLAUDE_TRIAL_ENDED_COPY =
  "Your 7-day Claude trial has ended. Upgrade to Growth to keep drafting with Claude.";

/** Copy shown when the plan grants Claude but the merchant has toggled it off.
 *  No upgrade nudge — they already have it; they just switched it off and can
 *  switch it back on in Settings. */
export const CLAUDE_OFF_COPY =
  "Claude drafting is turned off for this store. Turn it back on in Settings whenever you want Claude to pre-fill your drafts.";

/** User-facing message when a Claude draft call fails (missing key, timeout, 429,
 *  5xx). Every ✦ action catches its draft() call and returns this so a model-side
 *  failure degrades to a plain banner — never a 500 / "Something went wrong". */
export const CLAUDE_UNAVAILABLE_COPY =
  "Claude is unavailable right now — please try again in a moment. You can still write this yourself.";
