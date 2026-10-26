import { test, expect } from "@playwright/test";
test("narrow phone, fold, tablet and rotated controls remain reachable", async ({
  page,
}, info) => {
  if (info.project.name !== "chromium-phone") test.skip();
  await page.goto("./?verification");
  await page
    .getByRole("button", {
      name: "선관 선관귀신 · 무당 · 아저씨(배수환) · 사이토 백작",
    })
    .click();
  await page.waitForFunction(() => !!(window as any).kuroiAudit);
  for (const [width, height] of [
    [320, 568],
    [360, 780],
    [390, 844],
    [844, 390],
    [752, 835],
    [835, 752],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    const clipped = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "#chrome button,#transport button",
        ),
      ]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.width > 0 &&
            (r.left < -0.5 ||
              r.right > innerWidth + 0.5 ||
              r.top < -0.5 ||
              r.bottom > innerHeight + 0.5)
          );
        })
        .map((e) => e.getAttribute("aria-label") || e.textContent),
    );
    expect(clipped, `${width}x${height}`).toEqual([]);
    await expect(page.locator("#transport")).toBeVisible();
  }
  await page.setViewportSize({ width: 752, height: 835 });
  await page.getByRole("button", { name: "양쪽 보기", exact: true }).click();
  await page.waitForTimeout(250);
  await expect(page.locator(".sidebar")).toBeVisible();
  const left = await page.locator(".score-document").boundingBox(),
    right = await page.locator(".script-document").boundingBox();
  expect(left!.x + left!.width).toBeLessThan(right!.x);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const top = await page.locator(".score-document").boundingBox(),
    bottom = await page.locator(".script-document").boundingBox();
  expect(top!.y + top!.height).toBeLessThan(bottom!.y);
  await page.screenshot({ path: "../artifacts/pwa-phone-paired.png" });
});
