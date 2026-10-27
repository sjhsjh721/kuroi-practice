import "./style.css";
import {
  createElement,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Columns2,
  FileMusic,
  FileText,
  FilePenLine,
  Scan,
  Repeat2,
  RotateCcw,
  RotateCw,
  Download,
  Settings2,
  Users,
  Check,
  X,
  Volume2,
  BookmarkPlus,
  List,
  Upload,
  Save,
  WifiOff,
  Highlighter,
  RefreshCw,
  HelpCircle,
  type IconNode,
} from "lucide";
import {
  Song,
  Track,
  Cue,
  Profile,
  Mark,
  Region,
  mergedCues,
  pagesAt,
  hitNote,
  timingPath,
  token,
  clock,
  megabytes,
  validateBackup,
} from "./core";
import { OfflineLibrary } from "./offline";
import { Paper, openLocalPdf } from "./pdf";
import { ScriptStore, type PersonalScript } from "./personal";
import { appBase } from "./paths";
const iconNodes: Record<string, IconNode> = {
  play: Play,
  pause: Pause,
  prev: ChevronLeft,
  next: ChevronRight,
  full: Maximize,
  exit: Minimize,
  both: Columns2,
  score: FileMusic,
  script: FileText,
  edit: FilePenLine,
  fit: Scan,
  repeat: Repeat2,
  back: RotateCcw,
  forward: RotateCw,
  download: Download,
  tools: Settings2,
  role: Users,
  check: Check,
  close: X,
  volume: Volume2,
  cue: BookmarkPlus,
  list: List,
  upload: Upload,
  save: Save,
  offline: WifiOff,
  highlight: Highlighter,
  refresh: RefreshCw,
  help: HelpCircle,
};
const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const svg = (name: string) =>
  createElement(iconNodes[name] || HelpCircle, {
    "aria-hidden": "true",
    width: 20,
    height: 20,
    "stroke-width": 1.8,
  }).outerHTML;
const button = (
  action: string,
  label: string,
  icon: string,
  caption = "",
  extra = "",
) =>
  `<button data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${svg(icon)}${caption ? `<span>${esc(caption)}</span>` : ""}</button>`;
type Saved = {
  song: number;
  kind: string;
  part: string;
  role: string;
  seen: boolean;
  downloadPrompted: boolean;
  highlight: boolean;
  mode: number;
  fullscreen: boolean;
  lead: number;
  rate: number;
  volume: number;
  positions: Record<string, number>;
  custom: Record<string, Cue[]>;
  hidden: Record<string, string[]>;
};
const defaults: Saved = {
  song: 0,
  kind: "MR",
  part: "",
  role: "",
  seen: false,
  downloadPrompted: false,
  highlight: true,
  mode: innerWidth < 600 ? 2 : 0,
  fullscreen: false,
  lead: 1.5,
  rate: 1,
  volume: 0.9,
  positions: {},
  custom: {},
  hidden: {},
};
const isolated = new URLSearchParams(location.search).has("verification");
const storageKey = isolated ? "kuroi-pwa-verification" : "kuroi-pwa-v1";
const scriptStore = new ScriptStore(isolated);
let personalScript: PersonalScript | undefined;
let personalPdf: Awaited<ReturnType<typeof openLocalPdf>> | undefined;
let saved: Saved = { ...defaults };
try {
  saved = {
    ...defaults,
    ...JSON.parse(localStorage.getItem(storageKey) || "{}"),
  };
} catch {}
const save = () => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    notify("연습 기록을 저장할 공간이 부족합니다");
  }
};
const offline = new OfflineLibrary();
const audio = new Audio();
audio.preload = "metadata";
audio.crossOrigin = "anonymous";
audio.preservesPitch = true;
let catalog: { songs: Song[]; tracks: Track[]; scriptPages: number },
  tracks: Track[],
  timeline: { tracks: Record<string, { cues: Cue[]; durationMs: number }> },
  navigation: {
    songs: Record<string, { pages: { regions: Region[] }[] }>;
    tracks: Record<string, { times: number[] }>;
  },
  highlights: { profiles: Profile[]; documents: Record<string, Mark[][]> };
let songIndex = 0,
  track: Track,
  scorePage = 0,
  scriptPage = 0,
  follow = true,
  ready = false,
  duration = 1,
  pendingSeek: number | null = null,
  loopA = 0,
  loopB: number | null = null,
  loop = false,
  toastTimer: number,
  downloadPaths: string[] = [],
  panelActions = new Map<string, () => void>(),
  panelTitle = "",
  isSeeking = false,
  lastSave = 0,
  audioContext: AudioContext | undefined,
  gain: GainNode | undefined;
let score: Paper, script: Paper;
const root = document.querySelector<HTMLElement>("#app")!;
function notify(message: string) {
  const toast = document.querySelector<HTMLElement>("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 2600);
}
function currentSong() {
  return catalog.songs[songIndex];
}
function currentCues() {
  return mergedCues(
    timeline.tracks[timingPath(track)].cues,
    saved.custom[track.path] || [],
    saved.hidden[track.path] || [],
  );
}
function roleMarks(path: string, page: number) {
  const bit = 1 << highlights.profiles.findIndex((p) => p.id === saved.role);
  return saved.highlight && saved.role
    ? (highlights.documents[path]?.[page] || []).filter((m) => m.roles & bit)
    : [];
}
function persistPosition() {
  if (track && ready) {
    saved.positions[track.path] = audio.currentTime;
    save();
  }
}
function pause() {
  audio.pause();
  persistPosition();
  transport();
}
function selectTrack(t: Track) {
  pause();
  track = t;
  ready = false;
  loop = false;
  loopA = 0;
  loopB = null;
  follow = true;
  saved.kind = t.type;
  saved.part = t.role;
  saved.positions[t.path] ??= 0;
  pendingSeek = saved.positions[t.path];
  duration = (timeline.tracks[timingPath(t)].durationMs || 1000) / 1000;
  audio.src = offline.url(t.path);
  audio.load();
  audio.playbackRate = saved.rate;
  audio.volume = audioContext ? 1 : saved.volume;
  applyCue(pendingSeek);
  save();
  update();
}
function chooseSong(index: number) {
  if (index < 0 || index >= catalog.songs.length) return;
  persistPosition();
  songIndex = index;
  saved.song = index;
  scorePage = 0;
  scriptPage = currentSong().scriptPage - 1;
  const available = tracks.filter((t) => t.number === currentSong().number);
  selectTrack(
    available.find(
      (t) => t.type === saved.kind && (!t.role || t.role === saved.part),
    ) ||
      available.find((t) => t.type === "MR") ||
      available[0],
  );
}
function prepareAudio() {
  if (!audioContext) {
    audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(audio);
    gain = audioContext.createGain();
    source.connect(gain);
    gain.connect(audioContext.destination);
  }
  gain!.gain.value = saved.volume;
  audio.volume = 1;
  if (audioContext.state !== "running") void audioContext.resume();
}
async function play() {
  try {
    prepareAudio();
    if (audio.currentTime >= duration - 0.05) seek(0);
    await audio.play();
    transport();
  } catch {
    notify(
      navigator.onLine
        ? "재생을 시작할 수 없어요 · 재생을 다시 눌러 주세요"
        : "이 음원은 저장되지 않았어요 · 연결 후 다운로드하세요",
    );
  }
}
function seek(seconds: number, control = false) {
  const time = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.01));
  if (control && loop && (time < loopA || time >= (loopB ?? duration)))
    loop = false;
  if (ready) {
    audio.currentTime = time;
    pendingSeek = null;
  } else pendingSeek = time;
  if (follow) applyCue(time);
  transport();
  persistPosition();
}
function applyCue(position = audio.currentTime) {
  const p = pagesAt(
    currentCues(),
    position * 1000,
    saved.lead * 1000,
    currentSong().scriptPage - 1,
  );
  if (scorePage !== p.score || scriptPage !== p.script) {
    scorePage = p.score;
    scriptPage = p.script;
    documents();
  }
}
function documents() {
  const song = currentSong();
  document.querySelector("#score-page")!.textContent =
    `${scorePage + 1} / ${song.pages}`;
  document.querySelector("#script-page")!.textContent =
    `${scriptPage + 1} / ${catalog.scriptPages}`;
  if (saved.mode !== 1)
    void score.show(song.score, scorePage, roleMarks(song.score, scorePage));
  if (saved.mode !== 2)
    void script.show(
      personalScript?.active && personalPdf ? personalPdf.path : "script.pdf",
      scriptPage,
      roleMarks("script.pdf", scriptPage),
    );
  for (const kind of ["score", "script"]) {
    const page = kind === "score" ? scorePage : scriptPage,
      count = kind === "score" ? song.pages : catalog.scriptPages;
    (
      document.querySelector(
        `[data-action="${kind}-prev"]`,
      ) as HTMLButtonElement
    ).disabled = page === 0;
    (
      document.querySelector(
        `[data-action="${kind}-next"]`,
      ) as HTMLButtonElement
    ).disabled = page === count - 1;
  }
}
function manualPage(kind: string, value: number) {
  const isScore = kind === "score",
    count = isScore ? currentSong().pages : catalog.scriptPages;
  if (value < 0 || value >= count) return;
  follow = false;
  if (isScore) scorePage = value;
  else scriptPage = value;
  documents();
  transport();
}
function tapScore(x: number, y: number) {
  const ms = hitNote(
    navigation.songs[String(currentSong().number)].pages[scorePage].regions,
    navigation.tracks[timingPath(track)].times,
    x,
    y,
  );
  if (ms === undefined) return;
  if (ms < 0) {
    notify("이 화음에 포함되지 않은 구간입니다");
    return;
  }
  loop = false;
  follow = true;
  seek(ms / 1000);
  void play();
  const paper = score.sheet;
  paper.classList.add("tapped");
  window.setTimeout(() => paper.classList.remove("tapped"), 450);
}
function transport() {
  if (!track) return;
  const position = pendingSeek ?? audio.currentTime;
  document.querySelector("#current-time")!.textContent = clock(position);
  document.querySelector("#duration")!.textContent = clock(duration);
  const seekbar = document.querySelector<HTMLInputElement>("#seek")!;
  seekbar.max = String(duration);
  if (!isSeeking) seekbar.value = String(position);
  seekbar.setAttribute(
    "aria-valuetext",
    `${clock(position)} / ${clock(duration)}`,
  );
  const b = document.querySelector<HTMLButtonElement>(
    '[data-action="toggle"]',
  )!;
  b.innerHTML = svg(audio.paused ? "play" : "pause");
  b.setAttribute("aria-label", audio.paused ? "재생" : "일시정지");
  document
    .querySelector('[data-action="follow"]')!
    .classList.toggle("active", follow);
  document.querySelector("#follow-label")!.textContent = follow
    ? "자동"
    : "수동";
  document
    .querySelector('[data-action="repeat"]')!
    .classList.toggle("active", loop);
}
function update() {
  const song = currentSong();
  root.classList.toggle("fullscreen", saved.fullscreen);
  root.dataset.mode = String(saved.mode);
  document.querySelector("#song-title")!.textContent =
    `${String(song.number).padStart(2, "0")}  ${song.title}`;
  document.querySelector("#audio-title")!.textContent =
    track.type + (track.role ? " · " + track.role : "");
  document.querySelector("#role-label")!.textContent = saved.role || "배역";
  document.querySelector("#rate-label")!.textContent = `${saved.rate}×`;
  document.querySelector("#lead-label")!.textContent = `−${saved.lead}s`;
  document.querySelector('[data-action="fullscreen"]')!.innerHTML = svg(
    saved.fullscreen ? "exit" : "full",
  );
  document
    .querySelector('[data-action="fullscreen"]')!
    .setAttribute(
      "aria-label",
      saved.fullscreen ? "전체화면 나가기" : "전체화면",
    );
  (
    document.querySelector('[data-action="prev-song"]') as HTMLButtonElement
  ).disabled = songIndex === 0;
  (
    document.querySelector('[data-action="next-song"]') as HTMLButtonElement
  ).disabled = songIndex === catalog.songs.length - 1;
  document
    .querySelectorAll<HTMLElement>("[data-number]")
    .forEach((e) =>
      e.classList.toggle("selected", Number(e.dataset.number) === songIndex),
    );
  document.querySelectorAll<HTMLElement>("[data-mode]").forEach((e) => {
    const selected = Number(e.dataset.mode) === saved.mode;
    e.classList.toggle("active", selected);
    e.setAttribute("aria-pressed", String(selected));
  });
  requestAnimationFrame(() => {
    score.resize();
    script.resize();
    documents();
  });
  transport();
}
function row(
  title: string,
  detail: string,
  action: () => void,
  selected = false,
  icon = "",
) {
  const id = String(panelActions.size);
  panelActions.set(id, action);
  return `<button class="option ${selected ? "selected" : ""}" data-option="${id}">${icon ? svg(icon) : ""}<span><strong>${esc(title)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</span>${selected ? svg("check") : svg("next")}</button>`;
}
function showPanel(title: string, content: () => string) {
  panelActions.clear();
  panelTitle = title;
  const overlay = document.querySelector<HTMLElement>("#overlay")!;
  overlay.innerHTML = `<section class="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title"><header><h2 id="panel-title">${esc(title)}</h2>${button("close", "닫기", "close")}</header><div class="options">${content()}</div></section>`;
  overlay.hidden = false;
  overlay
    .querySelectorAll<HTMLAnchorElement>('a[href^="/licenses/"]')
    .forEach(
      (a) => (a.href = new URL(a.getAttribute("href")!.slice(1), appBase).href),
    );
  root.querySelector<HTMLElement>(".workspace")!.inert = true;
  document.querySelector<HTMLElement>("#chrome")!.inert = true;
  document.querySelector<HTMLElement>("#transport")!.inert = true;
  document.querySelector<HTMLElement>("#download-suggestion")!.inert = true;
  requestAnimationFrame(() =>
    overlay.querySelector<HTMLElement>("button,input")?.focus(),
  );
}
function closePanel() {
  document.querySelector<HTMLElement>("#overlay")!.hidden = true;
  root.querySelector<HTMLElement>(".workspace")!.inert = false;
  document.querySelector<HTMLElement>("#chrome")!.inert = false;
  document.querySelector<HTMLElement>("#transport")!.inert = false;
  document.querySelector<HTMLElement>("#download-suggestion")!.inert = false;
  panelTitle = "";
  document.querySelector<HTMLElement>('[data-action="tools"]')?.focus();
}
function chooseRole() {
  showPanel(
    "내 배역",
    () =>
      `<p class="hint">함께 맡는 인물까지 형광으로 표시해요</p><div class="role-grid">${highlights.profiles
        .map((p) =>
          row(
            p.name,
            p.characters.join(" · "),
            () => {
              saved.role = p.id;
              saved.seen = true;
              saved.highlight = true;
              save();
              closePanel();
              update();
              void recommendDownload();
            },
            saved.role === p.id,
            "role",
          ),
        )
        .join("")}</div>` +
      row(
        saved.highlight ? "형광 끄기" : "형광 켜기",
        "",
        () => {
          saved.highlight = !saved.highlight;
          save();
          closePanel();
          documents();
        },
        false,
        "highlight",
      ) +
      (!saved.seen
        ? row("나중에 선택", "", () => {
            saved.seen = true;
            save();
            closePanel();
            void recommendDownload();
          })
        : ""),
  );
}
function personalScriptMenu() {
  showPanel(
    "내 메모 대본",
    () =>
      `<p class="hint">이 기기에만 저장해요. 자동 넘김·형광 표시를 위해 원본 ${catalog.scriptPages}쪽의 순서와 배치를 유지한 PDF를 선택하세요.</p>` +
      (personalScript
        ? row(
            "내 대본 사용",
            personalScript.name,
            () => void usePersonalScript(true),
            personalScript.active,
            "edit",
          )
        : "") +
      row(
        "원본 대본 사용",
        "공유 대본",
        () => void usePersonalScript(false),
        !personalScript?.active,
        "script",
      ) +
      row(
        personalScript ? "PDF 바꾸기" : "PDF 선택",
        "메모·필기가 담긴 PDF · 50MB 이하",
        () => document.querySelector<HTMLInputElement>("#script-file")!.click(),
        false,
        "upload",
      ),
  );
}
function scriptLabel() {
  const button = document.querySelector<HTMLButtonElement>(
    '[data-action="personal-script"]',
  );
  if (!button) return;
  button.querySelector("span")!.textContent = personalScript?.active
    ? "내 대본"
    : "대본";
  button.title = personalScript?.active ? personalScript.name : "내 메모 대본";
}
async function usePersonalScript(active: boolean) {
  try {
    if (personalScript) {
      const next = { ...personalScript, active };
      await scriptStore.write(next);
      personalScript = next;
    }
    closePanel();
    scriptLabel();
    setMode(1);
  } catch {
    notify("대본 설정을 저장하지 못했어요 · 기기 공간을 확인해 주세요");
  }
}
async function importPersonalScript(file: File) {
  let nextPdf: Awaited<ReturnType<typeof openLocalPdf>> | undefined;
  try {
    notify("대본을 확인하는 중이에요");
    nextPdf = await openLocalPdf(file, catalog.scriptPages);
    const next = { name: file.name, blob: file, active: true };
    await scriptStore.write(next);
    const previous = personalPdf;
    personalPdf = nextPdf;
    personalScript = next;
    closePanel();
    scriptLabel();
    setMode(1);
    void previous?.dispose();
    notify("내 대본 저장 완료 · 오프라인에서도 볼 수 있어요");
  } catch (e) {
    await nextPdf?.dispose();
    notify(
      (e as Error)?.name === "QuotaExceededError"
        ? "저장 공간이 부족해요 · 기존 대본은 유지됩니다"
        : (e as Error)?.message || "내 대본을 저장하지 못했어요",
    );
  }
}
function recordingMenu() {
  showPanel("음원 선택", () =>
    tracks
      .filter((t) => t.number === currentSong().number)
      .map((t) =>
        row(
          t.type + (t.role ? " · " + t.role : ""),
          t.type === "MR+화음"
            ? "자동 정렬 미리듣기"
            : t.type === "화음"
              ? t.title
              : "",
          () => {
            selectTrack(t);
            closePanel();
          },
          track.path === t.path,
          t.type === "MR+화음" ? "role" : "score",
        ),
      )
      .join(""),
  );
}
function songsMenu() {
  showPanel("넘버 선택", () =>
    catalog.songs
      .map((s, i) =>
        row(
          `${String(s.number).padStart(2, "0")}  ${s.title}`,
          "",
          () => {
            chooseSong(i);
            closePanel();
          },
          i === songIndex,
        ),
      )
      .join(""),
  );
}
function repeatMenu() {
  showPanel(
    "구간 반복",
    () =>
      row("시작 지정", clock(loopA), () => {
        loopA = audio.currentTime;
        if (loopB === null || loopB <= loopA) {
          loopB = null;
          loop = false;
        }
        closePanel();
        transport();
      }) +
      row("끝 지정", loopB === null ? "미지정" : clock(loopB), () => {
        if (audio.currentTime < loopA + 0.5) {
          notify("시작보다 최소 0.5초 뒤에 지정하세요");
          return;
        }
        loopB = audio.currentTime;
        loop = true;
        closePanel();
        transport();
      }) +
      row("반복 해제", "", () => {
        loop = false;
        loopA = 0;
        loopB = null;
        closePanel();
        transport();
      }),
  );
}
function saveCue() {
  if (!ready) {
    notify("음원이 준비된 뒤 저장할 수 있어요");
    return;
  }
  const c = {
    ms: Math.round(audio.currentTime * 1000),
    score: scorePage,
    script: scriptPage,
  };
  saved.custom[track.path] = [
    ...(saved.custom[track.path] || []).filter(
      (x) => Math.abs(x.ms - c.ms) >= 400,
    ),
    c,
  ];
  follow = true;
  save();
  notify("현재 지점 저장");
  closePanel();
  transport();
}
function cueMenu() {
  showPanel(
    "전환 지점",
    () =>
      `<p class="hint">시각을 누르면 이동합니다. 휴지통 대신 ‘숨기기’를 눌러 제외할 수 있어요.</p>` +
      currentCues()
        .map((c) => {
          const id = "delete-" + panelActions.size;
          panelActions.set(id, () => {
            if (c.automatic) (saved.hidden[track.path] ??= []).push(token(c));
            else
              saved.custom[track.path] = (
                saved.custom[track.path] || []
              ).filter((x) => x.ms !== c.ms);
            save();
            cueMenu();
          });
          return `<div class="cue-row">${row(
            clock(c.ms / 1000),
            `악보 ${c.score + 1} · 대본 ${c.script + 1} · ${c.automatic ? "자동" : "보정"}`,
            () => {
              follow = true;
              seek(c.ms / 1000);
              closePanel();
            },
          )}<button data-option="${id}" aria-label="${clock(c.ms / 1000)} 지점 숨기기">${svg("close")}</button></div>`;
        })
        .join(""),
  );
}
function confirm(title: string, detail: string, accept: () => void) {
  showPanel(
    title,
    () =>
      `<p class="hint">${esc(detail)}</p>` +
      row("취소", "", closePanel) +
      row("확인", "", () => {
        accept();
        closePanel();
      }),
  );
}
function exportBackup() {
  const entries = Object.fromEntries(
    Object.entries(saved.custom).map(([k, v]) => ["cues_" + k, v]),
  );
  const blob = new Blob(
    [JSON.stringify({ version: 1, entries, hidden: saved.hidden }, null, 2)],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kuroi-sync-backup.json";
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  notify("보정 기록 백업을 내보냈어요");
}
function tools() {
  showPanel(
    "연습 도구",
    () =>
      row(
        "현재 지점 보정",
        "지금 보이는 두 페이지를 현재 시각에 저장",
        saveCue,
        false,
        "cue",
      ) +
      row(
        "전환 지점",
        "자동 지점 숨기기 · 보정 지점 삭제",
        cueMenu,
        false,
        "list",
      ) +
      row(
        "자동 맞춤 복원",
        "현재 음원의 보정과 숨김 기록 삭제",
        () =>
          confirm(
            "자동 맞춤 복원",
            "이 음원의 보정과 숨김 기록을 지울까요?",
            () => {
              delete saved.custom[track.path];
              delete saved.hidden[track.path];
              save();
              follow = true;
              applyCue();
              transport();
            },
          ),
        false,
        "refresh",
      ) +
      row(
        "음량",
        "",
        () =>
          showPanel(
            "음량",
            () =>
              `<label class="slider-field">음원 음량 <output id="volume-value">${Math.round(saved.volume * 100)}%</output><input id="volume" type="range" min="0" max="1" step="0.01" value="${saved.volume}" aria-label="음원 음량"></label>`,
          ),
        false,
        "volume",
      ) +
      row(
        "백업 내보내기",
        "Android·iOS와 호환되는 보정 JSON",
        exportBackup,
        false,
        "save",
      ) +
      row(
        "백업 가져오기",
        "",
        () => document.querySelector<HTMLInputElement>("#backup-file")!.click(),
        false,
        "upload",
      ) +
      row(
        "내 메모 대본",
        personalScript?.active ? personalScript.name : "필기한 PDF로 바꿔 보기",
        personalScriptMenu,
        false,
        "edit",
      ) +
      row(
        "자료 다운로드",
        "오프라인으로 연습하기",
        () => void downloads(),
        false,
        "download",
      ) +
      row("설치·사용법", "", help, false, "help"),
  );
}
function help() {
  showPanel(
    "설치·사용법",
    () =>
      `<div class="help"><p>iPhone·iPad: Safari의 공유 → 홈 화면에 추가 → 웹 앱으로 열기. 추가한 아이콘에서 앱을 연 뒤 자료를 다운로드하세요.</p><p>Android: 브라우저 메뉴의 앱 설치 또는 홈 화면에 추가.</p><p>악보를 한 번 누르면 그 마디부터 재생합니다. 두 번 탭은 화면 맞춤, 두 손가락은 확대·이동입니다. 직접 페이지를 넘긴 뒤 ‘자동’을 누르면 음원을 따라갑니다.</p><p>전체화면은 바로 양쪽 보기로 전환됩니다. 아래의 양쪽·대본·악보와 재생바, 위쪽 이전·다음 넘버를 사용할 수 있어요.</p><p>자료 다운로드는 앱을 열어 둔 상태에서 완료하세요. 기기 공간 정리나 웹사이트 데이터 삭제 시 재다운로드가 필요합니다. 연습 보정은 JSON으로 백업하세요.</p><p>MR+화음은 자동 정렬 미리듣기입니다. 전곡을 사람이 청취 검수한 자료는 아닙니다.</p><a href="/licenses/lucide.txt" target="_blank" rel="noopener">Lucide 아이콘 라이선스</a></div>`,
  );
}
function pack(kind: string) {
  const base = offline.files
    .filter((f) => !/\.(mp3|m4a)$/.test(f.path))
    .map((f) => f.path);
  if (kind === "all") return offline.files.map((f) => f.path);
  const selected =
    kind === "song"
      ? tracks.filter((t) => t.number === currentSong().number)
      : tracks.filter(
          (t) => t.type === "MR" || t.type === "AR" || t.role === saved.role,
        );
  return [...new Set([...base, ...selected.map((t) => t.path)])];
}
async function recommendDownload() {
  if (saved.downloadPrompted) return;
  const kind = saved.role ? "role" : "song";
  const inventory = await offline.inventory(pack(kind));
  if (saved.downloadPrompted) return;
  if (inventory.done === inventory.total) {
    saved.downloadPrompted = true;
    save();
    return;
  }
  const el = document.querySelector<HTMLElement>("#download-suggestion")!;
  el.innerHTML = `${svg("offline")}<div><strong>${saved.role ? "내 배역" : "현재 넘버"} 저장 권장</strong><small>인터넷 없이 연습 · ${megabytes(inventory.bytes - inventory.savedBytes)}</small></div><div class="suggestion-actions">${button("suggest-download", "추천 자료 다운로드", "download", "다운로드")}<button data-action="suggest-later">나중에</button></div>`;
  el.hidden = false;
  update();
}
function dismissDownloadSuggestion() {
  saved.downloadPrompted = true;
  save();
  document.querySelector<HTMLElement>("#download-suggestion")!.hidden = true;
  update();
}
function startDownload(kind: string) {
  if (offline.status.active) return;
  downloadPaths = pack(kind);
  try {
    localStorage.setItem(
      storageKey + "-download-plan",
      JSON.stringify(downloadPaths),
    );
  } catch {}
  void offline.download(downloadPaths);
}
function downloadProgress() {
  if (panelTitle !== "자료 다운로드") return;
  const s = offline.status;
  document.querySelector("#download-progress")!.textContent =
    `${s.done} / ${s.total}개 · ${megabytes(s.savedBytes)} / ${megabytes(s.bytes)}`;
  document.querySelector<HTMLProgressElement>("#download-meter")!.value =
    s.bytes ? s.savedBytes / s.bytes : 0;
  document.querySelector("#download-message")!.textContent =
    s.error ||
    (s.active
      ? "다운로드 중 · 앱을 열어 두세요"
      : s.total && s.done === s.total
        ? "선택한 자료 저장 완료 · 오프라인 연습 가능"
        : "전체 또는 필요한 자료를 선택하세요");
  document.querySelector<HTMLButtonElement>(
    '[data-action="pause-download"]',
  )!.disabled = !s.active;
  document.querySelector<HTMLButtonElement>(
    '[data-action="resume-download"]',
  )!.disabled = s.active || !downloadPaths.length;
  document
    .querySelectorAll<HTMLButtonElement>("[data-pack]")
    .forEach((e) => (e.disabled = s.active));
}
async function downloads() {
  const inventory = await offline.inventory(
    downloadPaths.length ? downloadPaths : undefined,
  );
  if (!offline.status.active)
    offline.status = { ...inventory, active: false, error: "", path: "" };
  showPanel(
    "자료 다운로드",
    () =>
      `<div class="download-summary"><span class="eyebrow">OFFLINE LIBRARY</span><strong id="download-progress"></strong><progress id="download-meter" max="1" value="0"></progress><p id="download-message" role="status"></p></div><div class="download-actions">${button("pause-download", "다운로드 일시정지", "pause", "일시정지")}${button("resume-download", "다운로드 이어받기", "download", "이어받기")}</div>` +
      ["all", "role", "song"]
        .map((kind) => {
          const paths = pack(kind),
            bytes = paths.reduce(
              (n, p) => n + offline.files.find((f) => f.path === p)!.bytes,
              0,
            );
          const title =
            kind === "all"
              ? "전체 자료"
              : kind === "role"
                ? "내 배역 + 공통 음원"
                : "현재 넘버";
          const id = "pack-" + kind;
          panelActions.set(id, () => {
            if (offline.status.active) return;
            if (kind === "role" && !saved.role) {
              chooseRole();
              return;
            }
            startDownload(kind);
          });
          return `<button class="option" data-option="${id}" data-pack="${kind}">${svg("download")}<span><strong>${title}</strong><small>${kind === "role" ? (saved.role || "배역 선택 필요") + " · " : ""}${paths.length}개 · ${megabytes(bytes)}</small></span>${svg("next")}</button>`;
        })
        .join("") +
      row(
        "저장 상태 다시 확인",
        "다운로드한 파일이 남아 있는지 확인",
        () => {
          if (offline.status.active) return;
          void offline
            .inventory(downloadPaths.length ? downloadPaths : undefined)
            .then((r) => {
              offline.status = { ...r, active: false, error: "", path: "" };
              downloadProgress();
            });
        },
        false,
        "check",
      ) +
      row(
        "다운로드 자료 삭제",
        "연습 보정은 유지",
        () =>
          confirm(
            "다운로드 자료 삭제",
            "저장한 악보·대본·음원만 삭제할까요? 오프라인에서는 다시 받을 수 없습니다.",
            () => {
              void offline
                .remove(offline.files.map((f) => f.path))
                .then(() => notify("다운로드 자료 삭제"))
                .catch((e) => notify(e.message));
            },
          ),
        false,
        "close",
      ),
  );
  downloadProgress();
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.usage !== undefined) {
      const el = document.createElement("p");
      el.className = "hint";
      el.textContent = `웹 저장 공간 사용 ${megabytes(estimate.usage)} · 남은 추정 ${megabytes(estimate.quota - estimate.usage)}`;
      document.querySelector(".options")?.append(el);
    }
  } catch {}
}
function pageMenu(kind: string) {
  const count = kind === "score" ? currentSong().pages : catalog.scriptPages;
  showPanel(
    kind === "score" ? "악보 페이지" : "대본 페이지",
    () =>
      `<form id="page-form" data-kind="${kind}"><label class="page-input">페이지 <input id="page-number" type="number" min="1" max="${count}" value="${(kind === "score" ? scorePage : scriptPage) + 1}" inputmode="numeric" required aria-label="이동할 페이지"><span>/ ${count}</span></label><button type="submit" class="primary">이동</button><p class="hint" id="page-error" role="status"></p></form>`,
  );
}
function setMode(mode: number) {
  saved.mode = mode;
  save();
  update();
}
async function toggleFullscreen() {
  saved.fullscreen = !saved.fullscreen;
  if (saved.fullscreen) saved.mode = 0;
  save();
  update();
  if (saved.fullscreen) {
    try {
      await root.requestFullscreen?.();
    } catch {}
  } else if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {}
  }
}
function bind() {
  root.addEventListener("click", (e) => {
    const target = (e.target as Element).closest<HTMLElement>("button");
    if (!target) return;
    const action = target.dataset.action;
    if (target.dataset.number !== undefined) {
      chooseSong(Number(target.dataset.number));
      return;
    }
    if (target.dataset.mode !== undefined) {
      setMode(Number(target.dataset.mode));
      return;
    }
    if (target.dataset.option !== undefined) {
      panelActions.get(target.dataset.option)?.();
      return;
    }
    switch (action) {
      case "close":
        closePanel();
        break;
      case "songs":
        songsMenu();
        break;
      case "audio":
        recordingMenu();
        break;
      case "role":
        chooseRole();
        break;
      case "tools":
        tools();
        break;
      case "download":
        void downloads();
        break;
      case "personal-script":
        personalScriptMenu();
        break;
      case "suggest-later":
        dismissDownloadSuggestion();
        break;
      case "suggest-download":
        dismissDownloadSuggestion();
        void downloads().then(() =>
          startDownload(saved.role ? "role" : "song"),
        );
        break;
      case "toggle":
        audio.paused ? void play() : pause();
        break;
      case "back":
        seek(audio.currentTime - 5, true);
        break;
      case "forward":
        seek(audio.currentTime + 5, true);
        break;
      case "prev-song":
        chooseSong(songIndex - 1);
        break;
      case "next-song":
        chooseSong(songIndex + 1);
        break;
      case "fullscreen":
        void toggleFullscreen();
        break;
      case "follow":
        follow = true;
        applyCue();
        transport();
        break;
      case "rate":
        showPanel("연습 속도", () =>
          [0.5, 0.65, 0.75, 0.85, 1, 1.15, 1.25]
            .map((value) =>
              row(
                value + "×",
                "",
                () => {
                  saved.rate = value;
                  audio.playbackRate = value;
                  save();
                  closePanel();
                  update();
                },
                saved.rate === value,
              ),
            )
            .join(""),
        );
        break;
      case "lead":
        showPanel("악보 미리 넘김", () =>
          [0, 0.5, 1, 1.5, 2, 3, 5]
            .map((value) =>
              row(
                `−${value}s`,
                "",
                () => {
                  saved.lead = value;
                  save();
                  closePanel();
                  applyCue();
                  update();
                },
                saved.lead === value,
              ),
            )
            .join(""),
        );
        break;
      case "repeat":
        repeatMenu();
        break;
      case "pause-download":
        offline.pause();
        break;
      case "resume-download":
        void offline.download(downloadPaths);
        break;
      default:
        if (action?.startsWith("score-") || action?.startsWith("script-")) {
          const [kind, op] = action.split("-");
          const paper = kind === "score" ? score : script;
          if (op === "fit") paper.fit();
          else if (op === "page") pageMenu(kind);
          else
            manualPage(
              kind,
              (kind === "score" ? scorePage : scriptPage) +
                (op === "prev" ? -1 : 1),
            );
        }
    }
  });
  document.querySelector("#overlay")!.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closePanel();
  });
  document.addEventListener("keydown", (e) => {
    const overlay = document.querySelector<HTMLElement>("#overlay")!;
    if (!overlay.hidden) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePanel();
      }
      if (e.key === "Tab") {
        const list = [
          ...overlay.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,a[href]",
          ),
        ];
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
      return;
    }
    if ((e.target as HTMLElement).matches("input,textarea")) return;
    if (e.code === "Space") {
      e.preventDefault();
      audio.paused ? void play() : pause();
    }
  });
  root.addEventListener("submit", (e) => {
    if ((e.target as HTMLElement).id === "page-form") {
      e.preventDefault();
      const form = e.target as HTMLElement;
      const value = Number(
          document.querySelector<HTMLInputElement>("#page-number")!.value,
        ),
        kind = form.dataset.kind!;
      if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > (kind === "score" ? currentSong().pages : catalog.scriptPages)
      ) {
        document.querySelector("#page-error")!.textContent =
          "페이지 범위를 확인하세요";
        return;
      }
      manualPage(kind, value - 1);
      closePanel();
    }
  });
  root.addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id === "volume") {
      saved.volume = Number(input.value);
      if (gain) gain.gain.value = saved.volume;
      else audio.volume = saved.volume;
      document.querySelector("#volume-value")!.textContent =
        Math.round(saved.volume * 100) + "%";
      save();
    }
    if (input.id === "seek") {
      isSeeking = true;
      document.querySelector("#current-time")!.textContent = clock(
        Number(input.value),
      );
    }
  });
  document.querySelector("#seek")!.addEventListener("change", (e) => {
    isSeeking = false;
    seek(Number((e.target as HTMLInputElement).value), true);
  });
  document.querySelector("#script-file")!.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) void importPersonalScript(file);
  });
  document
    .querySelector("#backup-file")!
    .addEventListener("change", async (e) => {
      const input = e.target as HTMLInputElement,
        file = input.files?.[0];
      input.value = "";
      if (!file) return;
      try {
        if (file.size > 2e6) throw Error("백업 파일이 너무 큽니다");
        const result = validateBackup(
          JSON.parse(await file.text()),
          tracks,
          catalog.songs,
          catalog.scriptPages,
        );
        confirm(
          "보정 기록 가져오기",
          `${Object.values(result.custom).reduce((n, c) => n + c.length, 0)}개 지점을 가져옵니다. 같은 음원의 기존 보정을 바꿉니다.`,
          () => {
            Object.assign(saved.custom, result.custom);
            Object.assign(saved.hidden, result.hidden);
            save();
            applyCue();
            notify("보정 기록을 가져왔어요");
          },
        );
      } catch (e) {
        notify((e as Error).message);
      }
    });
  audio.addEventListener("loadedmetadata", () => {
    ready = true;
    duration = audio.duration;
    if (pendingSeek !== null) {
      audio.currentTime = Math.min(pendingSeek, Math.max(0, duration - 0.01));
      pendingSeek = null;
    }
    if (follow) applyCue();
    transport();
  });
  audio.addEventListener("error", () => {
    ready = false;
    notify(
      navigator.onLine
        ? "음원을 열 수 없어요 · 다운로드 상태를 확인하세요"
        : "저장하지 않은 음원입니다",
    );
  });
  for (const event of ["play", "pause", "ended"])
    audio.addEventListener(event, transport);
  window.addEventListener("pagehide", pause);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
  });
  window.addEventListener("online", () => {
    document.querySelector("#network")!.textContent = "";
    if (!ready) selectTrack(track);
  });
  window.addEventListener(
    "offline",
    () => (document.querySelector("#network")!.textContent = "오프라인"),
  );
  document.addEventListener("fullscreenchange", () => {
    if (
      !document.fullscreenElement &&
      saved.fullscreen &&
      document.fullscreenEnabled
    ) {
      saved.fullscreen = false;
      save();
      update();
    }
  });
  let resizeTimer: number;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => update(), 150);
  });
  offline.onchange = downloadProgress;
  setInterval(() => {
    if (!ready) return;
    if (!audio.paused && loop && loopB !== null && audio.currentTime >= loopB) {
      audio.currentTime = loopA;
    }
    if (follow) applyCue();
    transport();
    if (!audio.paused && performance.now() - lastSave > 3000) {
      lastSave = performance.now();
      persistPosition();
    }
  }, 50);
}
function mount() {
  root.innerHTML = `<header id="chrome"><a class="brand" href="/" aria-label="쿠로이 연습실"><span class="brand-mark">K</span><span>쿠로이<small>REHEARSAL ROOM</small></span></a><nav class="number-nav">${button("prev-song", "이전 넘버", "prev")}<button data-action="songs" id="song-title"></button>${button("next-song", "다음 넘버", "next")}</nav><div class="header-tools"><span id="network">${navigator.onLine ? "" : "오프라인"}</span>${button("download", "자료 다운로드", "download")}${button("tools", "연습 도구", "tools")}${button("fullscreen", "전체화면", "full")}</div></header><div class="workspace"><aside class="sidebar"><div class="sidebar-label">넘버 <span>${catalog.songs.length}</span></div><div class="song-list">${catalog.songs.map((s, i) => `<button data-number="${i}"><span>${String(s.number).padStart(2, "0")}</span><strong>${esc(s.title)}</strong></button>`).join("")}</div><div class="sidebar-foot"><span class="status-dot"></span> 내 속도로, 한 장면씩.</div></aside><main class="documents">${["score", "script"].map((kind) => `<section class="document ${kind}-document" aria-label="${kind === "score" ? "악보" : "대본"}"><div class="document-bar"><span class="document-name">${svg(kind)}${kind === "score" ? "악보" : "대본"}</span><div class="page-controls">${button(kind + "-prev", (kind === "score" ? "악보" : "대본") + " 이전 페이지", "prev")}<button data-action="${kind}-page" id="${kind}-page"></button>${button(kind + "-next", (kind === "score" ? "악보" : "대본") + " 다음 페이지", "next")}</div>${button(kind + "-fit", (kind === "score" ? "악보" : "대본") + " 화면 맞춤", "fit")}</div><div class="paper-viewport" id="${kind}-paper"></div></section>`).join("")}</main></div><footer id="transport"><div class="seek-row"><time id="current-time">00:00</time><input id="seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="재생 위치"><time id="duration">00:00</time></div><div class="transport-row"><div class="source-controls"><button data-action="audio">${svg("score")}<span id="audio-title"></span></button><button data-action="role">${svg("role")}<span id="role-label"></span></button><button data-action="rate"><span id="rate-label"></span></button></div><div class="play-controls">${button("back", "5초 뒤로", "back")}<button data-action="toggle" class="play-button" aria-label="재생">${svg("play")}</button>${button("forward", "5초 앞으로", "forward")}</div><div class="view-controls"><button data-action="follow" class="active">${svg("refresh")}<span id="follow-label">자동</span></button><button data-action="lead"><span id="lead-label"></span></button>${button("repeat", "구간 반복", "repeat")}<div class="view-modes">${[
    ["both", "양쪽"],
    ["script", "대본"],
    ["score", "악보"],
  ]
    .map(
      ([icon, label], mode) =>
        `<button data-mode="${mode}" aria-label="${label} 보기">${svg(icon)}<span>${label}</span></button>`,
    )
    .join(
      "",
    )}</div></div></div></footer><div id="overlay" hidden></div><div id="toast" role="status" hidden></div><input id="backup-file" type="file" accept="application/json,.json" hidden>`;
  score = new Paper(document.querySelector("#score-paper")!);
  const suggestion = document.createElement("aside");
  suggestion.id = "download-suggestion";
  suggestion.setAttribute("aria-label", "오프라인 연습 준비");
  suggestion.hidden = true;
  root.insertBefore(suggestion, root.querySelector(".workspace"));
  const scriptName = root.querySelector(".script-document .document-name")!;
  const personalButton = document.createElement("button");
  personalButton.className = "document-name personal-script-button";
  personalButton.dataset.action = "personal-script";
  personalButton.setAttribute("aria-label", "내 메모 대본");
  personalButton.innerHTML = `${svg("edit")}<span>대본</span>`;
  scriptName.replaceWith(personalButton);
  scriptLabel();
  const fileInput = document.createElement("input");
  fileInput.id = "script-file";
  fileInput.type = "file";
  fileInput.accept = ".pdf,application/pdf";
  fileInput.hidden = true;
  root.append(fileInput);
  root.querySelector<HTMLAnchorElement>(".brand")!.href = appBase.href;
  script = new Paper(document.querySelector("#script-paper")!);
  score.onTap = tapScore;
  score.onPrimeTap = () => {
    try {
      prepareAudio();
    } catch {}
  };
  bind();
  chooseSong(Math.max(0, Math.min(saved.song, catalog.songs.length - 1)));
  if (!saved.seen) chooseRole();
  else void recommendDownload();
}
async function init() {
  try {
    if (!("serviceWorker" in navigator) || !("caches" in window))
      throw Error("Safari 또는 Chrome의 일반 모드에서 열어 주세요");
    await offline.init();
    try {
      const plan = JSON.parse(
        localStorage.getItem(storageKey + "-download-plan") || "[]",
      );
      if (Array.isArray(plan))
        downloadPaths = plan.filter(
          (path: unknown) =>
            typeof path === "string" &&
            offline.files.some((f) => f.path === path),
        );
    } catch {}
    [catalog, timeline, navigation, highlights] = await Promise.all(
      [
        "catalog.json",
        "auto-timing.json",
        "score-navigation.json",
        "role-highlights.json",
      ].map((p) => offline.json(p)),
    );
    const mixes = await offline.json("mix-catalog.json");
    tracks = [...catalog.tracks, ...mixes.tracks];
    let restoreError = false;
    try {
      personalScript = await scriptStore.read();
      if (personalScript)
        personalPdf = await openLocalPdf(
          personalScript.blob,
          catalog.scriptPages,
        );
    } catch {
      personalScript = undefined;
      restoreError = true;
    }
    mount();
    if (restoreError)
      notify("저장한 내 대본을 열지 못했어요 · 원본을 표시합니다");
    await navigator.serviceWorker.register(new URL("sw.js", appBase), {
      scope: appBase.pathname,
    });
    if (isolated)
      Object.assign(window, {
        kuroiAudit: {
          get state() {
            return {
              songIndex,
              track,
              scorePage,
              scriptPage,
              follow,
              loop,
              loopA,
              loopB,
              ready,
              duration,
              position: audio.currentTime,
              saved,
              download: offline.status,
            };
          },
          audio,
          offline,
          catalog,
          tracks,
          timeline,
          navigation,
          highlights,
        },
      });
  } catch (e) {
    root.innerHTML = `<div class="boot"><strong>연습실을 열 수 없어요</strong><span>${esc((e as Error).message)}</span><button onclick="location.reload()">다시 시도</button></div>`;
  }
}
void init();
