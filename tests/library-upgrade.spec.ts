import { test, expect } from "@playwright/test";
test("reuse verified originals from an older cache and reject outdated mixes", async ({
  page,
  context,
}, info) => {
  if (info.project.name === "webkit-iphone") test.skip();
  await page.goto("./?verification");
  await page.getByRole("button", { name: "해웅 해웅 · 박해영" }).click();
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await page.waitForFunction(
    () => !!(window as any).kuroiAudit && !!navigator.serviceWorker.controller,
  );
  await page.evaluate(async () => {
    const a = (window as any).kuroiAudit,
      o = a.offline;
    const mr = await o.fetchFile("mr_1.mp3");
    const current = (await caches.keys()).find((k) => k.endsWith(o.version))!;
    const older = await caches.open(
      current.replace(o.version, "previous-release-test"),
    );
    await older.put(o.url("mr_1.mp3"), mr.clone());
    await o.cache.delete(o.url("mr_1.mp3"));
    const mix = a.tracks.find((t: any) => t.type === "MR+화음");
    await older.put(
      o.url(mix.path),
      new Response("old invalid mix", {
        headers: { "X-Kuroi-SHA256": "0".repeat(64) },
      }),
    );
    const legacy = await (
      await fetch(new URL("library-manifest.json", document.baseURI))
    ).json();
    const item = legacy.files.find((f: any) => f.path === mix.previousPath);
    const bytes = await (
      await fetch(o.url(mix.previousPath), {
        headers: { "X-Kuroi-Download": "1" },
      })
    ).arrayBuffer();
    const sha = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (sha !== item.sha256) throw Error("legacy fixture checksum");
    await older.put(
      o.url(mix.previousPath),
      new Response(bytes, {
        headers: { "X-Kuroi-SHA256": sha, "Content-Type": "audio/mp4" },
      }),
    );
    a.state.saved.mixReleaseSeen = false;
    const prefs = JSON.parse(localStorage.getItem("kuroi-pwa-verification")!);
    prefs.mixReleaseSeen = false;
    localStorage.setItem("kuroi-pwa-verification", JSON.stringify(prefs));
  });
  await page.reload();
  await page.waitForFunction(() => !!(window as any).kuroiAudit);
  await expect(page.locator("#download-suggestion")).toContainText(
    "MR·화음 보정 자료",
  );
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  const inventory = await page.evaluate(async () => {
    const a = (window as any).kuroiAudit,
      o = a.offline,
      mix = a.tracks.find((t: any) => t.type === "MR+화음");
    return {
      mr: await o.has("mr_1.mp3"),
      mix: await o.has(mix.path),
      path: mix.path,
      previousPath: mix.previousPath,
    };
  });
  expect(inventory.mr).toBe(true);
  expect(inventory.mix).toBe(false);
  await context.setOffline(true);
  const results = await page.evaluate(async ({ path, previousPath }) => {
    const o = (window as any).kuroiAudit.offline;
    const mr = await fetch(o.url("mr_1.mp3"), {
      headers: { Range: "bytes=100-199" },
    });
    const mix = await fetch(o.url(path));
    const older = await fetch(o.url(previousPath), {
      headers: { Range: "bytes=100-199" },
    });
    return {
      mrStatus: mr.status,
      bytes: (await mr.arrayBuffer()).byteLength,
      mixStatus: mix.status,
      oldStatus: older.status,
      oldBytes: (await older.arrayBuffer()).byteLength,
    };
  }, inventory);
  expect(results).toEqual({
    mrStatus: 206,
    bytes: 100,
    mixStatus: 503,
    oldStatus: 206,
    oldBytes: 100,
  });
  await page.evaluate(
    async (path) => (window as any).kuroiAudit.offline.remove([path]),
    inventory.path,
  );
  expect(
    await page.evaluate(
      async (path) => (window as any).kuroiAudit.offline.hasPrevious(path),
      inventory.previousPath,
    ),
  ).toBe(false);
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.state.saved.role),
  ).toBe("해웅");
});
