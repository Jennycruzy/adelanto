// Every few minutes: is the site answering, and has the agent ticked recently? Restarts the one that is stuck and
// keeps a line per check in ops.log (uptime history). Env: HEALTH_URL (default http://127.0.0.1:8795/health),
// MAX_TICK_AGE_S (default 600), OPS_LOG (~/adelanto-data/ops.log).
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const url = process.env.HEALTH_URL ?? "http://127.0.0.1:8795/health";
const maxAge = Number(process.env.MAX_TICK_AGE_S ?? 600);
const logFile = process.env.OPS_LOG ?? join(homedir(), "adelanto-data", "ops.log");
const line = (s: string) => {
  const l = `${new Date().toISOString()} ${s}`;
  appendFileSync(logFile, l + "\n");
  console.log(l);
};
const restart = (unit: string) => {
  try {
    execFileSync("sudo", ["-n", "systemctl", "restart", unit], { stdio: "pipe", timeout: 180_000 });
    line(`ALERT restarted ${unit}`);
  } catch (e: any) {
    line(`ALERT could not restart ${unit}: ${String(e?.message ?? e).slice(0, 160)}`);
  }
};

let health: { ok: boolean; agentLastTickSecondsAgo: number | null } | null = null;
try {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  health = r.ok ? await r.json() : null;
} catch {
  health = null;
}
if (!health) {
  line(`web DOWN at ${url}`);
  restart("adelanto-web");
} else if (health.agentLastTickSecondsAgo === null || health.agentLastTickSecondsAgo > maxAge) {
  line(`web ok; agent STALE (last tick ${health.agentLastTickSecondsAgo ?? "never"} s ago)`);
  restart("adelanto-agent");
} else {
  line(`web ok; agent ok (last tick ${health.agentLastTickSecondsAgo} s ago)`);
}
