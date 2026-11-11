import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const deck: {
  sourceSha256: string;
  ownedRegions: number;
  scenes: { id: string; count: number }[];
  cards: {
    id: string;
    sceneId: string;
    speaker: string;
    regionIds: string[];
  }[];
  script: {
    id: string;
    sceneId: string;
    page: number;
    speaker: string;
    kind: string;
    turnId: string;
    parts: { text: string; own: boolean }[];
    regionIds: string[];
  }[];
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
const legacyKey = "kuroi-pwa-verification-lines-v1";
const readerKey = `${legacyKey}-reader-v2`;
async function start(page: Page) {
  await page.goto("./?verification#lines");
  await expect(page.getByRole("main", { name: "연속 대본" })).toBeVisible();
  await page.waitForFunction(
    () => !!window.kuroiAudit && !!navigator.serviceWorker.controller,
  );
  await page.waitForLoadState("networkidle");
}
async function jump(page: Page, id: string) {
  await page.getByRole("button", { name: "장면 선택", exact: true }).click();
  await page.locator(`[data-line-scene="${id}"]`).click();
  await expect(page.locator(".line-scene-menu")).toBeHidden();
}
const row = (page: Page, id: string) => page.locator(`[data-anchor="${id}"]`);
const own = deck.script.find(
  (r) => r.page === 28 && r.parts.some((p) => p.own),
)!;
const ownText = own.parts.map((p) => p.text).join("");

test("complete script preserves every audited Seonkwan region, other actors and stage context", () => {
  expect(
    createHash("sha256")
      .update(readFileSync("public/library/script.pdf"))
      .digest("hex"),
  ).toBe(deck.sourceSha256);
  expect(deck.scenes).toHaveLength(13);
  expect(deck.cards).toHaveLength(204);
  const regions = deck.script.flatMap((r) => r.regionIds);
  expect(regions).toHaveLength(328);
  expect(new Set(regions).size).toBe(deck.ownedRegions);
  expect([...regions].sort()).toEqual(
    deck.cards.flatMap((c) => c.regionIds).sort(),
  );
  const runtime = JSON.parse(
    readFileSync("public/library/role-highlights.json", "utf8"),
  );
  for (const id of regions) {
    const [page, index] = id.split(":").map(Number);
    expect(runtime.documents["script.pdf"][page][index].roles & 4, id).toBe(4);
  }
  expect(new Set(deck.script.map((r) => r.page)).size).toBe(77);
  expect(new Set(deck.script.map((r) => r.id)).size).toBe(deck.script.length);
  expect(
    deck.script.some(
      (r) => r.speaker === "박해영" && r.parts.every((p) => !p.own),
    ),
  ).toBe(true);
  expect(deck.script.some((r) => r.speaker === "동의회원")).toBe(true);
  expect(
    deck.script.some(
      (r) =>
        r.kind === "direction" &&
        r.parts.some((p) => p.text.includes("창문 뒤로 두 사람의 대화")),
    ),
  ).toBe(true);
  for (const name of ["선관", "무당", "아저씨", "백작"])
    expect(
      deck.script.some(
        (r) => r.speaker.includes(name) && r.parts.some((p) => p.own),
      ),
      name,
    ).toBe(true);
  expect(
    deck.script.some(
      (r) =>
        r.page === 18 && r.parts.some((p) => p.own && p.text.includes("벗겨")),
    ),
  ).toBe(true);
  expect(
    deck.script.some(
      (r) =>
        r.page === 75 &&
        r.parts.some((p) => p.own && p.text.includes("다롱디리")),
    ),
  ).toBe(true);
  const direction = deck.script.find((r) =>
    r.parts.some((p) => p.text.includes("넘어지지 않은 척")),
  )!;
  expect(
    direction.parts.some((p) => !p.own && p.text.includes("넘어지지 않은 척")),
  ).toBe(true);
});

test("continuous scrolling, show/hide, per-turn reveal and saved reading position without quiz or audio", async ({
  page,
}) => {
  await start(page);
  await expect(page.locator(".line-scene-section")).toHaveCount(13);
  await expect(page.locator(".line-block")).toHaveCount(deck.script.length);
  await expect(
    page.getByRole("button", { name: "다음 대사", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "외웠음", exact: true }),
  ).toHaveCount(0);
  await jump(page, "scene-4");
  await expect(row(page, own.id)).toContainText(ownText);
  await expect(row(page, own.id).locator("mark")).toHaveText(ownText);
  const contextText =
    "여기 말씀드렸던 증서입니다. 분위기가 잠잠해지면 찾으러 오겠습니다.";
  await expect(page.locator(".line-script")).toContainText(contextText);
  await page
    .getByRole("button", { name: "내 대사 모두 가리기", exact: true })
    .click();
  await expect(row(page, own.id)).not.toContainText(ownText);
  await expect(page.locator(".line-script")).toContainText(contextText);
  await row(page, own.id)
    .getByRole("button", { name: "이 대사 보기", exact: true })
    .click();
  await expect(row(page, own.id)).toContainText(ownText);
  await row(page, own.id)
    .getByRole("button", { name: "이 대사 가리기", exact: true })
    .click();
  await expect(row(page, own.id)).not.toContainText(ownText);
  await jump(page, "scene-5");
  // Crossing the scene boundary uses the same scroll surface, no next step.
  await expect(page.locator("#line-scene-caption")).toContainText("5장");
  await expect(row(page, "scene-4")).not.toBeInViewport();
  await page.reload();
  await expect(page.locator("#line-scene-caption")).toContainText("5장");
  await expect(
    page.getByRole("button", { name: "내 대사 모두 보기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, own.id)).not.toContainText(ownText);
  await page.locator(".line-script").focus();
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.kuroiAudit.audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.kuroiAudit.audio.currentTime)).toBe(
    0,
  );
  await page
    .getByRole("button", { name: "내 대사 모두 보기", exact: true })
    .click();
  await expect(row(page, own.id)).toContainText(ownText);
});

test("source PDF, offline reader, scene jump and responsive phone/fold/tablet layouts", async ({
  page,
  context,
}, info) => {
  await start(page);
  await jump(page, "scene-4");
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
  await expect(page.locator("#line-scene-caption")).toContainText("4장");
  await page.evaluate(() => window.kuroiAudit.offline.fetchFile("script.pdf"));
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#line-scene-caption")).toContainText("4장");
  await expect(row(page, own.id)).toContainText(ownText);
  await page
    .getByRole("button", { name: "원문 대본 보기", exact: true })
    .click();
  await expect(page.locator("#line-source-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "script.pdf:27",
  );
  await page.getByRole("button", { name: "원문 닫기", exact: true }).click();
  // Scenes without a Seonkwan line remain available as full context.
  await jump(page, "scene-2");
  await expect(page.locator("#line-scene-caption")).toContainText("2장");
  await expect(
    page.locator('[aria-labelledby="line-title-scene-2"]'),
  ).not.toContainText("●");
  await jump(page, "scene-4");
  await page
    .getByRole("button", { name: "내 대사 모두 가리기", exact: true })
    .click();
  if (info.project.name === "chromium-phone") {
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [844, 390],
      [752, 835],
      [1024, 768],
    ]) {
      await page.setViewportSize({ width, height });
      const clipped = await page.locator(".line-toolbar").evaluate((root) =>
        [...root.querySelectorAll("button")]
          .filter((b) => {
            const r = b.getBoundingClientRect();
            return r.left < 0 || r.right > innerWidth || r.bottom > innerHeight;
          })
          .map((b) => b.getAttribute("aria-label")),
      );
      expect(clipped, `${width}x${height}`).toEqual([]);
      expect(
        await page
          .locator(".line-script")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page
        .getByRole("button", { name: "장면 선택", exact: true })
        .click();
      const bounds = await page.locator(".line-scene-menu").boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
      await page
        .getByRole("button", { name: "장면 목록 닫기", exact: true })
        .click();
    }
  }
  await jump(page, "scene-4");
  await page.screenshot({
    path: `../artifacts/pwa-reader-${info.project.name}.png`,
  });
  writeFileSync(
    `../artifacts/pwa-reader-${info.project.name}.json`,
    JSON.stringify({
      status: "PASS",
      scriptRows: deck.script.length,
      sourcePDF: true,
      offline: true,
      noAudio: await page.evaluate(() => window.kuroiAudit.audio.paused),
    }),
  );
});

test("legacy position migrates without deleting quiz records; rehearsal role and MR stay separate", async ({
  page,
}) => {
  const legacy = {
    records: { [own.turnId]: "again" },
    queue: [own.turnId],
    index: 0,
    view: "card",
    sceneId: "scene-4",
    review: false,
  };
  await page.addInitScript(
    ({ key, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(data));
    },
    { key: legacyKey, data: legacy },
  );
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
  await expect(page.locator("#line-scene-caption")).toContainText("4장");
  await expect(row(page, own.id)).toBeInViewport();
  expect(await page.evaluate(() => window.kuroiAudit.audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.kuroiAudit.state.saved.role)).toBe(
    "옥희",
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      legacyKey,
    ),
  ).toEqual(legacy);
  await page.goBack();
  await expect(page.locator("#transport")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("#score-paper .paper-sheet")
        .evaluate((sheet) => sheet.getBoundingClientRect().width),
    )
    .toBeGreaterThan(100);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).anchor,
      readerKey,
    ),
  ).toBe(own.id);
  await page.getByRole("button", { name: "연습 도구", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /선관 대사 암기/ })
    .click();
  await expect(page.getByRole("main", { name: "연속 대본" })).toBeVisible();
  await expect(page.locator("#line-scene-caption")).toContainText("4장");
});
