import { describe, it, expect, vi } from "vitest";
import { draft, appendAiEvent, type ClaudeInvoke } from "./claude.server";
import { CLAUDE_MODEL } from "../config/plans";

// A fake AiEvent-only Prisma client that records inserts.
function fakeClient() {
  const rows: any[] = [];
  return {
    rows,
    aiEvent: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `ai_${rows.length}`, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
    },
  };
}

const okInvoke: ClaudeInvoke = async () => ({
  output: { draft: "Hi there — following up on your quote." },
  tokensIn: 120,
  tokensOut: 30,
});

describe("draft()", () => {
  it("runs a registered feature and returns the tool output", async () => {
    const client = fakeClient();
    const result = await draft({
      feature: "draft_text",
      input: { task: "a follow-up note", context: ["Quote #12 stalled 4 days"] },
      shopId: "shop_1",
      invoke: okInvoke,
      client,
    });
    expect(result.output.draft).toContain("following up");
    expect(result.model).toBe(CLAUDE_MODEL);
    expect(result.tokensIn).toBe(120);
    expect(result.tokensOut).toBe(30);
  });

  it("records an append-only AiEvent with the feature + token usage", async () => {
    const client = fakeClient();
    await draft({
      feature: "draft_text",
      input: { task: "a note" },
      shopId: "shop_42",
      invoke: okInvoke,
      client,
    });
    expect(client.rows).toHaveLength(1);
    expect(client.rows[0]).toMatchObject({
      shopId: "shop_42",
      feature: "draft_text",
      mode: "claude",
      tokensIn: 120,
      tokensOut: 30,
    });
  });

  it("passes the feature's built user prompt into the model call", async () => {
    const client = fakeClient();
    const spy = vi.fn(okInvoke);
    await draft({
      feature: "draft_text",
      input: { task: "reorder reminder", context: ["ACME reorders every 30 days"] },
      shopId: "shop_1",
      invoke: spy,
      client,
    });
    const args = spy.mock.calls[0][0];
    expect(args.user).toContain("reorder reminder");
    expect(args.user).toContain("ACME reorders every 30 days");
    expect(args.tool.name).toBe("return_draft");
  });

  it("throws on an unknown feature", async () => {
    await expect(
      draft({ feature: "nope", input: {}, shopId: "s", invoke: okInvoke, client: fakeClient() }),
    ).rejects.toThrow(/Unknown Claude feature/);
  });

  it("still returns the draft if the AiEvent insert fails (analytics never blocks)", async () => {
    const client = {
      aiEvent: { create: vi.fn(async () => { throw new Error("db down"); }) },
    };
    const result = await draft({
      feature: "draft_text",
      input: { task: "a note" },
      shopId: "shop_1",
      invoke: okInvoke,
      client,
    });
    expect(result.output.draft).toBeTruthy();
  });
});

describe("appendAiEvent", () => {
  it("inserts a claude-mode row by default", async () => {
    const client = fakeClient();
    await appendAiEvent({ shopId: "s", feature: "f", tokensIn: 1, tokensOut: 2 }, client);
    expect(client.rows[0]).toMatchObject({ shopId: "s", feature: "f", mode: "claude", tokensIn: 1, tokensOut: 2 });
  });
});
