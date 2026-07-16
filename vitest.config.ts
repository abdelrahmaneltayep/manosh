import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Unit/integration tests run in a plain Node environment. We deliberately do
// NOT load the Remix Vite plugin here — services, loaders, and the seed are
// imported directly, so tests stay fast and free of dev-server machinery.
//
// DB-backed tests share a single Postgres, so file parallelism is disabled to
// keep TRUNCATE-based fixtures deterministic. They self-skip when DATABASE_URL
// is unset (see describe.skipIf in the specs).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["app/**/*.test.{ts,tsx}", "prisma/**/*.test.{ts,tsx}"],
    fileParallelism: false,
  },
});
