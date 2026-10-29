import { test, expect, Page } from "@playwright/test";

async function playAndPause(page: Page, delay: number) {
  const toggle = page.locator('[data-action="toggle"]');
  const start = await page.evaluate(
    () => (window as any).kuroiAudit.audio.currentTime,
  );
  // A human mouse press lasts across multiple 50ms transport clock ticks.
  // Press the central SVG, rather than the button's empty padding.
  await toggle.click({ delay });
  await expect(toggle).toHaveAttribute("aria-label", "일시정지");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).kuroiAudit.audio.currentTime),
    )
    .toBeGreaterThan(start + 0.12);
  await toggle.click({ delay });
  await expect(toggle).toHaveAttribute("aria-label", "재생");
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.audio.paused),
  ).toBe(true);
}

test("held mouse clicks start and pause MR online and from verified offline downloads", async ({
  page,
  context,
}, info) => {
  await page.goto("./?verification");
  await page.getByRole("button", { name: "해웅 해웅 · 박해영" }).click();
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await page.waitForFunction(
    () =>
      (window as any).kuroiAudit?.state.ready &&
      !!navigator.serviceWorker.controller,
  );
  // Start on a controlled app-shell navigation, after first SW activation.
  await page.reload();
  await page.waitForFunction(() => (window as any).kuroiAudit?.state.ready);
  await playAndPause(page, 100);
  await playAndPause(page, 200);
  if (info.project.name === "comet-desktop") {
    const count = await page.evaluate(
      () => (window as any).kuroiAudit.catalog.songs.length,
    );
    for (let index = 1; index < count; index++) {
      await page
        .getByRole("button", { name: "다음 넘버", exact: true })
        .click();
      await page.waitForFunction(() => (window as any).kuroiAudit.state.ready);
      await playAndPause(page, 100);
    }
    await page.locator('[data-action="songs"]').click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "01 쿠로이", exact: true })
      .click();
    await page.waitForFunction(() => (window as any).kuroiAudit.state.ready);
  }
  await page.evaluate(async () => {
    const offline = (window as any).kuroiAudit.offline;
    for (const path of ["mr_1.mp3", "score_1.pdf", "script.pdf"])
      await offline.fetchFile(path);
    if (!(await offline.has("mr_1.mp3")))
      throw Error("MR download not verified");
  });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).kuroiAudit?.state.ready);
  await expect(page.locator("#score-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "score_1.pdf:0",
  );
  await playAndPause(page, 150);
  await page.locator("#seek").evaluate((input: HTMLInputElement) => {
    input.value = "45";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).kuroiAudit.audio.currentTime),
    )
    .toBeCloseTo(45, 0);
  await playAndPause(page, 200);
});
