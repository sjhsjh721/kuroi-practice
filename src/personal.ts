import { appBase } from "./paths";

export interface PersonalScript {
  name: string;
  blob: Blob;
  active: boolean;
}

// Personal files stay in this browser, separate from the public library cache.
export class ScriptStore {
  constructor(private isolated: boolean) {}
  private async database() {
    const name =
      "kuroi-script-" +
      appBase.pathname +
      (this.isolated ? "-verification" : "");
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async read(): Promise<PersonalScript | undefined> {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const request = db
          .transaction("files")
          .objectStore("files")
          .get("script");
        request.onsuccess = () => {
          const file = request.result;
          resolve(
            file
              ? {
                  name: file.name,
                  active: file.active,
                  blob: new Blob([file.data], { type: "application/pdf" }),
                }
              : undefined,
          );
        };
        request.onerror = () =>
          reject(request.error || Error("내 대본을 읽지 못했어요"));
      });
    } finally {
      db.close();
    }
  }
  async write(file: PersonalScript) {
    // Store bytes instead of a File/Blob handle, which mobile WebKit may reject
    // after the file has been read/transferred to the PDF worker.
    const data = await file.blob.arrayBuffer();
    const db = await this.database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("files", "readwrite");
        transaction
          .objectStore("files")
          .put({ name: file.name, active: file.active, data }, "script");
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(
            transaction.error ||
              Error("내 대본을 저장하지 못했어요 · 기기 공간을 확인해 주세요"),
          );
      });
    } finally {
      db.close();
    }
  }
}
