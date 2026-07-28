import { describe, it, expect } from "vitest";
import {
  resolveCatalogId,
  buildVisibility,
  isVisible,
  filterVisible,
  type AssignmentLite,
  type CatalogItemLite,
} from "./catalog-visibility";

const ctx = { memberId: "m1", companyId: "c1", groupTags: ["vip", "west"] };

describe("resolveCatalogId (member > company > group > default)", () => {
  it("prefers a member override above all", () => {
    const a: AssignmentLite[] = [
      { catalogId: "cat-member", companyId: null, customerGroupTag: null, memberId: "m1" },
      { catalogId: "cat-company", companyId: "c1", customerGroupTag: null, memberId: null },
      { catalogId: "cat-group", companyId: null, customerGroupTag: "vip", memberId: null },
    ];
    expect(resolveCatalogId(a, ctx, "cat-default")).toBe("cat-member");
  });

  it("falls to company, then group, then default", () => {
    expect(
      resolveCatalogId([{ catalogId: "cat-company", companyId: "c1", customerGroupTag: null, memberId: null }], ctx, "d"),
    ).toBe("cat-company");
    expect(
      resolveCatalogId([{ catalogId: "cat-group", companyId: null, customerGroupTag: "west", memberId: null }], ctx, "d"),
    ).toBe("cat-group");
    expect(resolveCatalogId([], ctx, "cat-default")).toBe("cat-default");
    expect(resolveCatalogId([], ctx, null)).toBeNull();
  });

  it("ignores a group tag the buyer doesn't carry", () => {
    expect(
      resolveCatalogId([{ catalogId: "cat-group", companyId: null, customerGroupTag: "east", memberId: null }], ctx, null),
    ).toBeNull();
  });
});

describe("buildVisibility + isVisible (deny-by-default)", () => {
  const items: CatalogItemLite[] = [
    { productId: "p1", variantId: "v1", hidden: false }, // allow specific variant
    { productId: "p2", variantId: null, hidden: false }, // allow whole product
    { productId: "p3", variantId: "v9", hidden: true }, // hidden variant inside an ALL catalog
  ];

  it("ASSIGNED catalog hides everything not explicitly allowed", () => {
    const v = buildVisibility({ id: "c", visibility: "ASSIGNED" }, items);
    expect(isVisible(v, { productId: "p1", variantId: "v1" })).toBe(true);
    expect(isVisible(v, { productId: "p1", variantId: "v2" })).toBe(false); // sibling variant not listed
    expect(isVisible(v, { productId: "p2", variantId: "anything" })).toBe(true); // whole-product allow
    expect(isVisible(v, { productId: "pX", variantId: "vX" })).toBe(false); // unknown → denied
  });

  it("ALL catalog shows everything except explicit blocks", () => {
    const v = buildVisibility({ id: "c", visibility: "ALL" }, items);
    expect(isVisible(v, { productId: "pX", variantId: "vX" })).toBe(true);
    expect(isVisible(v, { productId: "p3", variantId: "v9" })).toBe(false); // blocked variant
    expect(isVisible(v, { productId: "p3", variantId: "v8" })).toBe(true); // sibling still visible
  });

  it("a block wins even over an allow in ASSIGNED mode", () => {
    const v = buildVisibility({ id: "c", visibility: "ASSIGNED" }, [
      { productId: "p2", variantId: null, hidden: false },
      { productId: "p2", variantId: "v-secret", hidden: true },
    ]);
    expect(isVisible(v, { productId: "p2", variantId: "v-ok" })).toBe(true);
    expect(isVisible(v, { productId: "p2", variantId: "v-secret" })).toBe(false);
  });

  it("no catalog resolved → open (everything visible)", () => {
    const v = buildVisibility(null, []);
    expect(isVisible(v, { productId: "any", variantId: "any" })).toBe(true);
  });
});

describe("filterVisible", () => {
  const rows = [
    { productId: "p1", variantId: "v1", title: "A" },
    { productId: "p1", variantId: "v2", title: "B" },
    { productId: "p2", variantId: "v3", title: "C" },
  ];

  it("drops hidden rows in ASSIGNED mode (never greys — removes)", () => {
    const v = buildVisibility({ id: "c", visibility: "ASSIGNED" }, [
      { productId: "p1", variantId: "v1", hidden: false },
    ]);
    expect(filterVisible(rows, v).map((r) => r.title)).toEqual(["A"]);
  });

  it("open mode returns everything untouched", () => {
    const v = buildVisibility(null, []);
    expect(filterVisible(rows, v)).toHaveLength(3);
  });
});
