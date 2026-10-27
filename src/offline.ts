import { LibraryFile } from "./core";
import { appBase, libraryCachePrefix } from "./paths";
export interface DownloadStatus {
  total: number;
  done: number;
  bytes: number;
  savedBytes: number;
  active: boolean;
  error: string;
  path: string;
}
export class OfflineLibrary {
  version = "";
  files: LibraryFile[] = [];
  cache!: Cache;
  caches: Cache[] = [];
  status: DownloadStatus = {
    total: 0,
    done: 0,
    bytes: 0,
    savedBytes: 0,
    active: false,
    error: "",
    path: "",
  };
  controller?: AbortController;
  onchange = () => {};
  async init() {
    const response = await fetch(new URL("library-manifest-v2.json", appBase), {
      cache: "no-cache",
    });
    if (!response.ok) throw Error("자료 목록을 불러올 수 없습니다");
    const m = await response.json();
    this.version = m.version;
    this.files = m.files;
    this.cache = await caches.open(libraryCachePrefix + this.version);
    const older = (await caches.keys()).filter(
      (key) =>
        key.startsWith(libraryCachePrefix) &&
        key !== libraryCachePrefix + this.version,
    );
    this.caches = [
      this.cache,
      ...(await Promise.all(older.map((key) => caches.open(key)))),
    ];
  }
  url(path: string) {
    return new URL(
      "library/" + path.split("/").map(encodeURIComponent).join("/"),
      appBase,
    ).href;
  }
  async has(path: string) {
    return !!(await this.cached(path));
  }
  async cached(path: string) {
    const f = this.files.find((f) => f.path === path);
    if (!f) return;
    for (const cache of this.caches) {
      const r = await cache.match(this.url(path));
      if (r?.headers.get("X-Kuroi-SHA256") === f.sha256) return r;
    }
  }
  async hasPrevious(path: string) {
    for (const cache of this.caches) {
      const response = await cache.match(this.url(path));
      if (response?.headers.has("X-Kuroi-SHA256")) return true;
    }
    return false;
  }
  async fetchFile(path: string, signal?: AbortSignal) {
    const f = this.files.find((f) => f.path === path);
    if (!f) throw Error("자료 목록에 없는 파일");
    const cached = await this.cached(path);
    if (cached) return cached;
    const r = await fetch(this.url(path), {
      signal,
      cache: "no-store",
      headers: { "X-Kuroi-Download": "1" },
    });
    if (!r.ok || r.status !== 200) throw Error("파일 다운로드 실패");
    const buffer = await r.arrayBuffer();
    if (buffer.byteLength !== f.bytes) throw Error("파일 크기 불일치");
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    )
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== f.sha256) throw Error("자료 검증 실패");
    const headers = new Headers(r.headers);
    headers.delete("Content-Encoding");
    headers.set("Content-Length", String(buffer.byteLength));
    headers.set("X-Kuroi-SHA256", hash);
    headers.set("Accept-Ranges", "bytes");
    const full = new Response(buffer, { headers });
    await this.cache.put(this.url(path), full.clone());
    return full;
  }
  async json(path: string) {
    return (await this.fetchFile(path)).json();
  }
  async inventory(paths = this.files.map((f) => f.path)) {
    const rows = await Promise.all(
      paths.map(async (path) => ({
        path,
        saved: await this.has(path),
        bytes: this.files.find((f) => f.path === path)!.bytes,
      })),
    );
    return {
      total: rows.length,
      done: rows.filter((r) => r.saved).length,
      bytes: rows.reduce((a, r) => a + r.bytes, 0),
      savedBytes: rows.filter((r) => r.saved).reduce((a, r) => a + r.bytes, 0),
    };
  }
  async download(paths: string[]) {
    if (this.status.active) return;
    this.status.active = true;
    const unique = [...new Set(paths)];
    this.controller = new AbortController();
    try {
      this.status = {
        ...(await this.inventory(unique)),
        active: true,
        error: "",
        path: "",
      };
      this.onchange();
      try {
        await navigator.storage?.persist?.();
      } catch {
        /* A denied persistence request does not prevent best-effort storage. */
      }
      for (const path of unique) {
        if (this.controller.signal.aborted)
          throw new DOMException("Paused", "AbortError");
        if (await this.has(path)) continue;
        this.status.path = path;
        this.onchange();
        await this.fetchFile(path, this.controller.signal);
        this.status.done++;
        this.status.savedBytes += this.files.find(
          (f) => f.path === path,
        )!.bytes;
        this.onchange();
      }
    } catch (e) {
      this.status.error =
        (e as Error).name === "AbortError"
          ? "일시정지 · 이어받을 수 있어요"
          : (e as Error).name === "QuotaExceededError"
            ? "기기 저장 공간이 부족합니다"
            : `다운로드 중단 · ${(e as Error).message}`;
    } finally {
      this.status.active = false;
      this.status.path = "";
      this.onchange();
    }
  }
  pause() {
    this.controller?.abort();
  }
  async remove(paths: string[]) {
    if (this.status.active) throw Error("다운로드를 일시정지한 뒤 삭제하세요");
    const selected = new Set(paths);
    for (const path of paths) {
      if (path.startsWith("mixes/v2/"))
        selected.add(path.replace("mixes/v2/", "mixes/"));
      if (path === "mix-catalog-v2.json") selected.add("mix-catalog.json");
    }
    for (const path of selected)
      for (const cache of this.caches) await cache.delete(this.url(path));
    this.onchange();
  }
}
