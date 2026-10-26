import { test, expect, Page } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { mergedCues, pagesAt, hitNote, validateBackup } from "../src/core";
const source = "../app/src/main/assets/library/";
const catalog = JSON.parse(readFileSync(source + "catalog.json", "utf8")),
  timeline = JSON.parse(readFileSync(source + "auto-timing.json", "utf8")),
  navigation = JSON.parse(
    readFileSync(source + "score-navigation.json", "utf8"),
  ),
  mixes = JSON.parse(readFileSync(source + "mix-catalog.json", "utf8"));
async function start(page: Page) {
  await page.goto("./?verification");
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("button", {
      name: "선관 선관귀신 · 무당 · 아저씨(배수환) · 사이토 백작",
    })
    .click();
  await page.waitForFunction(() => !!(window as any).kuroiAudit);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForFunction(
    () => !!document.querySelector("#score-paper .paper-sheet[data-rendered]"),
  );
}
async function seek(page: Page, time: number) {
  await page.locator("#seek").evaluate((e: HTMLInputElement, t) => {
    e.value = String(t);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }, time);
  await expect
    .poll(() => page.evaluate(() => (window as any).kuroiAudit.state.position))
    .toBeCloseTo(time, 0);
}
test("time map, boundary tap and native backup compatibility", async () => {
  for (const track of [...catalog.tracks, ...mixes.tracks]) {
    const path = track.reference || track.path;
    const cues = mergedCues(timeline.tracks[path].cues, [], []);
    const song = catalog.songs.find((s: any) => s.number === track.number);
    for (const c of cues) {
      const p = pagesAt(cues, c.ms, 0, song.scriptPage - 1);
      expect(p.score).toBe(c.score);
      expect(p.script).toBe(c.script);
    }
    expect(navigation.tracks[path].times.length).toBeGreaterThan(0);
  }
  for (const x of [0.3886389, 0.388639, 0.3886391]) {
    const hit = hitNote(
      navigation.songs["8"].pages[2].regions,
      navigation.tracks["ar_8.mp3"].times,
      x,
      0.4915435,
    );
    expect(hit).toBe(158888);
  }
  const good = {
    version: 1,
    entries: { "cues_mr_1.mp3": [{ ms: 1500, score: 1, script: 2 }] },
  };
  expect(
    validateBackup(good, catalog.tracks, catalog.songs, 79).custom[
      "mr_1.mp3"
    ][0].ms,
  ).toBe(1500);
  expect(() =>
    validateBackup(
      {
        version: 1,
        entries: { "cues_mr_1.mp3": [{ ms: -1, score: 0, script: 0 }] },
      },
      catalog.tracks,
      catalog.songs,
      79,
    ),
  ).toThrow();
});
test("role, score tap, playback, views, fullscreen navigation and corrections", async ({
  page,
}, info) => {
  await start(page);
  await expect(page.locator("#score-paper .marks i").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "이전 넘버", exact: true }),
  ).toBeDisabled();
  await page.waitForFunction(() => (window as any).kuroiAudit.state.ready);
  const paper = page.locator("#score-paper .paper-sheet");
  const box = await paper.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.dblclick(
    box!.x + box!.width * 0.227768,
    box!.y + box!.height * 0.188267,
  );
  await page.waitForTimeout(350);
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.audio.paused),
  ).toBe(true);
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.state.position),
  ).toBe(0);
  await page.waitForTimeout(310);
  await page.mouse.click(
    box!.x + box!.width * 0.227768,
    box!.y + box!.height * 0.188267,
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).kuroiAudit.state.position))
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await page.getByRole("button", { name: "전체화면", exact: true }).click();
  await expect(page.locator("#app")).toHaveClass(/fullscreen/);
  await expect(page.locator(".score-document")).toBeVisible();
  await expect(page.locator(".script-document")).toBeVisible();
  await page.getByRole("button", { name: "대본 보기", exact: true }).click();
  await expect(page.locator(".score-document")).toBeHidden();
  await page.getByRole("button", { name: "악보 보기", exact: true }).click();
  await expect(page.locator(".script-document")).toBeHidden();
  await page.getByRole("button", { name: "양쪽 보기", exact: true }).click();
  await page.getByRole("button", { name: "다음 넘버", exact: true }).click();
  await expect(page.locator("#song-title")).toContainText("02");
  await page.getByRole("button", { name: "이전 넘버", exact: true }).click();
  await page.waitForFunction(() => (window as any).kuroiAudit.state.ready);
  await seek(page, 20);
  await page
    .getByRole("button", { name: "연습 속도", exact: true })
    .count()
    .then(async (n) => {
      if (!n) await page.locator('[data-action="rate"]').click();
    });
  await page.getByRole("button", { name: "0.75×", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).kuroiAudit.audio.playbackRate),
    )
    .toBe(0.75);
  await page
    .getByRole("button", { name: "악보 다음 페이지", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).kuroiAudit.state.follow))
    .toBe(false);
  const manualPage = await page.evaluate(
    () => (window as any).kuroiAudit.state.scorePage,
  );
  await page.evaluate(() =>
    (window as any).kuroiAudit.audio.dispatchEvent(new Event("loadedmetadata")),
  );
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.state.scorePage),
  ).toBe(manualPage);
  await page.getByRole("button", { name: "연습 도구", exact: true }).click();
  await page.getByRole("button", { name: /현재 지점 보정/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).kuroiAudit.state.saved.custom["mr_1.mp3"]?.length,
      ),
    )
    .toBe(1);
  await page.locator('[data-action="follow"]').click();
  await page.getByRole("button", { name: "구간 반복", exact: true }).click();
  await page.getByRole("button", { name: /시작 지정/ }).click();
  await seek(page, 22);
  await page.getByRole("button", { name: "구간 반복", exact: true }).click();
  await page.getByRole("button", { name: /끝 지정/ }).click();
  await page.waitForTimeout(150);
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.audio.paused),
  ).toBe(true);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await expect(page.locator('[data-action="toggle"]')).toHaveAttribute(
    "aria-label",
    "일시정지",
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).kuroiAudit.state.position))
    .toBeLessThan(22);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  const errors = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "#chrome button,#transport button",
      ),
    ]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return (
          r.width > 0 &&
          (r.left < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)
        );
      })
      .map((e) => e.getAttribute("aria-label")),
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: `../artifacts/pwa-${info.project.name}.png` });
});
test("complete download, offline reload and cached audio seeking", async ({
  page,
  context,
}, info) => {
  if (info.project.name !== "webkit-ipad") test.skip();
  test.setTimeout(300000);
  await start(page);
  await page
    .getByRole("button", { name: "자료 다운로드", exact: true })
    .click();
  await page.locator('[data-pack="all"]').click();
  await expect
    .poll(
      () => page.evaluate(() => (window as any).kuroiAudit.state.download.done),
      { timeout: 180000 },
    )
    .toBe(173);
  await expect(page.locator("#download-message")).toContainText("저장 완료");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).kuroiAudit?.state.ready);
  await expect(page.locator("#score-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "score_1.pdf:0",
  );
  await seek(page, 45);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).kuroiAudit.state.position))
    .toBeGreaterThan(45.1);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  const range = await page.evaluate(async () => {
    const r = await fetch((window as any).kuroiAudit.offline.url("mr_1.mp3"), {
      headers: { Range: "bytes=100-199" },
    });
    return {
      status: r.status,
      bytes: (await r.arrayBuffer()).byteLength,
      range: r.headers.get("content-range"),
    };
  });
  expect(range.status).toBe(206);
  expect(range.bytes).toBe(100);
  const native = await page.evaluate(async () => {
    const app = (window as any).kuroiAudit;
    const rows = [];
    for (const t of app.tracks) {
      const a = new Audio();
      a.muted = true;
      a.preload = "auto";
      a.src = app.offline.url(t.path);
      await new Promise<void>((resolve, reject) => {
        a.onloadedmetadata = () => resolve();
        a.onerror = () => reject(Error(t.path));
        setTimeout(() => reject(Error("metadata timeout " + t.path)), 10000);
      });
      a.currentTime = a.duration * 0.5;
      await new Promise<void>((resolve, reject) => {
        a.onseeked = () => resolve();
        setTimeout(() => reject(Error("seek timeout " + t.path)), 10000);
      });
      const target = a.currentTime;
      await a.play();
      await new Promise((r) => setTimeout(r, 130));
      const advance = a.currentTime - target;
      a.pause();
      if (advance <= 0.015) throw Error("clock did not advance " + t.path);
      rows.push({ path: t.path, duration: a.duration, advance });
      a.removeAttribute("src");
      a.load();
    }
    return rows;
  });
  expect(native.length).toBe(150);
  writeFileSync(
    `../artifacts/pwa-native-offline-${info.project.name}.json`,
    JSON.stringify(native, null, 2),
  );
  await page.screenshot({ path: "../artifacts/pwa-offline.png" });
  await context.setOffline(false);
});
