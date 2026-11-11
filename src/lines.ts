import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Lightbulb,
  RotateCcw,
  X,
  createElement,
  type IconNode,
} from "lucide";
import rawDeck from "./data/seonkwan-lines.json";
import { Paper } from "./pdf";
import type { Mark } from "./core";

export interface LineCard {
  id: string;
  sceneId: string;
  speaker: string;
  kind: string;
  song: number | null;
  answer: string;
  directions: string[];
  cueSpeaker: string;
  cue: string;
  pages: number[];
  regionIds: string[];
}
interface Deck {
  scenes: {
    id: string;
    number: number;
    title: string;
    page: number;
    count: number;
  }[];
  cards: LineCard[];
}
interface PracticeState {
  records: Record<string, "again" | "known">;
  queue: string[];
  index: number;
  view: "home" | "card" | "done";
  sceneId: string;
  review: boolean;
}
const deck: Deck = rawDeck;
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
const action = (
  id: string,
  label: string,
  node: IconNode,
  caption = "",
  extra = "",
) =>
  `<button type="button" data-line-action="${id}" aria-label="${label}" title="${label}" ${extra}>${icon(node)}${caption ? `<span>${caption}</span>` : ""}</button>`;

export function lineHint(answer: string, level: number) {
  if (level >= 3) return answer;
  const words = answer.trim().split(/\s+/);
  if (level === 1) return words[0];
  const firstLine = answer.split("\n")[0];
  if (firstLine !== answer) return firstLine;
  return words.slice(0, Math.max(1, Math.ceil(words.length / 2))).join(" ");
}

export class LinePractice {
  readonly root: HTMLElement;
  readonly cards = new Map(deck.cards.map((card) => [card.id, card]));
  private state: PracticeState = {
    records: {},
    queue: [],
    index: 0,
    view: "home",
    sceneId: "",
    review: false,
  };
  private revealed = 0;
  private sourcePage: number | null = null;
  private paper?: Paper;
  constructor(
    root: HTMLElement,
    private key: string,
    private options: {
      exit: () => void;
      marks: (page: number) => Mark[];
      notify: (text: string) => void;
    },
  ) {
    this.root = root;
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) || "null");
      if (saved && typeof saved === "object") {
        if (
          "records" in saved &&
          saved.records &&
          typeof saved.records === "object"
        )
          for (const [id, value] of Object.entries(saved.records))
            if (this.cards.has(id) && (value === "again" || value === "known"))
              this.state.records[id] = value;
        if ("queue" in saved && Array.isArray(saved.queue))
          this.state.queue = [
            ...new Set(
              saved.queue.filter(
                (id): id is string =>
                  typeof id === "string" && this.cards.has(id),
              ),
            ),
          ];
        if (
          "index" in saved &&
          typeof saved.index === "number" &&
          Number.isInteger(saved.index)
        )
          this.state.index = Math.max(
            0,
            Math.min(saved.index, this.state.queue.length - 1),
          );
        if (
          "sceneId" in saved &&
          typeof saved.sceneId === "string" &&
          deck.scenes.some((s) => s.id === saved.sceneId)
        )
          this.state.sceneId = saved.sceneId;
        if ("review" in saved && typeof saved.review === "boolean")
          this.state.review = saved.review;
        if (
          "view" in saved &&
          (saved.view === "card" || saved.view === "done") &&
          this.state.queue.length
        )
          this.state.view = saved.view;
      }
    } catch {
      /* Ignore only this feature's invalid progress; rehearsal data is separate. */
    }
    root.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>("button");
      if (!button || button.disabled) return;
      if (button.dataset.lineScene) this.start(button.dataset.lineScene);
      else if (button.dataset.lineAction) this.act(button.dataset.lineAction);
    });
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
      if (
        !this.isOpen ||
        (event.target instanceof Element &&
          event.target.matches("input,textarea,select"))
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (this.sourcePage !== null) this.closeSource();
        else if (this.state.view !== "home") this.act("home");
        else this.options.exit();
      } else if (this.sourcePage === null && this.state.view === "card") {
        if (
          event.key === " " &&
          event.target instanceof Element &&
          event.target.closest("button")
        )
          return;
        const keys: Record<string, string> = {
          " ": this.revealed < 3 ? "answer" : "next",
          ArrowRight: "next",
          ArrowLeft: "prev",
          h: "hint",
          "1": "again",
          "2": "known",
        };
        const command = keys[event.key];
        if (command) {
          event.preventDefault();
          this.act(command);
        }
      }
    });
  }
  get isOpen() {
    return !this.root.hidden;
  }
  open() {
    this.root.hidden = false;
    this.revealed = 0;
    this.sourcePage = null;
    this.render();
    this.focusHeading();
  }
  close() {
    this.root.hidden = true;
    this.closeSource();
  }
  private persist() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.state));
    } catch {
      this.options.notify("대사 연습 기록을 저장할 공간이 부족해요");
    }
  }
  private reviewIds() {
    return deck.cards
      .filter((c) => this.state.records[c.id] === "again")
      .map((c) => c.id);
  }
  private current() {
    return this.cards.get(this.state.queue[this.state.index]);
  }
  private start(sceneId: string) {
    const queue =
      sceneId === "review"
        ? this.reviewIds()
        : deck.cards.filter((c) => c.sceneId === sceneId).map((c) => c.id);
    if (!queue.length) return;
    this.state.queue = queue;
    this.state.sceneId = sceneId === "review" ? "" : sceneId;
    this.state.review = sceneId === "review";
    this.state.index = 0;
    this.state.view = "card";
    this.revealed = 0;
    this.persist();
    this.render();
    this.focusHeading();
  }
  private act(command: string) {
    const card = this.current();
    switch (command) {
      case "exit":
        this.options.exit();
        return;
      case "home":
        this.state.view = "home";
        break;
      case "review":
        this.start("review");
        return;
      case "restart":
        this.state.index = 0;
        this.state.view = "card";
        this.revealed = 0;
        break;
      case "hint":
        this.revealed = Math.min(3, this.revealed + 1);
        break;
      case "answer":
        this.revealed = 3;
        break;
      case "again":
      case "known":
        if (!card || this.revealed < 3) return;
        this.state.records[card.id] = command;
        this.next();
        break;
      case "next":
        this.next();
        break;
      case "prev":
        this.state.index = Math.max(0, this.state.index - 1);
        this.revealed = 0;
        break;
      case "source":
        if (card) this.showSource(card.pages[0] - 1);
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
      default:
        return;
    }
    this.persist();
    this.render();
    if (["again", "known", "next", "prev", "home"].includes(command))
      this.focusHeading();
  }
  private next() {
    if (this.state.index + 1 >= this.state.queue.length)
      this.state.view = "done";
    else this.state.index++;
    this.revealed = 0;
  }
  private focusHeading() {
    requestAnimationFrame(() =>
      this.root
        .querySelector<HTMLElement>("h1,h2")
        ?.focus({ preventScroll: true }),
    );
  }
  private render() {
    const review = this.reviewIds().length;
    const scene = deck.scenes.find((s) => s.id === this.state.sceneId);
    const card = this.current();
    const cardScene = deck.scenes.find((s) => s.id === card?.sceneId);
    const header = `<header class="line-header">${action("exit", "연습실로 돌아가기", ArrowLeft)}<div><h1 tabindex="-1">선관 대사 연습</h1><p>선관 · 무당 · 아저씨 · 백작</p></div><span class="line-total">${deck.cards.length}개</span></header>`;
    let content: string;
    if (this.state.view === "home") {
      content = `<main class="line-home"><div class="line-home-top"><div><h2 tabindex="-1">어느 장면을 연습할까요?</h2><p>앞 대사를 보고, 가린 내 대사를 말해 보세요.</p></div><button data-line-action="review" class="line-review" ${review ? "" : "disabled"}>${icon(RotateCcw)}복습 <b>${review}</b></button></div><div class="line-scenes">${deck.scenes
        .map((s) => {
          const known = deck.cards.filter(
            (c) => c.sceneId === s.id && this.state.records[c.id] === "known",
          ).length;
          return `<button class="line-scene" data-line-scene="${s.id}" ${s.count ? "" : "disabled"}><span class="line-scene-number">${String(s.number).padStart(2, "0")}</span><span class="line-scene-title"><strong>${escape(s.title)}</strong><small>${s.count ? `${s.count}개 · 외웠음 ${known}` : "선관 대사 없음"}</small></span>${icon(ChevronRight)}</button>`;
        })
        .join(
          "",
        )}</div><p class="line-local-note">진도와 복습 목록은 이 기기에 저장돼요.</p></main>`;
    } else if (this.state.view === "done") {
      const known = this.state.queue.filter(
        (id) => this.state.records[id] === "known",
      ).length;
      const again = this.state.queue.filter(
        (id) => this.state.records[id] === "again",
      ).length;
      content = `<main class="line-done"><div class="line-done-mark">${icon(Check)}</div><h2 tabindex="-1">${this.state.review ? "복습" : `${scene?.number || ""}장`} 한 바퀴 끝</h2><p>외웠음 ${known} · 다시 ${again} · 미확인 ${this.state.queue.length - known - again}</p><div class="line-done-actions"><button data-line-action="review" class="line-primary" ${review ? "" : "disabled"}>${icon(RotateCcw)}어려운 대사 복습 <b>${review}</b></button><button data-line-action="restart">${icon(RotateCcw)}처음부터</button><button data-line-action="home">${icon(BookOpen)}장면 선택</button></div></main>`;
    } else if (card) {
      const progress = Math.round(
        ((this.state.index + 1) / this.state.queue.length) * 100,
      );
      const answer = this.revealed
        ? escape(lineHint(card.answer, this.revealed))
        : "";
      content = `<nav class="line-nav">${action("home", "장면 선택", BookOpen)}<div><h2 tabindex="-1">${this.state.review ? "어려운 대사 복습" : `${cardScene?.number}장 · ${escape(cardScene?.title || "")}`}</h2><span>${this.state.index + 1} / ${this.state.queue.length}</span></div>${action("source", "원문 대본 보기", BookOpen, `${card.pages[0]}쪽`)}</nav><div class="line-progress" role="progressbar" aria-label="현재 대사" aria-valuenow="${this.state.index + 1}" aria-valuemin="1" aria-valuemax="${this.state.queue.length}"><i style="width:${progress}%"></i></div><main class="line-reading"><section class="line-cue" aria-label="앞 대사"><div class="line-card-label"><span>앞 대사</span><b>${escape(card.cueSpeaker)}</b></div><p>${escape(card.cue || "이 장면의 첫 대사예요.")}</p></section><section class="line-own" aria-label="내 대사"><div class="line-card-label"><b>${escape(card.speaker)}</b><span>${card.kind}${card.song ? ` · No.${card.song}` : ""}</span></div>${card.directions.length ? `<p class="line-direction">(${escape(card.directions.join(" · "))})</p>` : ""}<div class="line-answer ${this.revealed === 3 ? "is-revealed" : ""}" aria-live="polite">${this.revealed ? `<small>${this.revealed === 1 ? "첫 단어" : this.revealed === 2 ? "한 구절" : "정답"}</small><p>${answer}${this.revealed < 3 && answer !== escape(card.answer) ? '<span class="line-ellipsis"> …</span>' : ""}</p>` : `<button class="line-concealed" data-line-action="answer" aria-label="가린 대사 정답 보기">${icon(Eye)}<span>내 차례</span><small>말해 보고 정답을 확인하세요</small></button>`}</div></section></main><footer class="line-footer"><div class="line-hints">${action("prev", "이전 대사", ChevronLeft, "", this.state.index === 0 ? "disabled" : "")}${action("hint", this.revealed === 0 ? "첫 단어 힌트" : this.revealed === 1 ? "한 구절 힌트" : "힌트 정답 보기", Lightbulb, this.revealed === 0 ? "첫 단어" : this.revealed === 1 ? "한 구절" : "힌트", this.revealed >= 3 ? "disabled" : "")}${action("answer", "전체 정답 보기", Eye, "정답", this.revealed >= 3 ? "disabled" : "")}${action("next", "다음 대사", ChevronRight)}</div><div class="line-grades"><button data-line-action="again" ${this.revealed < 3 ? "disabled" : ""}>${icon(RotateCcw)}다시</button><button data-line-action="known" class="line-primary" ${this.revealed < 3 ? "disabled" : ""}>${icon(Check)}외웠음</button></div></footer>`;
    } else {
      this.state.view = "home";
      this.render();
      return;
    }
    this.root.innerHTML =
      header +
      content +
      `<section class="line-source" aria-label="원문 대본" hidden><header>${action("source-close", "원문 닫기", X)}<span id="line-source-page"></span><div>${action("source-prev", "원문 이전 페이지", ChevronLeft)}${action("source-next", "원문 다음 페이지", ChevronRight)}</div></header><div class="paper-viewport" id="line-source-paper"></div></section>`;
    this.paper = undefined;
  }
  private showSource(page: number) {
    if (page < 0 || page >= 79) return;
    this.sourcePage = page;
    const overlay = this.root.querySelector<HTMLElement>(".line-source")!;
    overlay.hidden = false;
    // Inert only the underlying practice page; its original answer stays hidden.
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
