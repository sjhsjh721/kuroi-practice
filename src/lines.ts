import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  List,
  X,
  createElement,
  type IconNode,
} from "lucide";
import rawDeck from "./data/seonkwan-lines.json";
import { Paper } from "./pdf";
import type { Mark } from "./core";

interface ScriptRow {
  id: string;
  sceneId: string;
  speaker: string;
  kind: string;
  page: number;
  turnId: string;
  parts: { text: string; own: boolean }[];
}
interface ReaderState {
  concealed: boolean;
  anchor: string;
  offset: number;
}
const deck = rawDeck;
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
const icon = (node: IconNode) =>
  createElement(node, {
    "aria-hidden": "true",
    width: 20,
    height: 20,
    "stroke-width": 1.8,
  }).outerHTML;
const action = (id: string, label: string, node: IconNode, caption = "") =>
  `<button type="button" data-line-action="${id}" aria-label="${label}" title="${label}">${icon(node)}${caption ? `<span>${caption}</span>` : ""}</button>`;

export class LinePractice {
  readonly root: HTMLElement;
  private state: ReaderState = {
    concealed: false,
    anchor: "scene-1",
    offset: 0,
  };
  private revealed = new Set<string>();
  private anchors: HTMLElement[] = [];
  private sourcePage: number | null = null;
  private paper?: Paper;
  private currentPage = 3;
  private currentScene = "scene-1";
  private saveTimer?: number;
  private readerKey: string;
  constructor(
    root: HTMLElement,
    key: string,
    private options: {
      exit: () => void;
      marks: (page: number) => Mark[];
      notify: (text: string) => void;
    },
  ) {
    this.root = root;
    // Keep old quiz records intact; only migrate its reading position.
    this.readerKey = `${key}-reader-v2`;
    const validAnchors = new Set([
      ...deck.scenes.map((s) => s.id),
      ...deck.script.map((r) => r.id),
    ]);
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(this.readerKey) || "null",
      );
      if (saved && typeof saved === "object") {
        if ("concealed" in saved && typeof saved.concealed === "boolean")
          this.state.concealed = saved.concealed;
        if (
          "anchor" in saved &&
          typeof saved.anchor === "string" &&
          validAnchors.has(saved.anchor)
        )
          this.state.anchor = saved.anchor;
        if (
          "offset" in saved &&
          typeof saved.offset === "number" &&
          Number.isFinite(saved.offset)
        )
          this.state.offset = Math.max(0, Math.min(saved.offset, 500));
      } else {
        const legacy: unknown = JSON.parse(localStorage.getItem(key) || "null");
        if (
          legacy &&
          typeof legacy === "object" &&
          "queue" in legacy &&
          Array.isArray(legacy.queue) &&
          "index" in legacy &&
          typeof legacy.index === "number"
        ) {
          const oldId: unknown = legacy.queue[legacy.index];
          const row = deck.script.find((r) => r.turnId === oldId);
          if (row) this.state.anchor = row.id;
        }
      }
    } catch {
      /* Invalid reader settings never affect rehearsal or quiz records. */
    }
    root.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>("button");
      if (!button || button.disabled) return;
      if (button.dataset.lineScene) this.jump(button.dataset.lineScene);
      else if (button.dataset.lineTurn)
        this.toggleTurn(button.dataset.lineTurn);
      else if (button.dataset.lineAction) this.act(button.dataset.lineAction);
    });
    root.addEventListener(
      "scroll",
      (event) => {
        if (
          !(event.target instanceof HTMLElement) ||
          !event.target.matches(".line-script")
        )
          return;
        this.capturePosition();
        clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => this.persist(), 200);
      },
      true,
    );
    let resizeTimer: number;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (this.isOpen && this.sourcePage !== null) {
          this.paper?.resize();
          this.showSource(this.sourcePage);
        }
      }, 150);
    });
    document.addEventListener("keydown", (event) => {
      if (!this.isOpen || event.key !== "Escape") return;
      event.preventDefault();
      if (this.sourcePage !== null) this.closeSource();
      else if (this.sceneMenuOpen) this.setSceneMenu(false);
      else this.options.exit();
    });
    window.addEventListener("pagehide", () => {
      if (this.isOpen) this.persist();
    });
  }
  get isOpen() {
    return !this.root.hidden;
  }
  open() {
    this.root.hidden = false;
    this.revealed.clear();
    this.sourcePage = null;
    this.render();
    requestAnimationFrame(() => {
      if (!this.isOpen) return;
      this.restorePosition();
      this.root
        .querySelector<HTMLElement>("h1")
        ?.focus({ preventScroll: true });
    });
  }
  close() {
    this.capturePosition();
    this.persist();
    this.root.hidden = true;
    this.closeSource();
  }
  private persist() {
    try {
      localStorage.setItem(this.readerKey, JSON.stringify(this.state));
    } catch {
      this.options.notify("대본 읽던 위치를 저장할 공간이 부족해요");
    }
  }
  private get scroller() {
    return this.root.querySelector<HTMLElement>(".line-script");
  }
  private get sceneMenuOpen() {
    return (
      this.root.querySelector<HTMLElement>(".line-scene-menu")?.hidden === false
    );
  }
  private setSceneMenu(open: boolean) {
    const menu = this.root.querySelector<HTMLElement>(".line-scene-menu")!;
    menu.hidden = !open;
    this.root
      .querySelector('[data-line-action="scenes"]')
      ?.setAttribute("aria-expanded", String(open));
    if (open)
      menu
        .querySelector<HTMLButtonElement>(
          `[data-line-scene="${this.currentScene}"]`,
        )
        ?.focus();
    else
      this.root
        .querySelector<HTMLButtonElement>('[data-line-action="scenes"]')
        ?.focus({ preventScroll: true });
  }
  private capturePosition() {
    const scroller = this.scroller;
    if (!scroller || !this.isOpen) return;
    const top = scroller.getBoundingClientRect().top;
    let low = 0,
      high = this.anchors.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.anchors[mid].getBoundingClientRect().top <= top + 8) low = mid;
      else high = mid - 1;
    }
    const anchor = this.anchors[low];
    if (!anchor) return;
    this.state.anchor = anchor.dataset.anchor!;
    this.state.offset = Math.max(0, top - anchor.getBoundingClientRect().top);
    this.currentPage = Number(anchor.dataset.page);
    this.currentScene = anchor.dataset.scene!;
    this.updateToolbar();
  }
  private restorePosition() {
    const scroller = this.scroller;
    const anchor = this.anchors.find(
      (a) => a.dataset.anchor === this.state.anchor,
    );
    if (scroller && anchor)
      scroller.scrollTop +=
        anchor.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        this.state.offset;
    this.capturePosition();
  }
  private jump(sceneId: string) {
    if (!deck.scenes.some((s) => s.id === sceneId)) return;
    this.state.anchor = sceneId;
    this.state.offset = 0;
    this.restorePosition();
    this.persist();
    this.setSceneMenu(false);
  }
  private updateToolbar() {
    const scene = deck.scenes.find((s) => s.id === this.currentScene)!;
    const caption = this.root.querySelector("#line-scene-caption");
    if (caption) caption.textContent = `${scene.number}장 · ${scene.title}`;
    const page = this.root.querySelector('[data-line-action="source"] span');
    if (page) page.textContent = `${this.currentPage}쪽`;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>(
      "[data-line-scene]",
    ))
      button.setAttribute(
        "aria-current",
        String(button.dataset.lineScene === this.currentScene),
      );
  }
  private act(command: string) {
    switch (command) {
      case "exit":
        this.options.exit();
        return;
      case "scenes":
        this.setSceneMenu(!this.sceneMenuOpen);
        return;
      case "scene-close":
        this.setSceneMenu(false);
        return;
      case "conceal": {
        this.capturePosition();
        this.state.concealed = !this.state.concealed;
        this.revealed.clear();
        this.persist();
        this.render();
        this.restorePosition();
        this.root
          .querySelector<HTMLButtonElement>('[data-line-action="conceal"]')
          ?.focus({ preventScroll: true });
        return;
      }
      case "source":
        this.showSource(this.currentPage - 1);
        return;
      case "source-close":
        this.closeSource();
        return;
      case "source-prev":
        if (this.sourcePage !== null) this.showSource(this.sourcePage - 1);
        return;
      case "source-next":
        if (this.sourcePage !== null) this.showSource(this.sourcePage + 1);
        return;
    }
  }
  private partHtml(row: ScriptRow, index: number) {
    const part = row.parts[index];
    if (!part.own) return escape(part.text);
    if (!this.state.concealed) return `<mark>${escape(part.text)}</mark>`;
    const revealed = this.revealed.has(row.turnId);
    return `<button type="button" class="line-own-text ${revealed ? "is-revealed" : ""}" data-line-turn="${row.turnId}" data-line-part="${row.id}:${index}" aria-label="${revealed ? "이 대사 가리기" : "이 대사 보기"}" aria-pressed="${revealed}">${escape(revealed ? part.text : part.text.replace(/[^\s]/gu, "●"))}</button>`;
  }
  private toggleTurn(turnId: string) {
    this.capturePosition();
    if (this.revealed.has(turnId)) this.revealed.delete(turnId);
    else this.revealed.add(turnId);
    for (const row of deck.script.filter((r) => r.turnId === turnId)) {
      for (let i = 0; i < row.parts.length; i++) {
        const button = this.root.querySelector<HTMLElement>(
          `[data-line-part="${row.id}:${i}"]`,
        );
        if (button) button.outerHTML = this.partHtml(row, i);
      }
    }
    this.restorePosition();
    this.root
      .querySelector<HTMLButtonElement>(`[data-line-turn="${turnId}"]`)
      ?.focus({ preventScroll: true });
  }
  private render() {
    this.root.innerHTML = `<header class="line-header">${action("exit", "연습실로 돌아가기", ArrowLeft)}<div><h1 tabindex="-1">선관 대사 연습</h1><p>선관 · 무당 · 아저씨 · 백작</p></div></header>
      <nav class="line-toolbar" aria-label="대본 도구"><button type="button" data-line-action="scenes" aria-label="장면 선택" aria-expanded="false" aria-controls="line-scene-menu">${icon(List)}<span id="line-scene-caption"></span></button><div>${action("conceal", this.state.concealed ? "내 대사 모두 보기" : "내 대사 모두 가리기", this.state.concealed ? EyeOff : Eye, "내 대사")}${action("source", "원문 대본 보기", BookOpen, `${this.currentPage}쪽`)}</div></nav>
      <aside id="line-scene-menu" class="line-scene-menu" aria-label="장면 목록" hidden><header><strong>장면 선택</strong>${action("scene-close", "장면 목록 닫기", X)}</header>${deck.scenes.map((s) => `<button type="button" data-line-scene="${s.id}"><span class="line-scene-number">${String(s.number).padStart(2, "0")}</span><span>${escape(s.title)}</span>${s.count ? '<i aria-label="선관 출연"></i>' : ""}</button>`).join("")}</aside>
      <main class="line-script" aria-label="연속 대본" tabindex="0"><div class="line-document"><p class="line-reader-note">내 대사를 가리려면 ${icon(Eye)} · 가린 대사는 눌러서 확인</p>${deck.scenes
        .map((scene) => {
          let previousTurn = "";
          let previousPage = scene.page;
          return `<section class="line-scene-section" aria-labelledby="line-title-${scene.id}"><h2 id="line-title-${scene.id}" data-anchor="${scene.id}" data-scene="${scene.id}" data-page="${scene.page}"><small>${scene.number}장</small>${escape(scene.title)}</h2>${deck.script
            .filter((row) => row.sceneId === scene.id)
            .map((row) => {
              const speaker =
                row.kind === "speech" && row.turnId !== previousTurn;
              const newPage = row.page !== previousPage;
              previousTurn = row.turnId;
              previousPage = row.page;
              return `<div class="line-block line-${row.kind} ${speaker ? "line-turn-start" : ""}" data-anchor="${row.id}" data-scene="${row.sceneId}" data-page="${row.page}">${newPage ? `<small class="line-page-marker">${row.page}쪽</small>` : ""}${speaker ? `<b class="line-speaker">${escape(row.speaker)}</b>` : ""}<p>${row.parts.map((_, i) => this.partHtml(row, i)).join("")}</p></div>`;
            })
            .join("")}</section>`;
        })
        .join("")}<p class="line-end">끝</p></div></main>
      <section class="line-source" aria-label="원문 대본" hidden><header>${action("source-close", "원문 닫기", X)}<span id="line-source-page"></span><div>${action("source-prev", "원문 이전 페이지", ChevronLeft)}${action("source-next", "원문 다음 페이지", ChevronRight)}</div></header><div class="paper-viewport" id="line-source-paper"></div></section>`;
    this.root
      .querySelector('[data-line-action="conceal"]')
      ?.setAttribute("aria-pressed", String(this.state.concealed));
    this.anchors = [
      ...this.root.querySelectorAll<HTMLElement>("[data-anchor]"),
    ];
    this.paper = undefined;
    this.updateToolbar();
  }
  private showSource(page: number) {
    if (page < 0 || page >= 79) return;
    this.setSceneMenu(false);
    this.sourcePage = page;
    const overlay = this.root.querySelector<HTMLElement>(".line-source")!;
    overlay.hidden = false;
    for (const child of this.root.children)
      if (child instanceof HTMLElement && child !== overlay) child.inert = true;
    this.root.querySelector("#line-source-page")!.textContent =
      `${page + 1} / 79`;
    this.root.querySelector<HTMLButtonElement>(
      '[data-line-action="source-prev"]',
    )!.disabled = page === 0;
    this.root.querySelector<HTMLButtonElement>(
      '[data-line-action="source-next"]',
    )!.disabled = page === 78;
    if (!this.paper) {
      this.paper = new Paper(this.root.querySelector("#line-source-paper")!);
      this.paper.onPage = (direction) =>
        this.showSource((this.sourcePage ?? page) + direction);
    }
    void this.paper.show("script.pdf", page, this.options.marks(page));
    this.root
      .querySelector<HTMLButtonElement>('[data-line-action="source-close"]')!
      .focus({ preventScroll: true });
  }
  private closeSource() {
    const overlay = this.root.querySelector<HTMLElement>(".line-source");
    if (overlay) overlay.hidden = true;
    for (const child of this.root.children)
      if (child instanceof HTMLElement) child.inert = false;
    this.sourcePage = null;
    if (this.isOpen)
      this.root
        .querySelector<HTMLButtonElement>('[data-line-action="source"]')
        ?.focus({ preventScroll: true });
  }
}
