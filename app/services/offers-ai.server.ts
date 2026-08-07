import prisma from "../db.server";
import { draft, type ClaudeInvoke } from "./claude.server";
import { computeFloorPrice, round4 } from "./ai/quote-assistant.server";
import { getOffer } from "./offers.server";

/**
 * F21 Make an Offer — DB orchestration for the Claude counter draft. Assembles
 * the offer context, derives the floor TOTAL from the margin-at-offer, calls the
 * generic draft() with the offer_counter feature, then applies the floor guard
 * in pure code (guardrail #4 — never trust the model on money). Returns a draft
 * that pre-fills the merchant's counter form; nothing is sent here.
 */

export interface OfferCounterDraft {
  counterTotal: number;
  note: string;
  /** Lowest counter that still clears the floor margin; null if cost unknown. */
  floorTotal: number | null;
  /** True when the model's counter breaches the floor (blocks one-click use). */
  belowFloor: boolean;
  /** True when the model's counter exceeds the list price (also blocks use). */
  aboveList: boolean;
}

/**
 * Floor total for a counter, derived from the margin observed at the buyer's
 * offer: cost = offered × (1 − marginAtOffer); floor = cost / (1 − minMargin).
 * Null when margin (hence cost) is unknown. Pure.
 */
export function deriveOfferFloor(
  offeredTotal: number,
  marginAtOffer: number | null,
  minMarginPct: number,
): number | null {
  const costTotal = marginAtOffer == null ? null : offeredTotal * (1 - marginAtOffer);
  return computeFloorPrice(costTotal, minMarginPct);
}

/** Combine the model's raw output with the floor/list guards. Pure — the
 *  guardrail boundary, so it's unit-tested. We keep the model's number and flag
 *  breaches rather than silently clamping, so the merchant sees + decides. */
export function finalizeOfferCounter(
  raw: { counter_total?: unknown; note?: unknown },
  ctx: { listPriceTotal: number; floorTotal: number | null },
): OfferCounterDraft {
  const n = Number(raw.counter_total);
  const counterTotal = round4(Math.max(0, Number.isFinite(n) ? n : 0));
  const note = typeof raw.note === "string" ? raw.note : "";
  const belowFloor = ctx.floorTotal != null && counterTotal < ctx.floorTotal;
  const aboveList = counterTotal > ctx.listPriceTotal;
  return { counterTotal, note, floorTotal: ctx.floorTotal, belowFloor, aboveList };
}

export interface DraftOfferOptions {
  invoke?: ClaudeInvoke;
  currencyCode?: string;
}

/** Draft a counter for one offer. Returns null when the offer/shop is missing. */
export async function draftOfferCounter(
  shopDomain: string,
  offerId: string,
  options: DraftOfferOptions = {},
): Promise<OfferCounterDraft | null> {
  const offer = await getOffer(shopDomain, offerId);
  if (!offer) return null;
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, minMarginPct: true },
  });
  if (!shop) return null;

  const listPriceTotal = Number(offer.listPriceTotal);
  const offeredTotal = Number(offer.offeredTotal);
  const marginAtOffer = offer.marginAtOffer == null ? null : Number(offer.marginAtOffer);
  const minMarginPct = shop.minMarginPct ?? 0.15;
  const floorTotal = deriveOfferFloor(offeredTotal, marginAtOffer, minMarginPct);

  const { output } = await draft({
    feature: "offer_counter",
    shopId: shop.id,
    input: {
      currencyCode: options.currencyCode ?? "USD",
      listPriceTotal,
      offeredTotal,
      marginAtOffer,
      floorTotal,
      minMarginPct,
    },
    invoke: options.invoke,
  });

  return finalizeOfferCounter(output, { listPriceTotal, floorTotal });
}
