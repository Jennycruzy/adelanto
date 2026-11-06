import { test } from "vitest";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dbTs = new URL("../src/db.ts", import.meta.url).href;

/** Starts a process that takes the lock, discards the release function, forces GC and keeps running. */
function holder(dir: string) {
  const code = `import { holdLock } from ${JSON.stringify(dbTs)}; holdLock(${JSON.stringify(dir)}, "t"); globalThis.gc?.(); console.log("held"); setInterval(() => globalThis.gc?.(), 100);`;
  return spawn(process.execPath, ["--expose-gc", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
}

function tryLock(dir: string): Promise<{ code: number | null; out: string }> {
  const code = `import { holdLock } from ${JSON.stringify(dbTs)}; try { holdLock(${JSON.stringify(dir)}, "t"); console.log("GOT"); } catch (e) { console.log("REFUSED"); }`;
  return new Promise((res) => {
    const p = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("exit", (c) => res({ code: c, out }));
  });
}

test("a second process is refused the lock, even after the holder drops its release function and GC runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "adelanto-lock-"));
  const a = holder(dir);
  await new Promise<void>((res, rej) => {
    a.stdout.on("data", (d) => String(d).includes("held") && res());
    a.on("exit", () => rej(new Error("holder exited early")));
  });
  await new Promise((r) => setTimeout(r, 2000)); // the review saw the lock freed after ~1.5 s without the fix
  const b = await tryLock(dir);
  a.kill();
  assert.match(b.out, /REFUSED/);
  await new Promise((r) => a.on("exit", r));
  const c = await tryLock(dir);
  assert.match(c.out, /GOT/, "the lock frees when the holder dies");
}, 20_000);
