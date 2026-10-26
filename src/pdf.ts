import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerURL from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Mark } from "./core";
GlobalWorkerOptions.workerSrc = workerURL;
const documents = new Map<string, Promise<PDFDocumentProxy>>();
export class Paper {
  viewport: HTMLElement;
  sheet: HTMLElement;
  canvas: HTMLCanvasElement;
  marks: HTMLElement;
  notice: HTMLElement;
  zoom = 1;
  dx = 0;
  dy = 0;
  path = "";
  page = -1;
  key = "";
  generation = 0;
  renderTask?: RenderTask;
  pointers = new Map<number, { x: number; y: number }>();
  down?: {
    x: number;
    y: number;
    dx: number;
    dy: number;
    time: number;
    distance: number;
  };
  pinch?: { distance: number; zoom: number };
  lastTap = 0;
  tapTimer?: number;
  onPrimeTap = () => {};
  onTap = (x: number, y: number) => {};
  constructor(root: HTMLElement) {
    this.viewport = root;
    root.innerHTML =
      '<div class="paper-sheet"><canvas></canvas><div class="marks"></div></div><div class="paper-notice" role="status"></div>';
    this.sheet = root.querySelector(".paper-sheet")!;
    this.canvas = root.querySelector("canvas")!;
    this.marks = root.querySelector(".marks")!;
    this.notice = root.querySelector(".paper-notice")!;
    root.addEventListener("pointerdown", (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      root.setPointerCapture(e.pointerId);
      if (this.pointers.size === 1)
        this.down = {
          x: e.clientX,
          y: e.clientY,
          dx: this.dx,
          dy: this.dy,
          time: performance.now(),
          distance: 0,
        };
      else {
        clearTimeout(this.tapTimer);
        const [a, b] = [...this.pointers.values()];
        this.pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: this.zoom,
        };
        if (this.down) this.down.distance = 100;
      }
    });
    root.addEventListener("pointermove", (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        this.zoom = Math.max(
          1,
          Math.min(
            5,
            (this.pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) /
              this.pinch.distance,
          ),
        );
        this.transform();
      } else if (this.down) {
        const x = e.clientX - this.down.x,
          y = e.clientY - this.down.y;
        this.down.distance = Math.max(this.down.distance, Math.hypot(x, y));
        if (this.zoom > 1) {
          this.dx = this.down.dx + x;
          this.dy = this.down.dy + y;
          this.transform();
        }
      }
    });
    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (
        this.down &&
        this.pointers.size === 0 &&
        this.down.distance < 9 &&
        performance.now() - this.down.time < 500
      ) {
        const now = performance.now();
        if (this.lastTap > 0 && now - this.lastTap < 300) {
          clearTimeout(this.tapTimer);
          this.fit();
          this.lastTap = 0;
        } else {
          this.lastTap = now;
          const r = this.sheet.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          const key = this.key;
          this.onPrimeTap();
          this.tapTimer = window.setTimeout(() => {
            if (this.key === key) this.onTap(x, y);
          }, 300);
        }
      }
      if (this.pointers.size === 0) {
        this.down = undefined;
        this.pinch = undefined;
      }
    };
    root.addEventListener("pointerup", end);
    root.addEventListener("pointercancel", () => {
      this.pointers.clear();
      this.down = undefined;
      this.pinch = undefined;
    });
    root.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom = Math.max(
          1,
          Math.min(5, this.zoom * Math.exp(-e.deltaY * 0.002)),
        );
        this.transform();
      },
      { passive: false },
    );
  }
  transform() {
    this.sheet.style.transform = `translate(${this.dx}px,${this.dy}px) scale(${this.zoom})`;
  }
  fit() {
    clearTimeout(this.tapTimer);
    this.zoom = 1;
    this.dx = 0;
    this.dy = 0;
    this.transform();
  }
  async show(path: string, page: number, marks: Mark[]) {
    const key = `${path}:${page}`;
    if (this.key === key) {
      this.paintMarks(marks);
      return;
    }
    this.key = key;
    this.path = path;
    this.page = page;
    this.fit();
    const generation = ++this.generation;
    this.renderTask?.cancel();
    this.notice.textContent = "불러오는 중";
    try {
      let doc = documents.get(path);
      if (!doc) {
        doc = getDocument({
          url: "/library/" + encodeURIComponent(path),
          disableAutoFetch: true,
        }).promise;
        documents.set(path, doc);
        doc.catch(() => documents.delete(path));
      }
      const pdf = await doc;
      const paper = await pdf.getPage(page + 1);
      if (generation !== this.generation) return;
      const unscaled = paper.getViewport({ scale: 1 });
      const rect = this.viewport.getBoundingClientRect();
      const width = Math.max(100, rect.width - 24),
        height = Math.max(100, rect.height - 24);
      const scale = Math.min(width / unscaled.width, height / unscaled.height);
      this.sheet.style.width = unscaled.width * scale + "px";
      this.sheet.style.height = unscaled.height * scale + "px";
      const pixel = Math.min(devicePixelRatio || 1, 2);
      const vp = paper.getViewport({ scale: scale * pixel });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      this.renderTask = paper.render({ canvas, viewport: vp });
      await this.renderTask.promise;
      if (generation !== this.generation) return;
      this.canvas.replaceWith(canvas);
      this.canvas = canvas;
      this.sheet.dataset.rendered = key;
      this.sheet.style.visibility = "visible";
      this.paintMarks(marks);
      this.notice.textContent = "";
    } catch (e) {
      if (
        generation === this.generation &&
        (e as Error).name !== "RenderingCancelledException"
      ) {
        this.key = "";
        this.sheet.style.visibility = "hidden";
        this.notice.textContent = navigator.onLine
          ? "자료를 열지 못했어요 · 다시 시도해 주세요"
          : "저장하지 않은 자료예요 · 연결 후 다운로드하세요";
      }
    }
  }
  paintMarks(marks: Mark[]) {
    this.marks.replaceChildren(
      ...marks.map((m) => {
        const el = document.createElement("i");
        const [a, b, c, d] = m.box;
        Object.assign(el.style, {
          left: a * 100 + "%",
          top: b * 100 + "%",
          width: (c - a) * 100 + "%",
          height: (d - b) * 100 + "%",
        });
        return el;
      }),
    );
  }
  resize() {
    if (this.path) {
      this.key = "";
    }
  }
}
