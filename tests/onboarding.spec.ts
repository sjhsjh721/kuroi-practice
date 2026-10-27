import { test, expect } from "@playwright/test";

test("first-use download recommendation is optional and remembers later", async ({
  page,
}) => {
  await page.goto("./?verification");
  await page.getByRole("button", { name: "해웅 해웅 · 박해영" }).click();
  const suggestion = page.getByRole("complementary", {
    name: "오프라인 연습 준비",
  });
  await expect(suggestion).toContainText("내 배역 저장 권장");
  await expect(suggestion).toContainText("인터넷 없이 연습");
  await expect(suggestion).toContainText(/MB/);
  await page.waitForFunction(() => !!(window as any).kuroiAudit?.state.ready);
  expect(
    await page.evaluate(async () => {
      const a = (window as any).kuroiAudit;
      return (await a.offline.inventory(a.tracks.map((t: any) => t.path))).done;
    }),
  ).toBe(0);
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await expect(suggestion).toBeHidden();
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).kuroiAudit.state.position))
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => !!(window as any).kuroiAudit);
  await expect(suggestion).toBeHidden();
  await page
    .getByRole("button", { name: "자료 다운로드", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("내 배역 + 공통 음원");
});

test("recommended download starts only the actor and common pack", async ({
  page,
}, info) => {
  if (info.project.name !== "chromium-phone") test.skip();
  await page.goto("./?verification");
  await page.getByRole("button", { name: "해웅 해웅 · 박해영" }).click();
  await page
    .getByRole("button", { name: "추천 자료 다운로드", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("자료 다운로드");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).kuroiAudit.state.download.active),
    )
    .toBe(true);
  const plan = await page.evaluate(() => {
    const paths = JSON.parse(
      localStorage.getItem("kuroi-pwa-verification-download-plan")!,
    );
    const a = (window as any).kuroiAudit;
    return { paths, tracks: a.tracks, count: a.state.download.total };
  });
  expect(plan.paths.length).toBe(plan.count);
  expect(plan.count).toBeLessThan(173);
  for (const t of plan.tracks)
    expect(plan.paths.includes(t.path)).toBe(
      t.type === "MR" || t.type === "AR" || t.role === "해웅",
    );
  await page
    .getByRole("button", { name: "다운로드 일시정지", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).kuroiAudit.state.download.active),
    )
    .toBe(false);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator("#download-suggestion")).toBeHidden();
});
