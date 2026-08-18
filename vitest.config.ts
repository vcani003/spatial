import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Separate from `vite.config.ts` because the app's build config carries a base
 * path and an SPA-fallback plugin, neither of which means anything to a test
 * run — and because `test` is Vitest's key, not Vite's.
 *
 * NO GLOBAL ENVIRONMENT IS SET, deliberately. `core` runs under Node with no
 * browser, which is the standing proof it is framework-free; the handful of
 * files that need a DOM opt in with a `@vitest-environment jsdom` docblock.
 * Flipping the default to jsdom would quietly remove that guarantee.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./src/test/setup.ts"],
  },
});
