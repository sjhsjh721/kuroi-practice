import { test, expect } from "@playwright/test";
test("repeat survives the native end of a recording", async ({
  page,
}, info) => {
  if (info.project.name !== "webkit-ipad") test.skip();
  await page.goto("./?verification");
  await page
    .getByRole("button", {
      name: "선관 선관귀신 · 무당 · 아저씨(배수환) · 사이토 백작",
    })
    .click();
  await page.waitForFunction(() => !!(window as any).kuroiAudit?.state.ready);
  async function seek(t: number) {
    await page.locator("#seek").evaluate((e: HTMLInputElement, value) => {
      e.value = String(value);
      e.dispatchEvent(new Event("change", { bubbles: true }));
    }, t);
  }
  const duration = await page.evaluate(
    () => (window as any).kuroiAudit.state.duration,
  );
  await seek(duration - 1);
  await page.getByRole("button", { name: "구간 반복", exact: true }).click();
  await page.getByRole("button", { name: /시작 지정/ }).click();
  await seek(duration - 0.01);
  await page.getByRole("button", { name: "구간 반복", exact: true }).click();
  await page.getByRole("button", { name: /끝 지정/ }).click();
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.audio.paused),
  ).toBe(true);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForTimeout(1500);
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.audio.paused),
  ).toBe(false);
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.audio.currentTime),
  ).toBeLessThan(duration - 0.01);
});
