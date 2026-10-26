import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
test("all 241 PDF pages and score role overlays", async ({ page }, info) => {
  if (info.project.name !== "webkit-ipad") test.skip();
  test.setTimeout(300000);
  await page.goto("/?verification");
  await page
    .getByRole("button", {
      name: "선관 선관귀신 · 무당 · 아저씨(배수환) · 사이토 백작",
    })
    .click();
  await page.waitForFunction(() => !!(window as any).kuroiAudit);
  const songs = await page.evaluate(
    () => (window as any).kuroiAudit.catalog.songs,
  );
  let rendered = 0,
    marks = 0;
  for (let i = 0; i < songs.length; i++) {
    if (i)
      await page
        .getByRole("button", { name: "다음 넘버", exact: true })
        .click();
    for (let p = 0; p < songs[i].pages; p++) {
      if (p)
        await page
          .getByRole("button", { name: "악보 다음 페이지", exact: true })
          .click();
      await expect(page.locator("#score-paper .paper-sheet")).toHaveAttribute(
        "data-rendered",
        songs[i].score + ":" + p,
      );
      const count = await page.evaluate(() => {
        const a = (window as any).kuroiAudit,
          s = a.state;
        const expected = (
          a.highlights.documents[songsafe(s.track.number)]?.[s.scorePage] || []
        ).filter((m: any) => m.roles & 4).length;
        return {
          expected,
          actual: document.querySelectorAll("#score-paper .marks i").length,
        };
        function songsafe(n: number) {
          return a.catalog.songs.find((x: any) => x.number === n).score;
        }
      });
      expect(count.actual).toBe(count.expected);
      marks += count.actual;
      rendered++;
    }
  }
  await page.getByRole("button", { name: "대본 보기", exact: true }).click();
  await page.locator('[data-action="script-page"]').click();
  await page.getByRole("spinbutton", { name: "이동할 페이지" }).fill("1");
  await page.getByRole("button", { name: "이동", exact: true }).click();
  for (let p = 0; p < 79; p++) {
    if (p)
      await page
        .getByRole("button", { name: "대본 다음 페이지", exact: true })
        .click();
    await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
      "data-rendered",
      "script.pdf:" + p,
    );
    rendered++;
  }
  expect(rendered).toBe(241);
  writeFileSync(
    "../artifacts/pwa-pdf-webkit.json",
    JSON.stringify(
      { status: "PASS", renderedPDFPages: rendered, scoreMarkerRegions: marks },
      null,
      2,
    ),
  );
});
test("download pause/resume, role pack and backup import/export", async ({
  page,
}, info) => {
  if (info.project.name !== "chromium-phone") test.skip();
  await page.goto("/?verification");
  await page.getByRole("button", { name: "해웅 해웅 · 박해영" }).click();
  await page.waitForFunction(() => !!(window as any).kuroiAudit);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page
    .getByRole("button", { name: "자료 다운로드", exact: true })
    .click();
  await page.locator('[data-pack="role"]').click();
  await page
    .getByRole("button", { name: "다운로드 일시정지", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).kuroiAudit.state.download.active),
    )
    .toBe(false);
  const partial = await page.evaluate(
    () => (window as any).kuroiAudit.state.download.done,
  );
  expect(partial).toBeLessThan(173);
  await page
    .getByRole("button", { name: "다운로드 이어받기", exact: true })
    .click();
  await expect(page.locator("#download-message")).toContainText("저장 완료", {
    timeout: 90000,
  });
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "연습 도구", exact: true }).click();
  await page.getByRole("button", { name: /백업 가져오기/ }).click();
  await page.locator("#backup-file").setInputFiles({
    name: "native-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        entries: { "cues_mr_1.mp3": [{ ms: 10000, score: 1, script: 2 }] },
      }),
    ),
  });
  await page.getByRole("button", { name: "확인", exact: true }).click();
  await page.getByRole("button", { name: "연습 도구", exact: true }).click();
  const result = page.waitForEvent("download");
  await page.getByRole("button", { name: /백업 내보내기/ }).click();
  const download = await result;
  const file = await download.path();
  const data = JSON.parse(
    (await import("node:fs/promises")).readFile
      ? await (await import("node:fs/promises")).readFile(file!, "utf8")
      : "{}",
  );
  expect(data.entries["cues_mr_1.mp3"][0].ms).toBe(10000);
  writeFileSync(
    "../artifacts/pwa-download-resume.json",
    JSON.stringify(
      { status: "PASS", pausedAfterFiles: partial, backupRoundTrip: true },
      null,
      2,
    ),
  );
});
