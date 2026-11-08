// Fails if anything shaped like a secret is in the repository's history: a 32-byte hex value assigned to a key-like
// name, a PEM private key, or a GitHub, OpenAI, Anthropic, AWS or Slack token. The only allowed keys are Foundry's
// public anvil test keys, which tests use as throwaway signers. Run in CI on every push: node scripts/secrets-scan.ts
import { execFileSync } from "node:child_process";

const ANVIL = new Set([
  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
]);
const PATTERNS: [string, RegExp][] = [
  ["hex key in a key-like name", /(?:priv(?:ate)?[_-]?key|secret|mnemonic|seed|_KEY|apiKey|api_key)["'`]?\s*[:=]\s*["'`]?(?:0x)?([0-9a-fA-F]{64})\b/i],
  ["PEM private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/],
  ["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/],
  ["OpenAI or Anthropic key", /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abpr]-[A-Za-z0-9-]{20,}\b/],
];

const log = execFileSync("git", ["log", "--all", "-p", "--no-color", "--unified=0"], { maxBuffer: 1 << 30 }).toString();
let commit = "";
const hits: string[] = [];
for (const line of log.split("\n")) {
  if (line.startsWith("commit ")) commit = line.slice(7, 15);
  if (!line.startsWith("+") || line.startsWith("+++")) continue;
  for (const [what, re] of PATTERNS) {
    const m = re.exec(line);
    if (!m) continue;
    if (m[1] && ANVIL.has(m[1].toLowerCase())) continue;
    hits.push(`${commit} ${what}: ${line.slice(0, 120)}`);
  }
}
// A raw 64-hex line on its own is what a key file looks like.
const files = execFileSync("git", ["ls-files"]).toString().split("\n").filter(Boolean);
for (const f of files) if (/\.(key|pem)$|(^|\/)\.env(\.|$)/.test(f)) hits.push(`tracked file that should never be committed: ${f}`);

if (hits.length) {
  console.error(`secrets scan: ${hits.length} finding(s)\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`secrets scan: clean (${log.split("\ncommit ").length} commits, ${files.length} tracked files)`);
