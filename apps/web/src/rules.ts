// The words behind each borrower's guard. Stored only when keccak256(words) equals the ruleHash the borrower put on
// chain with setLimits, so nobody can attach words to someone else's limits.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAddress, keccak256, toBytes, type Address } from "viem";
import { guardAbi } from "@adelanto/chain";
import { dep, pub } from "./data.ts";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const path = process.env.WEB_DB_PATH ?? join(process.env.HOME ?? "", "adelanto-data", "web.sqlite");
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path);
db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS rules (hash TEXT PRIMARY KEY, borrower TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);");

export async function saveRule(borrower: Address, text: string): Promise<"saved" | "mismatch" | "too_long"> {
  if (text.length > 600) return "too_long";
  const onChain = await pub.readContract({ address: dep.guard, abi: guardAbi, functionName: "ruleHashOf", args: [borrower] });
  const hash = keccak256(toBytes(text));
  if (hash !== onChain) return "mismatch";
  db.prepare("INSERT OR REPLACE INTO rules (hash, borrower, text, at) VALUES (?, ?, ?, ?)").run(hash, getAddress(borrower), text, Date.now());
  return "saved";
}

/** The words for a rule hash, only if they hash to it. */
export function ruleText(hash: string): string | null {
  const r = db.prepare("SELECT text FROM rules WHERE hash = ?").get(hash) as any;
  if (!r) return null;
  return keccak256(toBytes(r.text)) === hash ? r.text : null;
}
