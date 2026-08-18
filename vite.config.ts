import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * WHERE THIS APP IS SERVED FROM.
 *
 * Spatial is built and deployed in more than one place, and it must not know
 * or care which:
 *
 *   /                                   dev, and an independent deployment
 *   /personal-space/projects/spatial/app/   built into the portfolio site
 *
 * `BASE_PATH` is the only input, passed by whichever workflow is doing the
 * building. THAT IS THE ENTIRE INTEGRATION BOUNDARY — there is no other place
 * this app is aware of a host, no conditional for "am I embedded", and nothing
 * to unpick if it later moves to its own domain. Changing where it lives is
 * changing one environment variable in one workflow.
 *
 * The shape is deliberately identical to `personal-space/vite.config.ts`, so
 * the two builds are configured the same way and neither becomes the odd one.
 *
 * Unset it is "/", which is correct for dev, for a custom domain, and for a
 * user/organisation page.
 */
function resolveBase(): string {
  const raw = process.env.BASE_PATH?.trim();
  if (raw === undefined || raw === "" || raw === "/") return "/";
  return `/${raw.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react()],
  server: { port: 5174, strictPort: true },
});
