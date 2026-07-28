import { SW_CACHE_NAME, SW_PRECACHE } from "../lib/pwa";
import { PWA_ENABLED } from "../services/pwa.server";

/**
 * F18 — the buyer portal service worker (served at /portal/sw.js, scope /portal/).
 * Progressive enhancement: versioned cache (SW_CACHE_NAME) so a bump drops stale
 * caches; network-first for portal navigations with an offline fallback; caches
 * no PII beyond what the signed-in buyer already sees. Push is opt-in.
 */
const SW = `
const CACHE = ${JSON.stringify(SW_CACHE_NAME)};
const PRECACHE = ${JSON.stringify(SW_PRECACHE)};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !req.url.includes("/portal")) return;
  // Network-first so order history is fresh; fall back to cache when offline.
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match("/portal")))
  );
});

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  const title = data.title || "Time to reorder?";
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || "", icon: "/portal/icon.svg", badge: "/portal/icon.svg", data: { url: data.url || "/portal/shortcuts" }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/portal/shortcuts";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => {
    for (const c of cs) { if (c.url.includes("/portal") && "focus" in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
`;

export const loader = () => {
  if (!PWA_ENABLED()) throw new Response("Not found", { status: 404 });
  return new Response(SW, {
    headers: {
      "Content-Type": "text/javascript",
      "Service-Worker-Allowed": "/portal/",
      "Cache-Control": "no-cache",
    },
  });
};
