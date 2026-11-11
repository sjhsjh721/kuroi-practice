import { test, expect, Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

interface Card {
  id: string;
  sceneId: string;
  speaker: string;
  answer: string;
  cue: string;
  directions: string[];
  pages: number[];
  regionIds: string[];
}
const deck: {
  sourceSha256: string;
  ownedRegions: number;
  scenes: { id: string; count: number }[];
  cards: Card[];
} = JSON.parse(readFileSync("src/data/seonkwan-lines.json", "utf8"));
declare global {
  interface Window {
    kuroiAudit: {
      audio: HTMLAudioElement;
      state: { saved: { role: string }; position: number };
      offline: { fetchFile: (path: string) => Promise<Response> };
    };
  }
}
async function start(page: Page) {
  await page.goto("./?verification#lines");
  await expect(
    page.getByRole("heading", { name: "선관 대사 연습", exact: true }),
  ).toBeVisible();
  await page.waitForFunction(
    () => !!window.kuroiAudit && !!navigator.serviceWorker.controller,
  );
  await page.waitForLoadState("networkidle");
}
const own = (page: Page) =>
  page.getByRole("region", { name: "내 대사", exact: true });
const first = deck.cards.find((card) => card.sceneId === "scene-4")!;

test("deck retains source ownership, all 328 marked fragments and four characters", () => {
  expect(
    createHash("sha256")
      .update(readFileSync("public/library/script.pdf"))
      .digest("hex"),
  ).toBe(deck.sourceSha256);
  expect(deck.scenes).toHaveLength(13);
  expect(deck.cards).toHaveLength(204);
  const runtime = JSON.parse(
    readFileSync("public/library/role-highlights.json", "utf8"),
  );
  const regions = deck.cards.flatMap((card) => card.regionIds);
  expect(new Set(regions).size).toBe(deck.ownedRegions);
  expect(regions).toHaveLength(328);
  for (const id of regions) {
    const [page, index] = id.split(":").map(Number);
    expect(runtime.documents["script.pdf"][page][index].roles & 4, id).toBe(4);
  }
  for (const name of ["선관", "무당", "아저씨", "백작"])
    expect(
      deck.cards.some((card) => card.speaker.includes(name)),
      name,
    ).toBe(true);
  expect(
    deck.cards.some(
      (card) => card.pages.includes(18) && card.answer.includes("벗겨\n벗겨"),
    ),
  ).toBe(true);
  expect(
    deck.cards.some(
      (card) =>
        card.pages.includes(75) &&
        card.answer.includes("다롱디리 다롱디리 다롱디리"),
    ),
  ).toBe(true);
  const stage = deck.cards.find((card) => card.id.startsWith("p4-y278"))!;
  expect(stage.directions).toContain("넘어지지 않은 척");
  expect(stage.answer).not.toContain("넘어지지 않은 척");
  for (const scene of deck.scenes)
    expect(deck.cards.filter((card) => card.sceneId === scene.id)).toHaveLength(
      scene.count,
    );
});

test("conceal, graded hints, saved review and keyboard practice never play audio", async ({
  page,
}) => {
  await start(page);
  await page.locator('[data-line-scene="scene-4"]').click();
  await expect(own(page)).not.toContainText(first.answer);
  await expect(
    page.getByRole("region", { name: "앞 대사", exact: true }),
  ).toContainText(first.cue);
  await expect(
    page.getByRole("button", { name: "외웠음", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "첫 단어 힌트", exact: true }).click();
  await expect(own(page)).toContainText("알겠소.");
  await expect(own(page)).not.toContainText(first.answer);
  await page.getByRole("button", { name: "한 구절 힌트", exact: true }).click();
  await expect(own(page)).not.toContainText(first.answer);
  await page
    .getByRole("button", { name: "전체 정답 보기", exact: true })
    .click();
  await expect(own(page)).toContainText(first.answer);
  await page.getByRole("button", { name: "다시", exact: true }).click();
  await expect(page.getByRole("navigation")).toContainText("2 / 30");
  await page.keyboard.press("Space");
  await expect(own(page).locator(".line-answer")).toHaveClass(/is-revealed/);
  await page.keyboard.press("2");
  await expect(page.getByRole("navigation")).toContainText("3 / 30");
  expect(await page.evaluate(() => window.kuroiAudit.audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.kuroiAudit.audio.currentTime)).toBe(
    0,
  );
  await page.reload();
  await expect(page.getByRole("navigation")).toContainText("3 / 30");
  await expect(own(page).locator(".line-answer")).not.toHaveClass(
    /is-revealed/,
  );
  await page.getByRole("button", { name: "장면 선택", exact: true }).click();
  await page.getByRole("button", { name: /^복습/ }).click();
  await expect(page.getByRole("navigation")).toContainText("1 / 1");
  await page
    .getByRole("button", { name: "전체 정답 보기", exact: true })
    .click();
  await expect(own(page)).toContainText(first.answer);
  await page.getByRole("button", { name: "외웠음", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "복습 한 바퀴 끝", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /어려운 대사 복습/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "처음부터", exact: true }).click();
  await expect(page.getByRole("navigation")).toContainText("1 / 1");
  await expect(own(page)).not.toContainText(first.answer);
  await page
    .getByRole("button", { name: "연습실로 돌아가기", exact: true })
    .click();
  await expect(page.locator("#transport")).toBeVisible();
  await expect(page.locator("#app")).not.toHaveClass(/line-mode/);
});

test("source PDF, offline restore and phone/fold/tablet layouts", async ({
  page,
  context,
}, info) => {
  await start(page);
  await page.locator('[data-line-scene="scene-4"]').click();
  await page
    .getByRole("button", { name: "원문 대본 보기", exact: true })
    .click();
  await expect(page.locator("#line-source-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "script.pdf:27",
  );
  await expect(
    page.locator("#line-source-paper .marks i").first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "원문 다음 페이지", exact: true })
    .click();
  await expect(page.locator("#line-source-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "script.pdf:28",
  );
  await page.getByRole("button", { name: "원문 닫기", exact: true }).click();
  await expect(own(page)).not.toContainText(first.answer);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("navigation")).toContainText("2 / 30");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("navigation")).toContainText("1 / 30");
  await page.evaluate(() => window.kuroiAudit.offline.fetchFile("script.pdf"));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("navigation")).toContainText("1 / 30");
  await page
    .getByRole("button", { name: "전체 정답 보기", exact: true })
    .click();
  await expect(own(page)).toContainText(first.answer);
  await page.getByRole("button", { name: "다시", exact: true }).click();
  await page
    .getByRole("button", { name: "원문 대본 보기", exact: true })
    .click();
  await expect(page.locator("#line-source-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "script.pdf:27",
  );
  await page.getByRole("button", { name: "원문 닫기", exact: true }).click();
  if (info.project.name === "chromium-phone") {
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [844, 390],
      [752, 835],
      [1024, 768],
    ]) {
      await page.setViewportSize({ width, height });
      const clipped = await page.locator("#line-practice").evaluate((root) =>
        [...root.querySelectorAll("button")]
          .filter((button) => {
            const r = button.getBoundingClientRect();
            return (
              r.width &&
              r.height &&
              (r.left < 0 ||
                r.right > innerWidth ||
                r.top < 0 ||
                r.bottom > innerHeight)
            );
          })
          .map(
            (button) => button.getAttribute("aria-label") || button.textContent,
          ),
      );
      expect(clipped, `${width}x${height}`).toEqual([]);
      await expect(page.locator(".line-footer")).toBeVisible();
    }
  }
  await page.screenshot({
    path: `../artifacts/pwa-lines-${info.project.name}.png`,
  });
  writeFileSync(
    `../artifacts/pwa-lines-${info.project.name}.json`,
    JSON.stringify({
      status: "PASS",
      cards: deck.cards.length,
      sourcePDF: true,
      offline: true,
      noAudio: await page.evaluate(() => window.kuroiAudit.audio.paused),
    }),
  );
});

test("enter from rehearsal, pause MR, keep the actor profile and return with browser back", async ({
  page,
}) => {
  await page.goto("./?verification");
  await page.getByRole("button", { name: "옥희 옥희", exact: true }).click();
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await page.waitForFunction(() => !!window.kuroiAudit);
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("button", { name: "재생", exact: true })
    .click({ delay: 100 });
  await expect
    .poll(() => page.evaluate(() => window.kuroiAudit.audio.currentTime))
    .toBeGreaterThan(0.12);
  await page
    .getByRole("button", { name: "선관 대사 암기", exact: true })
    .click();
  await expect(page).toHaveURL(/#lines$/);
  await expect(
    page.getByRole("heading", { name: "선관 대사 연습", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.kuroiAudit.audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.kuroiAudit.state.saved.role)).toBe(
    "옥희",
  );
  await page.locator('[data-line-scene="scene-4"]').click();
  await expect(own(page)).toContainText("아저씨");
  await page.goBack();
  await expect(page.locator("#transport")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("#score-paper .paper-sheet")
        .evaluate((sheet) => sheet.getBoundingClientRect().width),
    )
    .toBeGreaterThan(100);
  await page.getByRole("button", { name: "연습 도구", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /선관 대사 암기/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "선관 대사 연습", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toContainText("1 / 30");
  expect(await page.evaluate(() => window.kuroiAudit.audio.paused)).toBe(true);
});
