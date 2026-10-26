/* Complete media files are cached by the download manager, never partial 206s. */
const SHELL_PREFIX = "kuroi-shell-";
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const r = await fetch("/shell-manifest.json", { cache: "no-store" });
      if (!r.ok) throw Error("shell manifest");
      const manifest = await r.json();
      const cache = await caches.open(SHELL_PREFIX + manifest.version);
      await cache.addAll(manifest.files);
      await cache.put(
        "/shell-manifest.json",
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
      if (url.pathname.startsWith("/library/")) {
        if (event.request.headers.get("X-Kuroi-Download") === "1")
          return fetch(event.request);
        const manifest = await caches.match("/library-manifest.json");
        if (manifest) {
          const m = await manifest.json();
          const cache = await caches.open("kuroi-library-" + m.version);
          const hit = await cache.match(url.pathname);
          if (hit) return rangeResponse(event.request, hit);
        }
        return fetch(event.request);
      }
      const shell = await caches.match(event.request, { ignoreSearch: true });
      if (event.request.mode === "navigate") {
        try {
          return await fetch(event.request);
        } catch {
          return (await caches.match("/index.html")) || Response.error();
        }
      }
      return shell || fetch(event.request);
    })(),
  );
});
