import { describe, it, expect } from "vitest";
import { portalErrorContent, acceptFailureMessage, graphqlErrorMessages, draftOrderFailureMessage } from "./portal-error";

describe("portalErrorContent", () => {
  it("gives a 'not found' message for 404", () => {
    const { title, body } = portalErrorContent(404);
    expect(title).toMatch(/couldn’t find/i);
    expect(body).toMatch(/out of date|no longer available/i);
  });

  it("gives a re-sign-in message for 401 and 403", () => {
    for (const status of [401, 403]) {
      const { title } = portalErrorContent(status);
      expect(title).toMatch(/sign in again/i);
    }
  });

  it("falls back to a generic message for unexpected errors (null status)", () => {
    const { title, body } = portalErrorContent(null);
    expect(title).toBe("Something went wrong");
    expect(body).toMatch(/refresh/i);
  });

  it("uses the generic message for other statuses (e.g. 500)", () => {
    expect(portalErrorContent(500).title).toBe("Something went wrong");
  });

  it("never returns an empty title or body", () => {
    for (const status of [404, 401, 403, 500, null]) {
      const content = portalErrorContent(status);
      expect(content.title.length).toBeGreaterThan(0);
      expect(content.body.length).toBeGreaterThan(0);
    }
  });
});

// Live QA (docs/qa/2026-11-01-live-admin.md) found the accept catch-all hid
// every cause behind one retry line. The message now names a Shopify GraphQL
// error so the buyer can tell the supplier what happened.
describe("acceptFailureMessage (pure)", () => {
  it("names a Shopify GraphQL error without echoing internals", () => {
    const err = Object.assign(new Error("GraphQL Client: Access denied"), {
      body: { errors: [{ message: "Access denied for draftOrderCreate field. Required access: `write_draft_orders`" }] },
    });
    const msg = acceptFailureMessage(err);
    expect(msg).toContain("Shopify couldn’t create the order: Access denied for draftOrderCreate field");
    expect(msg).toContain("contact your supplier");
    expect(msg).not.toMatch(/at .* \(/);
  });

  it("reads the Admin client's nested graphQLErrors (the live demo failure's shape)", () => {
    const err = Object.assign(new Error("GraphQL Client: An error occurred while fetching from the API."), {
      body: {
        errors: {
          networkStatusCode: 200,
          message: "GraphQL Client: An error occurred while fetching from the API. Review 'graphQLErrors' for details.",
          graphQLErrors: [{ message: "Variable $input of type DraftOrderInput! was provided invalid value" }],
        },
      },
    });
    expect(graphqlErrorMessages(err)).toEqual(["Variable $input of type DraftOrderInput! was provided invalid value"]);
    expect(acceptFailureMessage(err)).toContain("Shopify couldn’t create the order: Variable $input");
  });

  it("turns Shopify's protected-customer-data denial into plain language (no docs link)", () => {
    const err = { body: { errors: { graphQLErrors: [{ message: "ACCESS_DENIED: This app is not approved to access the CalculatedDraftOrder object. See https://shopify.dev/docs/apps/launch/protected-customer-data for more details." }] } } };
    const msg = acceptFailureMessage(err);
    expect(msg).toMatch(/hasn’t finished approving this app/);
    expect(msg).not.toMatch(/shopify\.dev|ACCESS_DENIED|CalculatedDraftOrder/);
  });

  it("explains an expired or missing store session", () => {
    expect(acceptFailureMessage(new Error("Could not find an offline session for shop"))).toContain("store connection needs a refresh");
  });

  it("falls back to the generic retry line", () => {
    expect(acceptFailureMessage(new TypeError("x is not a function"))).toBe("We couldn’t create your order just now. Please try again.");
    expect(acceptFailureMessage(null)).toBe("We couldn’t create your order just now. Please try again.");
  });
});

describe("graphqlErrorMessages (pure)", () => {
  it("is empty for anything that is not a GraphQL error", () => {
    expect(graphqlErrorMessages(new Error("boom"))).toEqual([]);
    expect(graphqlErrorMessages(null)).toEqual([]);
    expect(graphqlErrorMessages({ body: { errors: { message: "x" } } })).toEqual([]);
  });
});

// Live QA TC6: the buyer saw "draftOrderCalculate failed: An issue date is
// required with net payment terms." — Shopify's reason is useful, the
// operation name is not.
describe("draftOrderFailureMessage (pure)", () => {
  it("drops the operation prefix and keeps Shopify's reason", () => {
    expect(draftOrderFailureMessage("draftOrderCalculate failed: An issue date is required with net payment terms.")).toBe(
      "Shopify couldn’t create the order: An issue date is required with net payment terms. Please contact your supplier.",
    );
  });
  it("falls back to the retry line when there is no reason", () => {
    expect(draftOrderFailureMessage("draftOrderCreate returned no draft order")).toBe("We couldn’t create your order just now. Please try again.");
  });
  it("leaves plain-language messages alone", () => {
    const plain = "This buyer isn’t linked to a company location yet, so an order can’t be created.";
    expect(draftOrderFailureMessage(plain)).toBe(plain);
  });
});
