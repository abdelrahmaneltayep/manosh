import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { anthropic } from "@ai-sdk/anthropic";

/*
 * e2e — the LIVE suite: agent-driven flows against the deployed app and its
 * public demo (tests/live/*.e2e.ts). These steps call a model, so they need
 * ANTHROPIC_API_KEY in the shell (never commit it) and network access to the
 * app. Nothing is charged on the demo store: accepting a quote creates a draft
 * order, and visitor buyers are swept after seven days.
 *
 *   E2E_LIVE_URL=https://manosh.fly.dev npm run test:e2e:live
 *
 * The demo rate limit is five starts per IP per hour, so keep the live suite
 * to one buyer session per run (the serial group in demo-buyer.e2e.ts).
 */
try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the shell environment
}

export default {
  tests: ["tests/live/**/*.e2e.ts"],
  timeout: 180_000,
  workers: 1,
  targets: [
    {
      name: "live",
      engine: web(),
      app: {
        url: process.env.E2E_LIVE_URL ?? "https://manosh.fly.dev",
        environment: "production",
      },
    },
  ],
  agents: {
    default: {
      // Same family the product uses; cheap and fast for click-through QA.
      model: anthropic("claude-haiku-4-5"),
      system:
        "You are a careful QA agent testing a B2B wholesale buyer portal. Use the exact words on screen. " +
        "Never invent data. Confirm every outcome on screen before finishing a goal.",
      context:
        "Mannon is a Shopify app. The public demo at /demo opens a buyer portal as a sample buyer. " +
        "A quote moves through New, Countered, Accepted and Ordered. 'Accept & create order' turns a quote into a Shopify draft order. " +
        "'Reorder a past order' lists reorder cards (order number · date · total) with a Reorder link.",
    },
  },
} satisfies E2EConfig;
