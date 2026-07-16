import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Session } from "@shopify/shopify-api";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "../db.server";

const hasDb = Boolean(process.env.DATABASE_URL);

// Proves OAuth sessions are DB-backed and therefore survive a process
// restart / redeploy (the "survives reinstall" acceptance): a session stored
// through one storage instance is readable through a fresh instance, because
// the state lives in Postgres, not in memory.
describe.skipIf(!hasDb)("PrismaSessionStorage persistence", () => {
  const storage = new PrismaSessionStorage(prisma);
  const sessionId = "offline_persistence-test.myshopify.com";

  const makeSession = () =>
    new Session({
      id: sessionId,
      shop: "persistence-test.myshopify.com",
      state: "state",
      isOnline: false,
      accessToken: "offline-token-abc",
      scope: "read_products,read_orders,write_draft_orders",
    });

  beforeAll(async () => {
    await prisma.session.deleteMany({ where: { id: sessionId } });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { id: sessionId } });
    await prisma.$disconnect();
  });

  it("stores and loads a session round-trip", async () => {
    expect(await storage.storeSession(makeSession())).toBe(true);

    const loaded = await storage.loadSession(sessionId);
    expect(loaded).toBeDefined();
    expect(loaded!.shop).toBe("persistence-test.myshopify.com");
    expect(loaded!.accessToken).toBe("offline-token-abc");
    expect(loaded!.isOnline).toBe(false);
  });

  it("a fresh storage instance still loads it (survives restart/reinstall)", async () => {
    const freshStorage = new PrismaSessionStorage(prisma);
    const loaded = await freshStorage.loadSession(sessionId);
    expect(loaded?.shop).toBe("persistence-test.myshopify.com");
  });

  it("deletes a session", async () => {
    expect(await storage.deleteSession(sessionId)).toBe(true);
    expect(await storage.loadSession(sessionId)).toBeUndefined();
  });
});
