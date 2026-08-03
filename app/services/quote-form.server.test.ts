import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import prisma from "../db.server";
import { listForms, getForm, saveForm, getPublicForm, deleteForm, getQuoteCaptureConfig, MultipleFormsError } from "./quote-form.server";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("quote-form.server (DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "QuoteForm","Event","Shop" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const starter = () => prisma.shop.create({ data: { shopifyDomain: "qf.myshopify.com", plan: "STARTER" } });
  const growth = () => prisma.shop.create({ data: { shopifyDomain: "qf.myshopify.com", plan: "GROWTH" } });
  const basicFields = [
    { type: "text", label: "Company", required: true },
    { type: "email", label: "Email", required: true },
    { type: "dropdown", label: "Size", options: "S,M,L" },
  ];

  it("creates + normalises a form and lists it", async () => {
    await starter();
    const res = await saveForm("qf.myshopify.com", { name: "PDP form", surface: "PRODUCT", fields: [...basicFields, { type: "bogus", label: "x" }] });
    expect(res).toHaveProperty("id");
    const forms = await listForms("qf.myshopify.com");
    expect(forms).toHaveLength(1);
    expect(forms[0].fields).toHaveLength(3); // bogus dropped
    expect(forms[0].fields[2].options).toEqual(["S", "M", "L"]);
  });

  it("caps a below-Growth shop to a single form", async () => {
    await starter();
    await saveForm("qf.myshopify.com", { name: "one", surface: "PRODUCT", fields: basicFields });
    await expect(saveForm("qf.myshopify.com", { name: "two", surface: "CART", fields: basicFields })).rejects.toBeInstanceOf(MultipleFormsError);
  });

  it("lets Growth keep multiple forms per surface", async () => {
    await growth();
    await saveForm("qf.myshopify.com", { name: "pdp", surface: "PRODUCT", fields: basicFields });
    await saveForm("qf.myshopify.com", { name: "cart", surface: "CART", fields: basicFields });
    expect(await listForms("qf.myshopify.com")).toHaveLength(2);
  });

  it("getPublicForm returns only the active form for a surface", async () => {
    await growth();
    const a = await saveForm("qf.myshopify.com", { name: "pdp", surface: "PRODUCT", fields: basicFields });
    await getForm("qf.myshopify.com", (a as { id: string }).id); // sanity
    const pub = await getPublicForm("qf.myshopify.com", "PRODUCT");
    expect(pub?.fields).toHaveLength(3);
    expect(await getPublicForm("qf.myshopify.com", "CART")).toBeNull(); // none for CART

    // Deactivate → no public form.
    await saveForm("qf.myshopify.com", { id: (a as { id: string }).id, name: "pdp", surface: "PRODUCT", fields: basicFields, active: false });
    expect(await getPublicForm("qf.myshopify.com", "PRODUCT")).toBeNull();
  });

  it("deletes a form", async () => {
    await growth();
    const r = await saveForm("qf.myshopify.com", { name: "x", surface: "PRODUCT", fields: basicFields });
    await deleteForm("qf.myshopify.com", (r as { id: string }).id);
    expect(await listForms("qf.myshopify.com")).toHaveLength(0);
  });

  const advancedFields = [
    { type: "dropdown", label: "Reason", options: "Bulk,Sample" },
    { type: "text", label: "Bulk qty", required: true, showIf: { field: "reason", equals: "Bulk" } },
  ];

  it("Growth persists conditional logic + a success message; getPublicForm returns them", async () => {
    await growth();
    const r = await saveForm("qf.myshopify.com", { name: "adv", surface: "PRODUCT", fields: advancedFields, successMessage: "  We'll be in touch  " });
    const full = await getForm("qf.myshopify.com", (r as { id: string }).id);
    expect(full?.fields[1].showIf).toEqual({ field: "reason", equals: "Bulk" });
    expect(full?.successMessage).toBe("We'll be in touch");
    const pub = await getPublicForm("qf.myshopify.com", "PRODUCT");
    expect(pub?.fields[1].showIf).toEqual({ field: "reason", equals: "Bulk" });
    expect(pub?.successMessage).toBe("We'll be in touch");
  });

  it("below Growth, conditional logic + success message are stripped server-side", async () => {
    await starter();
    const r = await saveForm("qf.myshopify.com", { name: "adv", surface: "PRODUCT", fields: advancedFields, successMessage: "custom" });
    const full = await getForm("qf.myshopify.com", (r as { id: string }).id);
    expect(full?.fields[1].showIf).toBeUndefined(); // stripped
    expect(full?.successMessage).toBeNull(); // stripped
  });

  it("getQuoteCaptureConfig: on for paid + flag, off otherwise (F24.3)", async () => {
    await starter();
    vi.stubEnv("MANNON_FF_QUOTE_CAPTURE", "true");
    expect(await getQuoteCaptureConfig("qf.myshopify.com")).toEqual({ enabled: true });
    vi.stubEnv("MANNON_FF_QUOTE_CAPTURE", "false");
    expect(await getQuoteCaptureConfig("qf.myshopify.com")).toEqual({ enabled: false });
    vi.unstubAllEnvs();
  });
});
