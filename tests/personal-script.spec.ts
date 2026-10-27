import { test, expect, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

// An actual PDF Ink annotation without a flattened appearance, as produced by
// handwriting apps. The viewer must render the annotation as well as page text.
function annotatedPdf(pages = 79) {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, p) => `${4 + p * 3} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let p = 0; p < pages; p++) {
    const id = 4 + p * 3;
    const text = `BT /F1 24 Tf 80 420 Td (MY SCRIPT PAGE ${p + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R /Annots [${id + 2} 0 R] >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
      "<< /Type /Annot /Subtype /Ink /Rect [77 387 533 393] /InkList [[80 390 530 390]] /C [1 0 0] /BS << /W 6 >> /F 4 >>",
    );
  }
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
async function redInk(page: Page) {
  return page
    .locator("#script-paper .paper-sheet > canvas")
    .first()
    .evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 180 && pixels[i + 1] < 80 && pixels[i + 2] < 80)
          count++;
      return count;
    });
}
test("personal annotated PDF persists offline, follows cues and restores original", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./?verification");
  await page.getByRole("button", { name: "해웅 해웅 · 박해영" }).click();
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await page.waitForFunction(
    () =>
      !!(window as any).kuroiAudit?.state.ready &&
      !!navigator.serviceWorker.controller,
  );
  await page.getByRole("button", { name: "연습 도구", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /내 메모 대본/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("79쪽");
  await page.locator("#script-file").setInputFiles({
    name: "my-notes.pdf",
    mimeType: "application/pdf",
    buffer: annotatedPdf(),
  });
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    /local-script:.*:2$/,
  );
  const ink = await redInk(page);
  expect(ink).toBeGreaterThan(100);
  await expect(page.locator('[data-action="personal-script"]')).toContainText(
    "내 대본",
  );
  await page
    .getByRole("button", { name: "대본 다음 페이지", exact: true })
    .click();
  const cue = await page.evaluate(
    () => (window as any).kuroiAudit.timeline.tracks["mr_1.mp3"].cues[1],
  );
  await page.locator("#seek").evaluate((e: HTMLInputElement, ms) => {
    e.value = String(ms / 1000);
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }, cue.ms);
  await page.locator('[data-action="follow"]').click();
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    new RegExp(`local-script:.*:${cue.script}$`),
  );
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).kuroiAudit);
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    /local-script:/,
  );
  expect(await redInk(page)).toBeGreaterThan(100);
  await page.locator("#script-paper").dispatchEvent("wheel", { deltaY: -1000 });
  await expect(page.locator("#script-paper .paper-detail")).toBeAttached();
  await page.getByRole("button", { name: "내 메모 대본", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("my-notes.pdf");
  await page.getByRole("button", { name: /원본 대본 사용/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await context.setOffline(false);
  // Original may not have been downloaded. It remains available online.
  await page.reload();
  await page.waitForFunction(() => !!(window as any).kuroiAudit);
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    /script.pdf:/,
  );
  expect(await redInk(page)).toBe(0);
  await page.getByRole("button", { name: "내 메모 대본", exact: true }).click();
  await page.getByRole("button", { name: /내 대본 사용/ }).click();
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    /local-script:/,
  );
  // A wrong-page-count or corrupt import leaves the current file intact.
  await page.locator("#script-file").setInputFiles({
    name: "one-page.pdf",
    mimeType: "application/pdf",
    buffer: annotatedPdf(1),
  });
  await expect(page.locator("#toast")).toContainText("79쪽");
  await expect(page.locator('[data-action="personal-script"]')).toContainText(
    "내 대본",
  );
  await page.locator("#script-file").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("broken"),
  });
  await expect(page.locator("#toast")).toContainText("열 수 없는 PDF");
  await expect(page.locator("#script-paper .paper-sheet")).toHaveAttribute(
    "data-rendered",
    /local-script:/,
  );
  await page.screenshot({
    path: `../artifacts/pwa-personal-script-${info.project.name}.png`,
  });
  expect(errors).toEqual([]);
  writeFileSync(
    `../artifacts/pwa-personal-script-${info.project.name}.json`,
    JSON.stringify(
      {
        status: "PASS",
        annotationInkPixels: ink,
        cue,
        offlineReload: true,
        restoredOriginal: true,
        rejectedWrongCountAndCorrupt: true,
        errors,
      },
      null,
      2,
    ),
  );
});
