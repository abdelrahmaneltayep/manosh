import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import prisma from "../db.server";
import { appendEvent } from "./events.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("appendEvent (insert-only helper)", () => {
  let shopId: string;

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Event","Shop" RESTART IDENTITY CASCADE',
    );
    const shop = await prisma.shop.create({
      data: { shopifyDomain: "events-test.myshopify.com" },
    });
    shopId = shop.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("inserts an Event row and returns it", async () => {
    const before = await prisma.event.count();
    const event = await appendEvent({
      shopId,
      type: "QUOTE_SUBMITTED",
      entityType: "Quote",
      entityId: "gid://shopify/Quote/1",
      payload: { lineCount: 3 },
    });

    expect(event.id).toBeTruthy();
    expect(event.type).toBe("QUOTE_SUBMITTED");
    expect(await prisma.event.count()).toBe(before + 1);
  });

  it("accepts a transaction client so it can record atomically", async () => {
    const event = await prisma.$transaction((tx) =>
      appendEvent(
        { shopId, type: "REORDER_CREATED", entityType: "ReorderSource" },
        tx,
      ),
    );
    expect(event.type).toBe("REORDER_CREATED");
  });
});

// This guard runs without a DB. It enforces guardrail #6 statically: no
// update/delete/upsert path for the Event table exists anywhere in app/ source.
describe("Event append-only guardrail (static)", () => {
  const appDir = dirname(dirname(fileURLToPath(import.meta.url))); // app/
  const forbidden = /\.event\.(update|delete|upsert|updateMany|deleteMany)\b/;

  function collectSourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        out.push(...collectSourceFiles(full));
      } else if (
        /\.(ts|tsx)$/.test(entry) &&
        !/\.test\.(ts|tsx)$/.test(entry)
      ) {
        out.push(full);
      }
    }
    return out;
  }

  it("has no Event mutation other than create anywhere in app/", () => {
    const offenders = collectSourceFiles(appDir).filter((file) =>
      forbidden.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the events module exposes only appendEvent (no update/delete export)", async () => {
    const mod = await import("./events.server");
    const exported = Object.keys(mod);
    expect(exported).toContain("appendEvent");
    expect(
      exported.some((name) => /update|delete|remove|upsert/i.test(name)),
    ).toBe(false);
  });
});
