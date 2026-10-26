import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (["library", "_headers"].includes(e.name)) continue;
    const p = dir + "/" + e.name;
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (!["sw.js", "shell-manifest.json"].includes(e.name)) out.push(p);
  }
  return out;
}
const paths = await walk("dist");
const files = paths.map((p) => "/" + p.slice(5));
const h = createHash("sha256");
for (const p of paths) h.update(await readFile(p));
await writeFile(
  "dist/shell-manifest.json",
  JSON.stringify({ version: h.digest("hex").slice(0, 16), files }),
);
