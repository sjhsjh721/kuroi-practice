import { test, expect, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

async function zoom(page: Page, kind: string) {
  const viewport = page.locator(`#${kind}-paper`);
  const b = (await viewport.boundingBox())!;
  if (page.context().browser()!.browserType().name() === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const points = (spread: number) => [
      { x: b.x + b.width / 2 - spread, y: b.y + b.height / 2, id: 1 },
      { x: b.x + b.width / 2 + spread, y: b.y + b.height / 2, id: 2 },
    ];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(10),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(60),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    // Playwright mobile WebKit cannot send a native wheel/pinch gesture.
    // Exercise the shared zoom/redraw handler with a DOM wheel event.
    await viewport.dispatchEvent("wheel", { deltaY: -1000 });
  }
  const detail = viewport.locator(".paper-detail");
  await expect(detail).toBeAttached();
  const metrics = await detail.evaluate((canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const base = canvas.parentElement!.querySelector("canvas")!;
    const baseRect = base.getBoundingClientRect();
    const context = canvas.getContext("2d")!;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 160 && pixels[i + 1] < 160 && pixels[i + 2] < 160) ink++;
    return {
      width: canvas.width,
      height: canvas.height,
      density: canvas.width / rect.width,
      oldDensity: base.width / baseRect.width,
      dpr: devicePixelRatio,
      ink,
    };
  });
  // Real PDF glyph pixels at screen density, rather than a CSS-enlarged bitmap.
  expect(metrics.density).toBeGreaterThanOrEqual(
    Math.min(metrics.dpr, 2) * 0.97,
  );
  expect(metrics.density / metrics.oldDensity).toBeGreaterThan(4);
  expect(metrics.width * metrics.height).toBeLessThan(8_010_000);
  expect(metrics.ink).toBeGreaterThan(500);
  await detail.evaluate((c) => c.setAttribute("data-before-pan", "true"));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 50, b.y + b.height / 2 + 70, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(viewport.locator("[data-before-pan]")).toHaveCount(0);
  await expect(detail).toBeAttached();
  return metrics;
}

test("sharp script and score zoom, pan, offline redraw and page changes", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./?verification");
  await page
    .getByRole("button", {
      name: "선관 선관귀신 · 무당 · 아저씨(배수환) · 사이토 백작",
    })
    .click();
  await page.waitForFunction(
    () => !!navigator.serviceWorker.controller && !!(window as any).kuroiAudit,
  );
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await page.getByRole("button", { name: "대본 보기", exact: true }).click();
  await page.locator('[data-action="script-page"]').click();
  await page.getByRole("spinbutton", { name: "이동할 페이지" }).fill("3");
  await page.getByRole("button", { name: "이동", exact: true }).click();
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "script.pdf:2",
  );
  // No library pack is downloaded: online reading and playback remain usable.
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.state.download.active),
  ).toBe(false);
  const script = await zoom(page, "script");
  await page.screenshot({
    path: `../artifacts/pwa-zoom-script-${info.project.name}.png`,
  });
  await page
    .getByRole("button", { name: "대본 화면 맞춤", exact: true })
    .click();
  await expect(page.locator("#script-paper .paper-detail")).toHaveCount(0);
  await page
    .getByRole("button", { name: "대본 다음 페이지", exact: true })
    .click();
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "script.pdf:3",
  );
  await page.evaluate(async () =>
    (window as any).kuroiAudit.offline.fetchFile("script.pdf"),
  );
  await context.setOffline(true);
  const offline = await zoom(page, "script");
  // A page transition drops stale detail, and the next page redraws offline.
  await page
    .getByRole("button", { name: "대본 다음 페이지", exact: true })
    .click();
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "script.pdf:4",
  );
  await expect(page.locator("#script-paper .paper-detail")).toHaveCount(0);
  await zoom(page, "script");
  await context.setOffline(false);
  await page.getByRole("button", { name: "악보 보기", exact: true }).click();
  await expect(page.locator("#score-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "score_1.pdf:0",
  );
  const score = await zoom(page, "score");
  // Highlights remain above the detail canvas and keep page-relative geometry.
  await expect(page.locator("#score-paper .marks i").first()).toBeVisible();
  expect(
    await page
      .locator("#score-paper .marks")
      .evaluate((e) =>
        e.previousElementSibling?.classList.contains("paper-detail"),
      ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "악보 다음 페이지", exact: true })
    .click();
  await expect(page.locator("#score-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "score_1.pdf:1",
  );
  await expect(page.locator("#score-paper .paper-detail")).toHaveCount(0);
  expect(errors).toEqual([]);
  writeFileSync(
    `../artifacts/pwa-zoom-${info.project.name}.json`,
    JSON.stringify({ status: "PASS", script, offline, score, errors }, null, 2),
  );
});
