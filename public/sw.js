/* Complete media files are cached by the download manager, never partial 206s. */
const BASE = new URL("./", self.location.href);
const at = (path) => new URL(path, BASE).pathname;
const scopeKey = BASE.pathname.replace(/\W/g, "_");
const SHELL_PREFIX = "kuroi-shell-" + scopeKey + "-";
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const r = await fetch(at("shell-manifest.json"), { cache: "no-store" });
      if (!r.ok) throw Error("shell manifest");
      const manifest = await r.json();
      const cache = await caches.open(SHELL_PREFIX + manifest.version);
      await cache.addAll(manifest.files);
      await cache.put(
        at("shell-manifest.json"),
        new Response(JSON.stringify(manifest), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      await self.skipWaiting();
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const keys = (await caches.keys()).filter((k) =>
        k.startsWith(SHELL_PREFIX),
      );
      for (const key of keys.slice(0, -1)) await caches.delete(key);
      await self.clients.claim();
    })(),
  ),
);
async function rangeResponse(request, response) {
  const range = request.headers.get("range");
  if (!range) return response;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]))
    return new Response(null, { status: 416 });
  const blob = await response.blob();
  let start = match[1]
    ? Number(match[1])
    : Math.max(0, blob.size - Number(match[2]));
  let end = match[1]
    ? match[2]
      ? Math.min(Number(match[2]), blob.size - 1)
      : blob.size - 1
    : blob.size - 1;
  if (start > end || start >= blob.size)
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${blob.size}` },
    });
  const headers = new Headers(response.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${blob.size}`);
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Accept-Ranges", "bytes");
  return new Response(blob.slice(start, end + 1, blob.type), {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
}
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET")
    return;
  event.respondWith(
    (async () => {
      if (url.pathname.startsWith(at("library/"))) {
        if (event.request.headers.get("X-Kuroi-Download") === "1")
          return fetch(event.request);
        const manifest = await caches.match(at("library-manifest.json"));
        if (manifest) {
          const m = await manifest.json();
          const cache = await caches.open(
            "kuroi-library-" + scopeKey + "-" + m.version,
          );
          const hit = await cache.match(url.pathname);
          if (hit) return rangeResponse(event.request, hit);
        }
        return fetch(event.request).catch(
          () => new Response("Offline", { status: 503 }),
        );
      }
      // Immutable app-shell files are identical for every Origin header. Module
      // scripts may send Origin while install-time addAll does not (Vite varies
      // on Origin); ignoring Vary prevents an offline cache miss in Chromium.
      const shell = await caches.match(event.request, {
        ignoreSearch: true,
        ignoreVary: true,
      });
      if (event.request.mode === "navigate") {
        try {
          return await fetch(event.request);
        } catch {
          return (await caches.match(at("index.html"))) || Response.error();
        }
      }
      return shell || fetch(event.request).catch(() => Response.error());
    })(),
  );
});
