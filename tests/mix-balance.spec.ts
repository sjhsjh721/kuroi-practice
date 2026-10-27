import { test, expect, Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

async function syntheticStereo(page: Page, amplitude = 0.1) {
  await page.evaluate((amplitude) => {
    const rate = 44100,
      frames = rate * 20;
    const bytes = new ArrayBuffer(44 + frames * 4),
      v = new DataView(bytes);
    function text(at: number, s: string) {
      [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
    }
    text(0, "RIFF");
    v.setUint32(4, bytes.byteLength - 8, true);
    text(8, "WAVE");
    text(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 2, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 4, true);
    v.setUint16(32, 4, true);
    v.setUint16(34, 16, true);
    text(36, "data");
    v.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames; i++) {
      v.setInt16(
        44 + i * 4,
        Math.round(
          Math.sin((i / rate) * 2 * Math.PI * 440) * 32767 * amplitude,
        ),
        true,
      );
      v.setInt16(
        46 + i * 4,
        Math.round(
          Math.sin((i / rate) * 2 * Math.PI * 880) * 32767 * amplitude,
        ),
        true,
      );
    }
    const a = (window as any).kuroiAudit.audio as HTMLAudioElement;
    a.src = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    a.load();
  }, amplitude);
  await page.waitForFunction(
    () => (window as any).kuroiAudit.audio.readyState >= 2,
  );
}
async function levels(page: Page) {
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const a = (window as any).kuroiAudit,
      c = a.audioGraph.context as AudioContext;
    let analyser = (window as any).mixAnalyser as AnalyserNode;
    if (!analyser) {
      analyser = c.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0;
      analyser.minDecibels = -120;
      a.audioGraph.master.connect(analyser);
      (window as any).mixAnalyser = analyser;
    }
    const f = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatFrequencyData(f);
    const band = (hz: number) => {
      const i = Math.round((hz / c.sampleRate) * analyser.fftSize);
      return Math.max(...f.slice(i - 2, i + 3));
    };
    const wave = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(wave);
    return {
      mr: band(440),
      harmony: band(880),
      peak: Math.max(...wave.map(Math.abs)),
      position: a.audio.currentTime,
      rate: a.audio.playbackRate,
      preservesPitch: a.audio.preservesPitch,
      strongest: [...f]
        .map((db, i) => ({ db, hz: (i * c.sampleRate) / analyser.fftSize }))
        .sort((a, b) => b.db - a.db)
        .slice(0, 4),
    };
  });
}
async function slide(page: Page, name: string, value: number) {
  await page
    .getByRole("slider", { name, exact: true })
    .evaluate((e: HTMLInputElement, v) => {
      e.value = String(v);
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
}
test("MR and harmony sliders change actual independent audio without restarting", async ({
  page,
}, info) => {
  await page.goto("./?verification");
  await page
    .getByRole("button", {
      name: "선관 선관귀신 · 무당 · 아저씨(배수환) · 사이토 백작",
    })
    .click();
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await page.locator('[data-action="audio"]').click();
  await page.getByRole("button", { name: /MR\+화음 · 선관/ }).click();
  await page.waitForFunction(
    () =>
      (window as any).kuroiAudit.state.track.layout ===
      "mr-left-harmony-right-v2",
  );
  await syntheticStereo(page, 0.8);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await page.waitForFunction(
    () => (window as any).kuroiAudit.audioGraph.context?.state === "running",
  );
  await levels(page);
  const limited = await levels(page);
  expect(limited.peak).toBeLessThan(0.91);
  expect(limited.peak).toBeGreaterThan(0.8);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await syntheticStereo(page);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  // Prime the analyser before taking the first full FFT window.
  await levels(page);
  const both = await levels(page);
  expect(both.mr).toBeGreaterThan(-40);
  expect(both.harmony).toBeGreaterThan(-40);
  await page
    .getByRole("button", { name: "MR·화음 밸런스", exact: true })
    .click();
  await slide(page, "MR 음량", 0);
  const harmony = await levels(page);
  expect(harmony.mr).toBeLessThan(both.mr - 35);
  expect(Math.abs(harmony.harmony - both.harmony)).toBeLessThan(2);
  expect(harmony.position).toBeGreaterThan(both.position);
  await slide(page, "화음 음량", 0);
  const silent = await levels(page);
  expect(silent.peak).toBeLessThan(0.0001);
  await slide(page, "MR 음량", 1);
  const mr = await levels(page);
  expect(mr.harmony).toBeLessThan(both.harmony - 35);
  expect(mr.mr).toBeGreaterThan(-40);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.locator('[data-action="rate"]').click();
  await page.getByRole("button", { name: "0.75×", exact: true }).click();
  const slow = await levels(page);
  expect(slow.mr).toBeGreaterThan(-40);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await page.reload();
  await page.waitForFunction(() => !!(window as any).kuroiAudit);
  expect(
    await page.evaluate(() => (window as any).kuroiAudit.state.saved.mixMR),
  ).toBe(1);
  expect(
    await page.evaluate(
      () => (window as any).kuroiAudit.state.saved.mixHarmony,
    ),
  ).toBe(0);
  // Muting the guide must not mute or collapse the normal MR/AR stereo route.
  await page.locator('[data-action="audio"]').click();
  await page.getByRole("button", { name: "MR", exact: true }).click();
  await syntheticStereo(page);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await levels(page);
  const normal = await levels(page);
  expect(normal.peak).toBeGreaterThan(0.03);
  expect(Math.abs(normal.mr - normal.harmony)).toBeLessThan(2);
  expect(normal.strongest.some((p) => Math.abs(p.hz - 440) < 8)).toBe(true);
  expect(normal.strongest.some((p) => Math.abs(p.hz - 880) < 8)).toBe(true);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  writeFileSync(
    `../artifacts/pwa-mix-balance-${info.project.name}.json`,
    JSON.stringify(
      { status: "PASS", limited, both, harmony, silent, mr, slow, normal },
      null,
      2,
    ),
  );
});

test("legacy mix position and native cue backups migrate to the new audio URL", async ({
  page,
}, info) => {
  if (info.project.name !== "webkit-ipad") test.skip();
  await page.addInitScript(() => {
    if (!localStorage.getItem("kuroi-pwa-verification"))
      localStorage.setItem(
        "kuroi-pwa-verification",
        JSON.stringify({
          seen: true,
          downloadPrompted: true,
          kind: "MR+화음",
          part: "선관",
          role: "선관",
          positions: { "mixes/harmony_선관_1.m4a": 40 },
          custom: {
            "mixes/harmony_선관_1.m4a": [{ ms: 1200, score: 1, script: 2 }],
          },
          hidden: { "mixes/harmony_선관_1.m4a": ["0_0_2"] },
        }),
      );
  });
  await page.goto("./?verification");
  await page.waitForFunction(() => (window as any).kuroiAudit?.state.ready);
  const s = await page.evaluate(() => (window as any).kuroiAudit.state);
  expect(s.track.path).toBe("mixes/v2/harmony_선관_1.m4a");
  expect(s.position).toBeCloseTo(40, 0);
  expect(s.saved.custom[s.track.path][0].ms).toBe(1200);
  expect(s.saved.hidden[s.track.path]).toEqual(["0_0_2"]);
  await page.getByRole("button", { name: "연습 도구", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /백업 내보내기/ }).click();
  const file = await downloaded;
  const { readFileSync } = await import("node:fs");
  const backup = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(backup.entries["cues_mixes/harmony_선관_1.m4a"][0].ms).toBe(1200);
  await page.locator("#backup-file").setInputFiles({
    name: "native.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole("button", { name: "확인", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).kuroiAudit.state.saved.custom[
          "mixes/v2/harmony_선관_1.m4a"
        ][0].ms,
    ),
  ).toBe(1200);
});
