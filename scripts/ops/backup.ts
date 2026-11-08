// Nightly backup of the agent's and the web app's databases: a consistent copy of each (SQLite VACUUM INTO, safe
// while the services write), kept for 14 days. Env: DATA_DIR (default ~/adelanto-data), BACKUP_DIR (~/adelanto-backups).
import { mkdirSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const data = process.env.DATA_DIR ?? join(homedir(), "adelanto-data");
const root = process.env.BACKUP_DIR ?? join(homedir(), "adelanto-backups");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join(root, stamp);
mkdirSync(dir, { recursive: true, mode: 0o700 });
for (const name of ["agent.sqlite", "web.sqlite"]) {
  const src = join(data, name);
  if (!existsSync(src)) continue;
  const db = new DatabaseSync(src, { readOnly: true });
  db.exec(`VACUUM INTO '${join(dir, name).replace(/'/g, "''")}'`);
  db.close();
  console.log(`backed up ${name}: ${statSync(join(dir, name)).size} bytes -> ${dir}`);
}
const keep = 14 * 86_400_000;
for (const d of readdirSync(root)) {
  const p = join(root, d);
  if (Date.now() - statSync(p).mtimeMs > keep) {
    rmSync(p, { recursive: true, force: true });
    console.log(`removed old backup ${d}`);
  }
}
