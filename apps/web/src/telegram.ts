// The Telegram bot (@adelanto_ar_bot). It never touches money. It sends each linked wallet the agent's notices
// (repayments under the rule, due dates, risk, the Sunday summary), answers "what do I owe", today's rate and quotes,
// and reads a rule written in words, replying with the read-back and a link that opens the site to sign it.
// A chat is linked to a wallet only with that wallet's EIP-712 signature (from Mi historial), through a one-time code.
// Team wallets that link also get the watchdog's alerts. Polls Telegram (getUpdates); runs inside the web service.
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { getAddress, isAddress, keccak256, toBytes, verifyTypedData, type Address, type Hex } from "viem";
import { dollars, parseRule, percent, pesos } from "@adelanto/core";
import { creditOf, labelOf, loanRows, loanView, noticesFor, poolView, pub, quoteFor, REFS, SITE } from "./data.ts";
import { linkTypedData } from "../client/tglink.ts";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type Lang = "es" | "en";

// ------------------------------------------------------------------ config and storage

export function botToken(): string | null {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  const f = process.env.TELEGRAM_ENV_FILE ?? join(process.env.HOME ?? "", "adelanto-private", "telegram.env");
  if (!existsSync(f)) return null;
  const m = /^TELEGRAM_BOT_TOKEN=(\S+)$/m.exec(readFileSync(f, "utf8"));
  return m ? m[1] : null;
}

const dbPath = process.env.WEB_DB_PATH ?? join(process.env.HOME ?? "", "adelanto-data", "web.sqlite");
let db: InstanceType<typeof DatabaseSync> | null = null;
export function tgDb() {
  if (db) return db;
  db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS tg_links (chat_id INTEGER PRIMARY KEY, address TEXT NOT NULL, lang TEXT NOT NULL, linked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tg_codes (code TEXT PRIMARY KEY, address TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tg_sigs (hash TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tg_sent (key TEXT NOT NULL, chat_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (key, chat_id));
CREATE TABLE IF NOT EXISTS tg_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  return db;
}
const meta = (k: string) => (tgDb().prepare("SELECT value FROM tg_meta WHERE key = ?").get(k) as any)?.value as string | undefined;
const setMetaTg = (k: string, v: string) => tgDb().prepare("INSERT OR REPLACE INTO tg_meta (key, value) VALUES (?, ?)").run(k, v);
const linkOf = (chat: number) => tgDb().prepare("SELECT address, lang, linked_at FROM tg_links WHERE chat_id = ?").get(chat) as { address: Address; lang: Lang; linked_at: number } | undefined;

// ------------------------------------------------------------------ linking (called by the site)

/** Checks the wallet's signature and returns a one-time code for the bot's start link, valid 10 minutes. */
export async function linkCode(body: any): Promise<{ code: string } | { error: string }> {
  if (!body || !isAddress(body.wallet) || typeof body.nonce !== "string" || body.nonce.length > 64 || !/^0x[0-9a-fA-F]+$/.test(String(body.signature ?? ""))) return { error: "bad request" };
  const expires = BigInt(String(body.expires ?? "0"));
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (expires < now || expires > now + 900n) return { error: "expired" };
  const wallet = getAddress(body.wallet);
  const typed = { address: wallet, ...linkTypedData(wallet, body.nonce, expires), signature: body.signature as Hex };
  // An ordinary wallet's signature is checked here; a smart wallet's through the chain (ERC-1271).
  const ok = (await verifyTypedData(typed).catch(() => false)) || (await pub.verifyTypedData(typed).catch(() => false));
  if (!ok) return { error: "bad signature" };
  const h = keccak256(toBytes(body.signature));
  const d = tgDb();
  if (d.prepare("SELECT 1 FROM tg_sigs WHERE hash = ?").get(h)) return { error: "already used" };
  d.prepare("INSERT INTO tg_sigs (hash, at) VALUES (?, ?)").run(h, Date.now());
  const code = randomBytes(12).toString("hex");
  d.prepare("INSERT INTO tg_codes (code, address, expires) VALUES (?, ?, ?)").run(code, wallet, Date.now() + 10 * 60_000);
  return { code };
}

// ------------------------------------------------------------------ Telegram API

let token: string | null = null;
export let botUsername = "adelanto_ar_bot";
type Button = { text: string; url?: string; callback_data?: string };
async function api(method: string, body: unknown): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}
async function say(chat: number, text: string, buttons: Button[][] = []) {
  // Plain text only (no parse mode), so nothing in a notice or a rule can be read as markup.
  await api("sendMessage", { chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true, ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}) });
}
const page = (path: string, lang: Lang) => `${SITE}${path}${lang === "en" ? `${path.includes("?") ? "&" : "?"}lang=en` : ""}`;

// ------------------------------------------------------------------ answers

const W = 10n ** 18n;
const date = (sec: bigint, lang: Lang) => new Date(Number(sec) * 1000).toLocaleDateString(lang === "es" ? "es-AR" : "en-GB", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long" });
const BAND: Record<string, { es: string; en: string }> = { tranquilo: { es: "tranquilo", en: "calm" }, atencion: { es: "atención", en: "watch" }, riesgo: { es: "riesgo", en: "at risk" }, liquidable: { es: "se puede vender parte", en: "can be partly sold" } };

export function helpText(lang: Lang, linked: boolean) {
  return lang === "es"
    ? `Soy el agente de Adelanto. No muevo plata desde acá: solo te aviso y te contesto.\n\n` +
        `• «cuánto debo»: tus préstamos abiertos\n• «tasa»: la tasa de hoy\n• «cotizar 5000 30»: cuánto dejás y cuánto pagás por $ 5.000 a 30 días\n• Escribí tu regla con tus palabras (por ejemplo «cuando me entren pesos, pagá el préstamo») y te devuelvo lo que el agente haría, con el link para firmarla\n• /desvincular\n\n` +
        (linked ? "Te aviso acá cada vez que el agente hace algo con tu préstamo, antes del vencimiento, si sube el riesgo y cada domingo a las 20 h con tu semana." : `Para recibir los avisos de tu préstamo, entrá a Mi historial y tocá «Avisarme por Telegram»: ${page("/historial", lang)}`)
    : `I am Adelanto's agent. I move no money from here: I only tell you things and answer.\n\n` +
        `• "what do I owe": your open loans\n• "rate": today's rate\n• "quote 5000 30": what you leave and pay for ARS 5,000 over 30 days\n• Write your rule in your own words (e.g. "when pesos arrive, repay the loan") and I reply with what the agent would do and a link to sign it\n• /unlink\n\n` +
        (linked ? "I message you here whenever the agent acts on your loan, before it is due, if risk rises, and every Sunday at 8 pm with your week." : `To get your loan's notices, open My record and tap "Notify me on Telegram": ${page("/historial", lang)}`);
}

async function owed(chat: number, lang: Lang, who: Address) {
  const v = await poolView();
  const open = loanRows().filter((r) => getAddress(r.borrower) === who);
  const lines: string[] = [];
  const buttons: Button[][] = [];
  for (const r of open) {
    const l = await loanView(BigInt(r.id), v);
    if (!l?.open) continue;
    lines.push(lang === "es"
      ? `Préstamo #${l.id}: debés ${pesos(l.debt)} con el interés de hoy. Vence el ${date(l.dueAt, lang)}. Estado: ${BAND[l.band].es}; llega a riesgo con el dólar a ${pesos(l.riskPrice)} (hoy ${pesos(v.liquidationPrice)}).`
      : `Loan #${l.id}: you owe ${pesos(l.debt, "en")} with today's interest. Due ${date(l.dueAt, lang)}. Status: ${BAND[l.band].en}; it reaches risk with the dollar at ${pesos(l.riskPrice, "en")} (today ${pesos(v.liquidationPrice, "en")}).`);
    buttons.push([{ text: lang === "es" ? `Ver o pagar el #${l.id}` : `See or repay #${l.id}`, url: page(`/prestamo/${l.id}`, lang) }]);
  }
  if (!lines.length) return say(chat, lang === "es" ? "No tenés préstamos abiertos." : "You have no open loans.", [[{ text: lang === "es" ? "Pedir pesos" : "Borrow pesos", url: page("/pedir", lang) }]]);
  return say(chat, lines.join("\n\n"), buttons);
}

async function rates(chat: number, lang: Lang) {
  const v = await poolView();
  const es = lang === "es";
  return say(chat, es
    ? `Hoy pedir cuesta ${percent(v.borrowRateBps)} al año; un préstamo personal en el banco, ${percent(REFS.bankLoan.bps)} (${REFS.bankLoan.source}). Prestar rinde ${percent(v.lenderRateBps)}. El fondo tiene ${pesos(v.pool.cash)} libres. Dólar del fondo en Celo: ${pesos(v.liquidationPrice)} (promedio de 30 min).${v.paused ? "\n\nLos préstamos nuevos están en pausa mientras los precios no coinciden." : ""}`
    : `Borrowing costs ${percent(v.borrowRateBps, "en")} a year today; a bank personal loan, ${percent(REFS.bankLoan.bps, "en")} (${REFS.bankLoan.source}). Lending earns ${percent(v.lenderRateBps, "en")}. The pool has ${pesos(v.pool.cash, "en")} free. The pool's dollar on Celo: ${pesos(v.liquidationPrice, "en")} (30-minute average).${v.paused ? "\n\nNew loans are paused while prices disagree." : ""}`);
}

async function quoteMsg(chat: number, lang: Lang, amount: bigint, days: number, who?: Address) {
  const es = lang === "es";
  const [v, tier] = await Promise.all([poolView(), who ? creditOf(who).then((c) => c.tier) : Promise.resolve(0)]);
  const q = quoteFor(v, amount, days, tier);
  if (!q.ok) return say(chat, es ? `Ahora no se puede: ${q.reason === "PAUSED" ? "los préstamos nuevos están en pausa" : q.reason === "PRICE_REFUSED" ? "el precio no es confiable en este momento" : "el fondo no alcanza para ese monto"}.` : `Not right now: ${q.reason}.`);
  return say(
    chat,
    es
      ? `Por ${pesos(q.pesos)} a ${days} días: dejás ${dollars(q.collateral)} de garantía, recibís ${pesos(q.received)} y pagás ${pesos(q.interest)} de interés al ${percent(q.rateBps)} anual. El banco te cobraría ${pesos(q.bankInterest)}. Tus dólares vuelven cuando pagás.`
      : `For ${pesos(q.pesos, "en")} over ${days} days: you leave ${dollars(q.collateral, "en")}, receive ${pesos(q.received, "en")} and pay ${pesos(q.interest, "en")} interest at ${percent(q.rateBps, "en")} a year. A bank would charge ${pesos(q.bankInterest, "en")}. Your dollars come back when you repay.`,
    [[{ text: es ? "Pedirlo en la página" : "Borrow on the site", url: page(`/pedir?pesos=${amount}&dias=${days}`, lang) }]],
  );
}

/** A rule in words, read against the wallet's open loan: the read-back and a link that opens the site to sign it. */
async function ruleMsg(chat: number, lang: Lang, who: Address, words: string) {
  const es = lang === "es";
  const v = await poolView();
  const openRow = loanRows().find((r) => getAddress(r.borrower) === who && r.open);
  const loan = openRow ? await loanView(BigInt(openRow.id), v) : null;
  if (!loan?.open) return say(chat, es ? "Para ponerle una regla al agente primero necesitás un préstamo abierto." : "You need an open loan before the agent can follow a rule.", [[{ text: es ? "Pedir pesos" : "Borrow pesos", url: page("/pedir", lang) }]]);
  const block = await pub.getBlock();
  const r = parseRule(words, { debt: loan.debt, collateral: loan.collateral, dueAt: loan.dueAt, maxRateBps: 0 }, block.timestamp, lang);
  const sign = (label: string, text: string) => [[{ text: label, url: page(`/cuidar/${loan.id}?w=${encodeURIComponent(text)}`, lang) }]];
  if (r.kind === "limits") return say(chat, `${es ? r.readback.es : r.readback.en}\n\n${es ? "Se firma en tu billetera, desde la página:" : "You sign it in your wallet, on the site:"}`, sign(es ? "Firmar esta regla" : "Sign this rule", words));
  if (r.kind === "revoke") return say(chat, es ? r.readback.es : r.readback.en, sign(es ? "Quitar el permiso" : "Remove the permission", words));
  if (r.kind === "question") {
    setMetaTg(`pending:${chat}`, words);
    return say(chat, es ? r.question.es : r.question.en, r.question.options.map((o, i) => [{ text: o.label, callback_data: `q${i}` }]));
  }
  return say(chat, es ? r.es : r.en);
}

// ------------------------------------------------------------------ updates

const langOfUser = (u: any): Lang => (String(u?.language_code ?? "es").startsWith("es") ? "es" : "en");

export async function handle(update: any) {
  if (update.callback_query) {
    const q = update.callback_query;
    const chat = q.message?.chat?.id as number;
    const link = linkOf(chat);
    const words = meta(`pending:${chat}`);
    await api("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
    if (!link || !words || !/^q\d+$/.test(q.data ?? "")) return;
    const v = await poolView();
    const openRow = loanRows().find((r) => getAddress(r.borrower) === link.address && r.open);
    const loan = openRow ? await loanView(BigInt(openRow.id), v) : null;
    if (!loan) return;
    const block = await pub.getBlock();
    const first = parseRule(words, { debt: loan.debt, collateral: loan.collateral, dueAt: loan.dueAt, maxRateBps: 0 }, block.timestamp, link.lang);
    if (first.kind !== "question") return;
    const opt = first.question.options[Number(q.data.slice(1))];
    if (!opt) return;
    return ruleMsg(chat, link.lang, link.address, `${words} ${opt.append}`.trim());
  }
  const m = update.message;
  if (!m?.chat?.id || m.chat.type !== "private") return;
  const chat = m.chat.id as number;
  const link = linkOf(chat);
  const lang: Lang = link?.lang ?? langOfUser(m.from);
  const es = lang === "es";
  if (m.voice || m.audio) return say(chat, es ? "Las notas de voz todavía no las leo acá. Escribila, o dictala en la página con el botón «Dictar»." : "I can't read voice notes here yet. Type it, or dictate it on the site with the \"Dictate\" button.");
  const text = String(m.text ?? "").trim();
  if (!text) return;

  const start = /^\/start(?:\s+([0-9a-f]{24}))?$/.exec(text);
  if (start) {
    const code = start[1];
    if (!code) return say(chat, helpText(lang, !!link));
    const row = tgDb().prepare("SELECT address, expires, used FROM tg_codes WHERE code = ?").get(code) as any;
    if (!row || row.used || row.expires < Date.now()) return say(chat, es ? "Ese link ya no sirve. Volvé a Mi historial y tocá «Avisarme por Telegram» otra vez." : "That link has expired. Go back to My record and tap \"Notify me on Telegram\" again.");
    const d = tgDb();
    d.prepare("UPDATE tg_codes SET used = 1 WHERE code = ?").run(code);
    d.prepare("INSERT OR REPLACE INTO tg_links (chat_id, address, lang, linked_at) VALUES (?, ?, ?, ?)").run(chat, row.address, lang, Date.now());
    const short = `${row.address.slice(0, 6)}…${row.address.slice(-4)}`;
    await say(chat, (es ? `Listo: este chat recibe los avisos de la billetera ${short}.\n\n` : `Done: this chat gets the notices for wallet ${short}.\n\n`) + helpText(lang, true));
    const lastWeek = noticesFor(row.address, 20).find((n: any) => n.kind === "weekly");
    if (lastWeek) await say(chat, es ? lastWeek.text_es : lastWeek.text_en);
    return;
  }
  if (/^\/(desvincular|unlink)\b/i.test(text)) {
    tgDb().prepare("DELETE FROM tg_links WHERE chat_id = ?").run(chat);
    return say(chat, es ? "Listo, ya no te aviso nada en este chat." : "Done, this chat gets no more notices.");
  }
  if (/^\/(ayuda|help)\b/i.test(text)) return say(chat, helpText(lang, !!link));
  if (/^\/?(tasa|tasas|rate|rates)\b/i.test(text)) return rates(chat, lang);
  const qm = /^\/?(?:cotizar|cotizame|quote)\s+\$?\s*([\d.,]+)\s*(?:lucas|mil|k)?\s*(\d{1,2})?/i.exec(text);
  if (qm) {
    let n = Number(qm[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
    if (/lucas|mil|k/i.test(text) && n < 1000) n *= 1000;
    const d = [7, 30, 60, 90].includes(Number(qm[2])) ? Number(qm[2]) : 30;
    if (!Number.isFinite(n) || n < 1000) return say(chat, es ? "El mínimo es $ 1.000. Ejemplo: «cotizar 5000 30»." : "The minimum is ARS 1,000. Example: \"quote 5000 30\".");
    return quoteMsg(chat, lang, BigInt(Math.floor(n)), d, link?.address);
  }
  if (!link) return say(chat, helpText(lang, false));
  if (/^\/?(deuda|debo|prestamo|préstamo|owe|loan)\b|cu[aá]nto debo|what do i owe/i.test(text)) return owed(chat, lang, link.address);
  return ruleMsg(chat, lang, link.address, text.slice(0, 600));
}

// ------------------------------------------------------------------ pushing the agent's notices

export async function deliver() {
  const d = tgDb();
  const links = d.prepare("SELECT chat_id, address, lang, linked_at FROM tg_links").all() as any[];
  for (const l of links) {
    const fresh = (noticesFor(l.address, 50) as any[]).filter((n) => Number(n.created_at) >= Number(l.linked_at)).reverse();
    for (const n of fresh) {
      if (d.prepare("SELECT 1 FROM tg_sent WHERE key = ? AND chat_id = ?").get(n.key, l.chat_id)) continue;
      const loanBtn: Button[][] = n.loan_id ? [[{ text: l.lang === "es" ? `Ver el préstamo #${n.loan_id}` : `See loan #${n.loan_id}`, url: page(`/prestamo/${n.loan_id}`, l.lang) }]] : [];
      try {
        await say(l.chat_id, l.lang === "es" ? n.text_es : n.text_en, loanBtn);
        d.prepare("INSERT INTO tg_sent (key, chat_id, at) VALUES (?, ?, ?)").run(n.key, l.chat_id, Date.now());
      } catch (e: any) {
        if (/blocked|chat not found|deactivated/i.test(String(e?.message))) d.prepare("DELETE FROM tg_links WHERE chat_id = ?").run(l.chat_id);
        break;
      }
    }
  }
  // The watchdog's alerts go to chats linked to one of our own wallets.
  const opsLog = process.env.OPS_LOG ?? join(process.env.HOME ?? "", "adelanto-data", "ops.log");
  if (!existsSync(opsLog)) return;
  const size = statSync(opsLog).size;
  const from = Number(meta("opsOffset") ?? size); // first run: start from now
  if (size < from) return setMetaTg("opsOffset", String(size));
  const fresh = readFileSync(opsLog, "utf8").slice(from).split("\n").filter((s) => /ALERT|DOWN|STALE/.test(s));
  setMetaTg("opsOffset", String(size));
  if (!fresh.length) return;
  for (const l of links.filter((x) => labelOf(x.address) === "OURS")) await say(l.chat_id, `Ops:\n${fresh.join("\n")}`).catch(() => {});
}

// ------------------------------------------------------------------ the loop

export async function startBot(log: (s: string) => void = console.log) {
  token = botToken();
  if (!token) return log("telegram: no token, bot off");
  tgDb();
  try {
    botUsername = (await api("getMe", {})).username;
  } catch (e: any) {
    return log(`telegram: ${e.message}`);
  }
  await api("setMyCommands", { commands: [{ command: "deuda", description: "Cuánto debo" }, { command: "tasa", description: "La tasa de hoy" }, { command: "ayuda", description: "Qué puedo hacer" }, { command: "desvincular", description: "Dejar de recibir avisos" }] }).catch(() => {});
  log(`telegram: @${botUsername} polling`);
  let offset = Number(meta("offset") ?? 0);
  setInterval(() => void deliver().catch((e) => log(`telegram deliver: ${e.message}`)), 20_000);
  for (;;) {
    try {
      const updates: any[] = await api("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        setMetaTg("offset", String(offset));
        await handle(u).catch((e) => log(`telegram handle: ${String(e?.message ?? e).slice(0, 200)}`));
      }
    } catch (e: any) {
      log(`telegram poll: ${String(e?.message ?? e).slice(0, 200)}`);
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}
