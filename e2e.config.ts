import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

/*
 * e2e (tester-army/e2e) — the LOCAL suite: deterministic browser + API checks
 * against a production build of Mannon served by remix-serve. No agent steps,
 * so no model and no key are needed. The runner starts and stops the server.
 *
 *   npm run test:e2e            # builds, then runs tests/*.e2e.ts
 *   npx e2e run tests/demo-tour.e2e.ts --headed
 *
 * Env comes from .env (loaded below; the runner itself loads none). The server
 * child only receives what `command.env` passes. See docs/testing.md.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // no .env: rely on the shell environment (CI)
}

const PORT = process.env.E2E_PORT ?? "3100";
const url = `http://127.0.0.1:${PORT}`;

export default {
  tests: ["tests/*.e2e.ts"],
  timeout: 60_000,
  targets: [
    {
      name: "local",
      engine: web(),
      app: {
        url,
        environment: "test",
        command: {
          executable: "node",
          args: ["node_modules/@remix-run/serve/dist/cli.js", "./build/server/index.js"],
          env: {
            NODE_ENV: "production",
            PORT,
            HOST: "127.0.0.1",
            DATABASE_URL: process.env.DATABASE_URL ?? "",
            SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ?? "",
            SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ?? "",
            SHOPIFY_APP_URL: url,
            SCOPES: process.env.SCOPES ?? "read_products,read_orders,write_draft_orders,read_companies,read_payment_terms,read_inventory,write_customers",
            SESSION_SECRET: process.env.SESSION_SECRET ?? "",
            MANNON_DEMO_SHOP: process.env.MANNON_DEMO_SHOP ?? "",
            MANNON_FF_QUOTE_WIDGET: "true",
            MANNON_FF_QUOTE_OPS: "true",
            MANNON_FF_I18N: "true",
          },
          startupTimeout: 90_000,
          log: ".e2e/logs/app.log",
        },
      },
    },
  ],
} satisfies E2EConfig;
