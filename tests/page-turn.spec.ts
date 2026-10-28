import { test, expect, Page } from "@playwright/test";

async function start(page: Page) {
  await page.goto("./?verification");
  await page.getByRole("button", { name: "해웅 해웅 · 박해영" }).click();
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await page.waitForFunction(() => (window as any).kuroiAudit?.state.ready);
  await page.getByRole("button", { name: "양쪽 보기", exact: true }).click();
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "script.pdf:2",
  );
}

// Chromium receives actual touch events. Mobile WebKit's Playwright API has
// no swipe primitive; native mouse input exercises the same pointer handlers.
async function swipe(
  page: Page,
  kind: string,
  x: number,
  y = 0,
  cancel = false,
) {
  const box = (await page.locator(`#${kind}-paper`).boundingBox())!;
  const from = {
    x: box.x + box.width * (x < 0 ? 0.8 : 0.2),
    y: box.y + box.height * 0.4,
  };
  if (page.context().browser()!.browserType().name() === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...from, id: 1 }],
    });
    for (let i = 1; i <= 5; i++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: from.x + (box.width * x * i) / 5,
            y: from.y + (box.height * y * i) / 5,
            id: 1,
          },
        ],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + box.width * x, from.y + box.height * y, {
      steps: 5,
    });
    await page.mouse.up();
  }
}

async function seek(page: Page, seconds: number) {
  await page.locator("#seek").evaluate((input: HTMLInputElement, seconds) => {
    input.value = String(seconds);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, seconds);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).kuroiAudit.audio.currentTime),
    )
    .toBeCloseTo(seconds, 0);
}

test("manual toggle, buttons and page input hold pages during playback and resume auto on request", async ({
  page,
}) => {
  await start(page);
  const follow = page.locator('[data-action="follow"]');
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await follow.click();
  await expect(follow).toHaveText("수동");
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await page
    .getByRole("button", { name: "악보 다음 페이지", exact: true })
    .click();
  await expect(page.locator("#score-page")).toHaveText("2 / 7");
  await page
    .getByRole("button", { name: "대본 다음 페이지", exact: true })
    .click();
  await expect(page.locator("#script-page")).toHaveText("4 / 79");
  await seek(page, 80);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).kuroiAudit.audio.currentTime),
    )
    .toBeGreaterThan(80.2);
  await expect(page.locator("#score-page")).toHaveText("2 / 7");
  await expect(page.locator("#script-page")).toHaveText("4 / 79");
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await page.locator('[data-action="script-page"]').click();
  await page.getByRole("spinbutton", { name: "이동할 페이지" }).fill("79");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(
    page.getByRole("spinbutton", { name: "이동할 페이지" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "이동", exact: true }).click();
  await expect(page.locator("#script-page")).toHaveText("79 / 79");
  await expect(
    page.getByRole("button", { name: "대본 다음 페이지", exact: true }),
  ).toBeDisabled();
  await follow.click();
  await expect(follow).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#script-page")).not.toHaveText("79 / 79");
  await page
    .getByRole("button", { name: "악보 이전 페이지", exact: true })
    .click();
  await expect(follow).toHaveAttribute("aria-pressed", "false");
});

test("independent swipes in both and fullscreen single views preserve audio and page bounds", async ({
  page,
}) => {
  await start(page);
  const follow = page.locator('[data-action="follow"]');
  await swipe(page, "score", -0.6);
  await expect(page.locator("#score-page")).toHaveText("2 / 7");
  await expect(page.locator("#script-page")).toHaveText("3 / 79");
  await expect(follow).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#score-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "score_1.pdf:1",
  );
  await swipe(page, "score", 0.6);
  await expect(page.locator("#score-page")).toHaveText("1 / 7");
  await swipe(page, "score", 0.6);
  await expect(page.locator("#score-page")).toHaveText("1 / 7");
  await swipe(page, "script", -0.6);
  await expect(page.locator("#script-page")).toHaveText("4 / 79");
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    "script.pdf:3",
  );
  await page.getByRole("button", { name: "전체화면", exact: true }).click();
  await page.getByRole("button", { name: "대본 보기", exact: true }).click();
  await swipe(page, "script", -0.6);
  await expect(page.locator("#script-page")).toHaveText("5 / 79");
  await swipe(page, "script", 0.6);
  await expect(page.locator("#script-page")).toHaveText("4 / 79");
  await page.getByRole("button", { name: "악보 보기", exact: true }).click();
  await swipe(page, "score", -0.6);
  await expect(page.locator("#score-page")).toHaveText("2 / 7");
  await page.waitForTimeout(350); // A swipe must not leave a delayed score tap.
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.audio.paused),
  ).toBe(true);
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.audio.currentTime),
  ).toBe(0);
});

test("short, vertical, cancelled and zoomed gestures do not turn pages", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "대본 보기", exact: true }).click();
  await swipe(page, "script", -0.04);
  await swipe(page, "script", -0.05, 0.3);
  if (page.context().browser()!.browserType().name() === "chromium") {
    await swipe(page, "script", -0.6, 0, true);
    const box = (await page.locator("#script-paper").boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const points = (offset: number) => [
      {
        x: box.x + box.width * 0.4 + offset,
        y: box.y + box.height * 0.5,
        id: 1,
      },
      {
        x: box.x + box.width * 0.5 + offset,
        y: box.y + box.height * 0.5,
        id: 2,
      },
    ];
    // Two fingers translated together at fitted zoom are a multi-touch gesture,
    // not a one-finger page turn, including the final remaining pointer-up.
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(0),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(-100),
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  }
  await expect(page.locator("#script-page")).toHaveText("3 / 79");
  await expect(page.locator('[data-action="follow"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.locator("#script-paper").dispatchEvent("wheel", { deltaY: -400 });
  await expect(page.locator("#script-paper .paper-detail")).toBeAttached();
  await swipe(page, "script", -0.6);
  await expect(page.locator("#script-page")).toHaveText("3 / 79");
  expect(
    await page
      .locator("#script-paper .paper-sheet")
      .evaluate((el) => el.style.transform),
  ).not.toContain("translate(0px,0px)");
  await page
    .getByRole("button", { name: "대본 화면 맞춤", exact: true })
    .click();
  await swipe(page, "script", -0.6);
  await expect(page.locator("#script-page")).toHaveText("4 / 79");
});
