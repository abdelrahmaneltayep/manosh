import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Unit tests run in a plain Node environment. We deliberately do NOT load the
// Remix Vite plugin here — services and route loaders under test are imported
// directly, so tests stay fast and free of dev-server machinery.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["app/**/*.test.{ts,tsx}"],
  },
});
