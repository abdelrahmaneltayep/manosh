import { describe, it, expect, beforeEach, afterAll } from "vitest";
import prisma from "../db.server";
import { appendEvent } from "./events.server";
import { shouldPromptReview, markReviewPromptShown } from "./review-prompt.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("review prompt (DB)", () => {
  let shopId: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE');
    const shop = await prisma.shop.create({
      data: { shopifyDomain: "review.myshopify.com" },
    });
    shopId = shop.id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("does not prompt before the first order", async () => {
    expect(await shouldPromptReview(shopId)).toBe(false);
  });

  it("prompts once the shop has created an order", async () => {
    await appendEvent({ shopId, type: "DRAFT_ORDER_CREATED", entityType: "Quote", entityId: "q1" });
    expect(await shouldPromptReview(shopId)).toBe(true);
  });

  it("records the prompt once, then never prompts again", async () => {
    await appendEvent({ shopId, type: "DRAFT_ORDER_CREATED", entityType: "Quote", entityId: "q1" });

    expect(await markReviewPromptShown(shopId)).toBe(true);
    expect(await prisma.event.count({ where: { shopId, type: "REVIEW_PROMPT_SHOWN" } })).toBe(1);

    // Second acknowledgement is a no-op (no double count, no re-nag).
    expect(await markReviewPromptShown(shopId)).toBe(false);
    expect(await prisma.event.count({ where: { shopId, type: "REVIEW_PROMPT_SHOWN" } })).toBe(1);
    expect(await shouldPromptReview(shopId)).toBe(false);
  });
});
