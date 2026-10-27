import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: {
      // Loopback only by default. To test from other devices on the network (e.g. live sessions
      // on a phone), opt in with VITE_HOST=0.0.0.0 (or a specific interface address).
      // 127.0.0.1 rather than "localhost", which may resolve to ::1 only (Playwright uses 127.0.0.1).
      host: env.VITE_HOST?.trim() || "127.0.0.1",
      port: 5173,
      watch: {
        ignored: ["**/playwright-report/**", "**/test-results/**"],
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      VitePWA({
        registerType: "autoUpdate",
        workbox: {
          // Cache the app shell (html, js, css, static assets)
          globPatterns: ["**/*.{js,css,html,ico,png,svg,json}"],
          // Explicitly exclude any Google API endpoints from runtime caching (Principle VII, T028)
          navigateFallbackDenylist: [/^\/api/, /^https:\/\/(www|sheets)\.googleapis\.com/],
          runtimeCaching: [
            {
              // Do not cache any Google API calls
              urlPattern: /^https:\/\/(www|sheets)\.googleapis\.com/,
              handler: "NetworkOnly",
            },
          ],
        },
        manifest: {
          name: "Decisionator",
          short_name: "Decisionator",
          description: "Collaborative Decision Engine",
          theme_color: "#18181b",
          background_color: "#09090b",
          display: "standalone",
          start_url: "./#/",
          icons: [
            {
              src: "icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
          ],
        },
      }),
    ],
    base: (() => {
      const raw = env.VITE_BASE_URL || "/decisionator/";
      if (raw.includes("decisionator")) {
        return "/decisionator/";
      }
      return raw.startsWith("/") ? raw : `/${raw}`;
    })(),
  };
});
