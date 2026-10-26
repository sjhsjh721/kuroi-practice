export interface Song {
  number: number;
  title: string;
  score: string;
  pages: number;
  scriptPage: number;
}
export interface Track {
  number: number;
  type: string;
  role: string;
  title: string;
  path: string;
  reference?: string;
}
export interface Cue {
  ms: number;
  score: number;
  script: number;
  automatic?: boolean;
}
export interface Profile {
  id: string;
  name: string;
  characters: string[];
}
export interface Mark {
  box: number[];
  roles: number;
}
export interface Region {
  box: number[];
  points: number[][];
}
export interface LibraryFile {
  path: string;
  bytes: number;
  sha256: string;
}
export const timingPath = (t: Track) => t.reference || t.path;
export const token = (c: Cue) => `${c.ms}_${c.score}_${c.script}`;
export function mergedCues(auto: Cue[], custom: Cue[], hidden: string[]) {
  return [
    ...auto
      .filter(
        (c) =>
          !hidden.includes(token(c)) &&
          !custom.some((p) => Math.abs(p.ms - c.ms) < 400),
      )
      .map((c) => ({ ...c, automatic: true })),
    ...custom.map((c) => ({ ...c, automatic: false })),
  ].sort((a, b) => a.ms - b.ms);
}
export function pagesAt(cues: Cue[], ms: number, lead: number, start: number) {
  let i = -1;
  for (let n = 0; n < cues.length && cues[n].ms <= ms; n++) i = n;
  let score = i >= 0 ? cues[i].score : 0;
  const script = i >= 0 ? cues[i].script : start;
  if (ms > 0)
    for (let j = i + 1; j < cues.length; j++) {
      const c = cues[j];
      if (!c.automatic || c.ms > ms + lead) break;
      score = c.score;
    }
  return { score, script };
}
export function hitNote(
  regions: Region[],
  times: number[],
  x: number,
  y: number,
) {
  let best: number[] | undefined,
    d = Infinity;
  for (const r of regions) {
    const b = r.box;
    if (x < b[0] - 0.00001 || x > b[2] + 0.00001 || y < b[1] || y >= b[3])
      continue;
    for (const p of r.points)
      if (Math.abs(p[0] - x) < d) {
        best = p;
        d = Math.abs(p[0] - x);
      }
  }
  return best && Number.isInteger(best[1]) ? times[best[1]] : undefined;
}
export function validateBackup(
  value: unknown,
  tracks: Track[],
  songs: Song[],
  scriptPages: number,
) {
  const o = value as {
    version?: number;
    entries?: Record<string, unknown>;
    hidden?: Record<string, string[]>;
  };
  if (
    !o ||
    o.version !== 1 ||
    !o.entries ||
    typeof o.entries !== "object" ||
    Array.isArray(o.entries)
  )
    throw Error("올바른 보정 백업 파일을 선택하세요");
  const result: Record<string, Cue[]> = {};
  for (const [key, v] of Object.entries(o.entries)) {
    const t = tracks.find((t) => key === "cues_" + t.path);
    if (!t || !Array.isArray(v) || v.length > 5000)
      throw Error("알 수 없는 음원 또는 지점 수 초과");
    const s = songs.find((s) => s.number === t.number)!;
    for (const c of v)
      if (
        !c ||
        !Number.isInteger(c.ms) ||
        c.ms < 0 ||
        !Number.isInteger(c.score) ||
        c.score < 0 ||
        c.score >= s.pages ||
        !Number.isInteger(c.script) ||
        c.script < 0 ||
        c.script >= scriptPages
      )
        throw Error("보정 시각 또는 페이지가 올바르지 않습니다");
    result[t.path] = v.map((c) => ({
      ms: c.ms,
      score: c.score,
      script: c.script,
    }));
  }
  const hidden: Record<string, string[]> = {};
  if (o.hidden)
    for (const [key, v] of Object.entries(o.hidden)) {
      if (
        !tracks.some((t) => t.path === key) ||
        !Array.isArray(v) ||
        v.length > 5000 ||
        v.some((x) => typeof x !== "string" || !/^\d+_\d+_\d+$/.test(x))
      )
        throw Error("숨긴 지점 데이터가 올바르지 않습니다");
      hidden[key] = v;
    }
  return { custom: result, hidden };
}
export const clock = (seconds: number) =>
  `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
export const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;
