// Server-rendered pages (hono/html escapes every interpolated value). Numbers come from data.ts.
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { dollars, pesos, percent, type Quote } from "@adelanto/core";
import { CELO } from "@adelanto/chain";
import { t, type Lang } from "./i18n.ts";
import { REFS, dep, labelOf, networkCostUsd, type LoanView, type PoolView } from "./data.ts";

type H = HtmlEscapedString | Promise<HtmlEscapedString>;

// What the wallet code may talk to: the deployed contracts and the two tokens, nothing else.
const walletCfg = JSON.stringify({ code: dep.attributionCode, pool: dep.pool, guard: dep.guard, usdt: CELO.usdt, wars: CELO.wars, rpc: "https://forno.celo.org" });

export const href = (lang: Lang, path: string) => (lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path);
export const txUrl = (h: string) => `https://celoscan.io/tx/${h}`;
export const addrUrl = (a: string) => `https://celoscan.io/address/${a}`;
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const date = (sec: bigint, lang: Lang) =>
  new Date(Number(sec) * 1000).toLocaleDateString(lang === "es" ? "es-AR" : "en-GB", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long", year: "numeric" });
const usd = (x: number, lang: Lang) => (x < 0.01 ? (lang === "es" ? "menos de US$ 0,01" : "under US$0.01") : x.toLocaleString(lang === "es" ? "es-AR" : "en-US", { style: "currency", currency: "USD" }));
const label = (a: string, lang: Lang) => {
  const l = labelOf(a);
  return l === "OURS" ? t(lang, "ours") : l === "JUDGE" ? t(lang, "judge") : t(lang, "user");
};

export function layout(lang: Lang, title: string, body: H, opts: { path: string; wallet?: boolean } = { path: "/" }) {
  const other = lang === "es" ? "English" : "Español";
  const otherHref = lang === "es" ? `${opts.path}${opts.path.includes("?") ? "&" : "?"}lang=en` : opts.path.replace(/[?&]lang=en/, "");
  return html`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ADELANTO</title>
<meta name="description" content="${t(lang, "tagline")}">
<link rel="icon" href="/static/adelanto.png">
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
<header class="top">
  <a class="brand" href="${href(lang, "/")}"><img src="/static/adelanto.png" alt="">ADELANTO</a>
  <a class="lang" href="${otherHref}">${other}</a>
</header>
<main>${body}</main>
<footer>
  <nav class="foot">
    <a href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a>
    <a href="${href(lang, "/prestar")}">${t(lang, "lend")}</a>
    <a href="${href(lang, "/transparencia")}">${t(lang, "transparency")}</a>
    <a href="${href(lang, "/como-funciona")}">${t(lang, "how")}</a>
    <a href="https://github.com/Jennycruzy/adelanto">GitHub</a>
  </nav>
</footer>
${opts.wallet ? html`<script id="adelanto-cfg" type="application/json">${raw(walletCfg)}</script><script type="module" src="/static/wallet.js"></script>` : ""}
</body>
</html>`;
}

function poolCard(v: PoolView, lang: Lang) {
  return html`<div class="card">
  <div class="row"><span>${t(lang, "deposited")}</span><span class="v">${pesos(v.totalAssets, lang)}</span></div>
  <div class="row"><span>${t(lang, "poolLent")}</span><span class="v">${pesos(v.pool.totalDebt, lang)}</span></div>
  <div class="row"><span>${t(lang, "poolFree")}</span><span class="v">${pesos(v.pool.cash, lang)}</span></div>
  <div class="row"><span>${t(lang, "poolUse")}</span><span class="v">${percent(v.utilizationBps, lang)}</span></div>
  <p class="small muted">${t(lang, "updated")} <a href="https://celoscan.io/block/${v.block}">${v.block.toString()}</a>.</p>
</div>`;
}

function stateNotice(v: PoolView, lang: Lang) {
  if (v.paused) return html`<div class="card notice">${t(lang, "paused")}</div>`;
  if (!v.borrowPrice) return html`<div class="card notice">${t(lang, "priceRefused")}</div>`;
  return "";
}

export function home(lang: Lang, v: PoolView, proof: { loan: LoanView; events: any[]; actions: any[] } | null, tickAge: number | null) {
  return layout(
    lang,
    lang === "es" ? "Pesos ya" : "Pesos now",
    html`<h1>${t(lang, "tagline")}</h1>
${stateNotice(v, lang)}
<div class="grid2">
  <div class="card"><div class="muted small">${t(lang, "rateNow")}</div><div class="big">${percent(v.borrowRateBps, lang)}</div></div>
  <div class="card"><div class="muted small">${t(lang, "bank")} (${REFS.bankLoan.source})</div><div class="big">${percent(REFS.bankLoan.bps, lang)}</div></div>
</div>
<p class="muted small">${lang === "es" ? "Dejás dólares (USDT) en garantía y recibís pesos digitales de Ripio (wARS) en el mismo minuto. Tus dólares siguen siendo tuyos." : "You leave dollars (USDT) as a guarantee and receive Ripio digital pesos (wARS) in the same minute. Your dollars stay yours."}</p>
<div class="btns">
  <a class="btn" href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a>
  <a class="btn secondary" href="${href(lang, "/prestar")}">${t(lang, "lend")}</a>
</div>
<div class="card"><div class="muted small">${t(lang, "lendersEarn")}</div><div class="big">${percent(v.lenderRateBps, lang)}</div>
<p class="small muted">BADLAR ${percent(REFS.badlar.bps, lang)} · ${REFS.inflation[lang]} ${percent(REFS.inflation.bps, lang)} (${REFS.badlar.source})</p></div>
${proof ? proofCard(lang, proof) : ""}
<h2>${lang === "es" ? "El fondo, en vivo" : "The pool, live"}</h2>
${poolCard(v, lang)}
${tickAge === null ? "" : html`<p class="small muted">${t(lang, "agentAlive")} ${Math.round(tickAge / 1000)} ${t(lang, "seconds")}.</p>`}
<a class="btn secondary" href="${href(lang, "/probar")}">${t(lang, "tryIt")}</a>`,
    { path: "/" },
  );
}

function proofCard(lang: Lang, p: { loan: LoanView; events: any[]; actions: any[] }) {
  const b = p.events.find((e) => e.name === "Borrowed");
  return html`<h2>${t(lang, "realLoan")}</h2>
<div class="card">
  <div class="row"><span>${lang === "es" ? "Pidió" : "Borrowed"}</span><span class="v">${b ? pesos(BigInt(b.args.pesos), lang) : ""}</span></div>
  <div class="row"><span>${lang === "es" ? "Dejó" : "Left"}</span><span class="v">${b ? dollars(BigInt(b.args.collateral), lang) : ""}</span></div>
  <div class="row"><span>${t(lang, "rateNow")}</span><span class="v">${b ? percent(BigInt(b.args.rateBps), lang) : ""}</span></div>
  <div class="row"><span>${lang === "es" ? "Estado" : "Status"}</span><span class="v">${p.loan.open ? t(lang, "open") : t(lang, "closed")} <span class="pill">${label(p.loan.borrower, lang)}</span></span></div>
  <ul class="log">${p.events.map((e) => html`<li>${eventLine(e, lang)} · <a class="tx" href="${txUrl(e.tx)}">${short(e.tx)}</a></li>`)}</ul>
  <a class="btn secondary" href="${href(lang, `/prestamo/${p.loan.id}`)}">${lang === "es" ? "Ver el préstamo" : "See the loan"}</a>
</div>`;
}

export function eventLine(e: { name: string; args: any }, lang: Lang): string {
  const a = e.args;
  const es = lang === "es";
  switch (e.name) {
    case "Borrowed":
      return es ? `Pidió ${pesos(BigInt(a.pesos))} dejando ${dollars(BigInt(a.collateral))} a ${percent(BigInt(a.rateBps))}` : `Borrowed ${pesos(BigInt(a.pesos), "en")} leaving ${dollars(BigInt(a.collateral), "en")} at ${percent(BigInt(a.rateBps), "en")}`;
    case "CollateralAdded":
      return es ? `Agregó ${dollars(BigInt(a.usdt))}` : `Added ${dollars(BigInt(a.usdt), "en")}`;
    case "CollateralWithdrawn":
      return es ? `Retiró ${dollars(BigInt(a.usdt))}` : `Took back ${dollars(BigInt(a.usdt), "en")}`;
    case "Repaid":
      return es ? `Pagó ${pesos(BigInt(a.pesos))}; quedan ${pesos(BigInt(a.debtLeft))}` : `Repaid ${pesos(BigInt(a.pesos), "en")}; ${pesos(BigInt(a.debtLeft), "en")} left`;
    case "LoanClosed":
      return es ? `Cerrado${a.onTime ? " a tiempo" : ""}; volvieron ${dollars(BigInt(a.collateralReturned))}` : `Closed${a.onTime ? " on time" : ""}; ${dollars(BigInt(a.collateralReturned), "en")} returned`;
    case "Liquidated":
      return es ? `Venta de garantía: se pagaron ${pesos(BigInt(a.pesosRepaid))} con ${dollars(BigInt(a.usdtSeized))}` : `Guarantee sale: ${pesos(BigInt(a.pesosRepaid), "en")} paid with ${dollars(BigInt(a.usdtSeized), "en")}`;
    case "PenaltyAdded":
      return es ? `Interés por atraso: ${pesos(BigInt(a.pesos))}` : `Late interest: ${pesos(BigInt(a.pesos), "en")}`;
    default:
      return e.name;
  }
}

export function borrowPage(lang: Lang, v: PoolView, input: { pesos: string; days: number }, q: Quote | { ok: false; reason: string; limit?: bigint } | null) {
  const days = [7, 30, 60, 90];
  return layout(
    lang,
    t(lang, "borrow"),
    html`<h1>${t(lang, "borrow")}</h1>
${stateNotice(v, lang)}
<form method="get" action="/pedir" class="card">
  ${lang === "en" ? html`<input type="hidden" name="lang" value="en">` : ""}
  <label for="pesos">${t(lang, "howMany")}</label>
  <input id="pesos" name="pesos" inputmode="numeric" pattern="[0-9.]*" value="${input.pesos}" autocomplete="off">
  <label>${t(lang, "forHowLong")}</label>
  <div class="terms">${days.map((d) => html`<label><input type="radio" name="dias" value="${d}" ${d === input.days ? "checked" : ""}><span>${d} ${t(lang, "days")}</span></label>`)}</div>
  <button class="btn secondary" type="submit">${t(lang, "seeQuote")}</button>
</form>
${q ? quoteCard(lang, v, q) : ""}`,
    { path: `/pedir?pesos=${encodeURIComponent(input.pesos)}&dias=${input.days}`, wallet: true },
  );
}

function refusal(lang: Lang, q: { reason: string; limit?: bigint }) {
  switch (q.reason) {
    case "BELOW_MIN":
      return t(lang, "belowMin");
    case "POOL_TOO_THIN":
      return `${t(lang, "poolThin")} ${pesos(q.limit ?? 0n, lang)}.`;
    case "CAP_REACHED":
      return `${t(lang, "capReached")} ${pesos(q.limit ?? 0n, lang)}.`;
    case "OVER_LOAN_LIMIT":
      return `${t(lang, "overLimit")} ${pesos(q.limit ?? 0n, lang)}.`;
    case "PAUSED":
      return t(lang, "paused");
    case "PRICE_REFUSED":
      return t(lang, "priceRefused");
    default:
      return lang === "es" ? "Elegí 7, 30, 60 o 90 días." : "Pick 7, 30, 60 or 90 days.";
  }
}

function quoteCard(lang: Lang, v: PoolView, q: Quote | { ok: false; reason: string; limit?: bigint }) {
  if (!q.ok) return html`<div class="card notice">${refusal(lang, q)}</div>`;
  const cost = networkCostUsd(v, 450_000n);
  return html`<div class="card">
  <div class="muted small">${t(lang, "youGet")}</div>
  <div class="big">${pesos(q.received, lang)}</div>
  <div class="row"><span>${t(lang, "youLeave")}</span><span class="v">${dollars(q.collateral, lang)}</span></div>
  <div class="row"><span>${t(lang, "rateNow")}</span><span class="v">${percent(q.rateBps, lang)}</span></div>
  <div class="row"><span>${t(lang, "fee")}</span><span class="v">${pesos(q.fee, lang)}</span></div>
  <div class="row"><span>${t(lang, "interest")} (${q.termDays} ${t(lang, "days")})</span><span class="v">${pesos(q.interest, lang)}</span></div>
  <div class="row"><span>${t(lang, "owedAtEnd")}</span><span class="v">${pesos(q.owedAtTerm, lang)}</span></div>
  <div class="row"><span>${t(lang, "atBank")} (${percent(REFS.bankLoan.bps, lang)})</span><span class="v">${pesos(q.bankInterest, lang)}</span></div>
  <div class="row"><span><b>${t(lang, "youSave")}</b></span><span class="v band-tranquilo">${pesos(q.saving, lang)}</span></div>
  <div class="row"><span>${t(lang, "networkCost")}</span><span class="v">${usd(cost, lang)}</span></div>
  <p class="small">${t(lang, "riskLine")} <b>${pesos(q.riskPrice, lang)}</b> ${lang === "es" ? "por dólar" : "per dollar"} (${lang === "es" ? "hoy" : "today"} ${pesos(v.liquidationPrice, lang)}), ${t(lang, "riskLineEnd")}</p>
  <p class="small">${t(lang, "saleLine")} <b>${pesos(q.salePrice, lang)}</b>, ${t(lang, "saleLineEnd")}</p>
  <p class="small muted">${t(lang, "borrowRisk")}</p>
  <div id="status"></div>
  <button class="btn" data-action="borrow" data-pesos="${q.pesos.toString()}" data-days="${q.termDays}" data-collateral="${q.collateral.toString()}" data-maxrate="${q.maxRateBps.toString()}" data-lang="${lang}">${t(lang, "confirm")}</button>
  <p class="small muted">${lang === "es" ? "Dos toques en tu billetera: firmás el uso exacto de tus dólares y confirmás el préstamo." : "Two taps in your wallet: you sign the exact use of your dollars and confirm the loan."}</p>
</div>`;
}

export function loanPage(lang: Lang, v: PoolView, loan: LoanView, events: any[], actions: any[]) {
  const widthPct = Math.min(100, Number(loan.ltvBps) / 80);
  const bandWord = { tranquilo: lang === "es" ? "Tranquilo" : "Calm", atencion: lang === "es" ? "Atención" : "Watch", riesgo: lang === "es" ? "Riesgo" : "At risk", liquidable: lang === "es" ? "Se puede vender parte de tu garantía" : "Part of the guarantee can be sold" }[loan.band];
  return layout(
    lang,
    `${t(lang, "myLoan")} ${loan.id}`,
    html`<h1>${t(lang, "myLoan")} #${loan.id.toString()} <span class="pill">${label(loan.borrower, lang)}</span></h1>
${loan.open
  ? html`<div class="card">
  <div class="muted small">${t(lang, "owedNow")}</div>
  <div class="big">${pesos(loan.debt, lang)}</div>
  <div class="row"><span>${t(lang, "guarantee")}</span><span class="v">${dollars(loan.collateral, lang)}</span></div>
  <div class="row"><span>${t(lang, "due")}</span><span class="v">${date(loan.dueAt, lang)}</span></div>
  <div class="row"><span>${t(lang, "health")}</span><span class="v band-${loan.band}">${bandWord}</span></div>
  <div class="bar ${loan.band}"><i style="width:${widthPct}%"></i></div>
  <p class="small">${lang === "es" ? `Pediste el ${percent(loan.ltvBps, lang)} de lo que dejaste. Entra en riesgo con el dólar a ` : `You borrowed ${percent(loan.ltvBps, lang)} of what you left. It reaches risk with the dollar at `}<b>${pesos(loan.riskPrice, lang)}</b> (${lang === "es" ? "hoy" : "today"} ${pesos(v.liquidationPrice, lang)}).</p>
  <div id="status"></div>
  <button class="btn" data-action="repayAll" data-loan="${loan.id.toString()}" data-lang="${lang}">${t(lang, "payAll")}</button>
  <div class="btns">
    <button class="btn secondary" data-action="repayPart" data-loan="${loan.id.toString()}" data-lang="${lang}">${t(lang, "payPart")}</button>
    <button class="btn secondary" data-action="addCollateral" data-loan="${loan.id.toString()}" data-lang="${lang}">${t(lang, "addDollars")}</button>
  </div>
</div>
<div class="card">
  <b>${loan.guard ? t(lang, "guardOn") : t(lang, "guardOff")}</b>
  ${loan.guard ? guardWords(lang, loan.guard.limits) : html`<p class="small muted">${lang === "es" ? "Con un permiso que firmás una vez, el agente puede agregar tus dólares o pagar con tus pesos cuando el préstamo llega a riesgo, sin pasarse de tus límites." : "With one permission you sign once, the agent can add your dollars or repay with your pesos when the loan reaches risk, never beyond your limits."}</p>`}
  <a class="btn secondary" href="${href(lang, `/cuidar/${loan.id}`)}">${t(lang, "guard")}</a>
</div>`
  : html`<div class="card"><b>${t(lang, "closed")}</b>${loan.liquidated ? html`<p class="small">${lang === "es" ? "Se vendió parte de la garantía." : "Part of the guarantee was sold."}</p>` : ""}</div>`}
<h2>${t(lang, "agentDid")}</h2>
<div class="card">${actions.length === 0 ? html`<p class="small muted">${lang === "es" ? "Todavía nada: el préstamo no lo necesitó." : "Nothing yet: the loan has not needed it."}</p>` : html`<ul class="log">${actions.map((a) => html`<li>${lang === "es" ? a.sentence_es : a.sentence_en}${a.tx ? html` · <a class="tx" href="${txUrl(a.tx)}">${short(a.tx)}</a>` : ""}</li>`)}</ul>`}</div>
<h2>${t(lang, "history")}</h2>
<div class="card"><ul class="log">${events.map((e) => html`<li>${eventLine(e, lang)} · <a class="tx" href="${txUrl(e.tx)}">${short(e.tx)}</a></li>`)}</ul>
<p class="small muted">${lang === "es" ? "Billetera" : "Wallet"} <a class="tx" href="${addrUrl(loan.borrower)}">${short(loan.borrower)}</a> · ${t(lang, "updated")} ${v.block.toString()}</p></div>`,
    { path: `/prestamo/${loan.id}`, wallet: loan.open },
  );
}

function guardWords(lang: Lang, l: any) {
  const es = lang === "es";
  const parts: string[] = [];
  if (l.maxTopUpUsdtPerDay > 0n) parts.push(es ? `agregar hasta ${dollars(l.maxTopUpUsdtPerDay)} por día de tus dólares si llega a riesgo` : `add up to ${dollars(l.maxTopUpUsdtPerDay, "en")} a day of your dollars if it reaches risk`);
  if (l.maxRepayWarsPerDay > 0n) parts.push(es ? `pagar hasta ${pesos(l.maxRepayWarsPerDay)} por día con tus pesos` : `repay up to ${pesos(l.maxRepayWarsPerDay, "en")} a day from your pesos`);
  if (l.autoRepay) parts.push(es ? "pagar cuando te entran pesos" : "repay when pesos arrive");
  if (l.keepWarsBuffer > 0n) parts.push(es ? `dejarte siempre ${pesos(l.keepWarsBuffer)}` : `always leave you ${pesos(l.keepWarsBuffer, "en")}`);
  return html`<p class="small">${es ? "Puede " : "It may "}${parts.join(es ? "; " : "; ")}. ${es ? "Vence el" : "Until"} ${date(l.expiry, lang)}.</p>`;
}

export function guardPage(lang: Lang, loan: LoanView, words: string | null) {
  const es = lang === "es";
  const presets = [
    { id: "cuidalo", es: "Cuidalo con hasta US$ 10 por semana", en: "Protect it with up to US$10 a week" },
    { id: "pesos", es: "Pagá con mis pesos cuando entren", en: "Repay with my pesos when they arrive" },
    { id: "avisame", es: "No hagas nada sin preguntarme", en: "Do nothing without asking me" },
  ];
  return layout(
    lang,
    t(lang, "guard"),
    html`<h1>${t(lang, "guard")} #${loan.id.toString()}</h1>
${loan.guard
  ? html`<div class="card"><b>${t(lang, "guardOn")}</b>${guardWords(lang, loan.guard.limits)}${words ? html`<p class="small">${es ? "Tu regla" : "Your rule"}: «${words}»</p>` : ""}
  <div id="status"></div><button class="btn secondary" data-action="revokeGuard" data-lang="${lang}">${es ? "Quitarle el permiso al agente" : "Take the agent's permission away"}</button></div>`
  : ""}
<p class="muted">${es ? "Elegí qué puede hacer el agente cuando tu préstamo llega a riesgo (70%). El contrato no lo deja pasarse de esto, nunca mueve plata a otro lado y vos podés quitarle el permiso cuando quieras." : "Choose what the agent may do when your loan reaches risk (70%). The contract never lets it go beyond this or move money anywhere else, and you can take the permission away at any time."}</p>
<div class="card">
  ${presets.map((p) => html`<button class="btn secondary" data-action="preset" data-preset="${p.id}" data-loan="${loan.id.toString()}" data-debt="${loan.debt.toString()}" data-lang="${lang}">${es ? p.es : p.en}</button>`)}
</div>
<details class="card"><summary><b>${es ? "Armar mi propia regla" : "Make my own rule"}</b></summary>
  <label for="g-usd">${es ? "Dólares por día que puede agregar (0 = nunca)" : "Dollars a day it may add (0 = never)"}</label><input id="g-usd" inputmode="decimal" value="1">
  <label for="g-pesos">${es ? "Pesos por día que puede pagar con tu plata (0 = nunca)" : "Pesos a day it may repay from your money (0 = never)"}</label><input id="g-pesos" inputmode="numeric" value="0">
  <label><input type="checkbox" id="g-auto" style="width:auto;min-height:0"> ${es ? "Cuando me entren pesos, pagá el préstamo" : "When pesos arrive, repay the loan"}</label>
  <label for="g-keep">${es ? "Pesos que siempre te deja" : "Pesos it always leaves you"}</label><input id="g-keep" inputmode="numeric" value="0">
  <label><input type="checkbox" id="g-rate" style="width:auto;min-height:0" checked> ${es ? "Avisame si aparece una tasa más barata" : "Tell me if a cheaper rate appears"}</label>
  <button class="btn" data-action="customGuard" data-loan="${loan.id.toString()}" data-debt="${loan.debt.toString()}" data-lang="${lang}">${es ? "Ver mi regla" : "See my rule"}</button>
</details>
<div class="card" id="readback" hidden>
  <p><b>${es ? "Esto es lo que vas a firmar" : "This is what you will sign"}:</b></p>
  <p id="rule-words"></p>
  <div id="status"></div>
  <button class="btn" data-action="signGuard" data-loan="${loan.id.toString()}" data-lang="${lang}">${es ? "Firmar" : "Sign"}</button>
</div>
<p><a href="${href(lang, `/prestamo/${loan.id}`)}">${es ? "Volver al préstamo" : "Back to the loan"}</a></p>`,
    { path: `/cuidar/${loan.id}`, wallet: true },
  );
}

export function lendPage(lang: Lang, v: PoolView) {
  return layout(
    lang,
    t(lang, "lend"),
    html`<h1>${t(lang, "lendTitle")}</h1>
${v.paused ? html`<div class="card notice">${lang === "es" ? "Los depósitos nuevos están en pausa mientras los precios no coinciden. Retirar funciona igual." : "New deposits are paused while prices disagree. Withdrawing still works."}</div>` : ""}
<div class="grid2">
  <div class="card"><div class="muted small">${t(lang, "lendersEarn")}</div><div class="big">${percent(v.lenderRateBps, lang)}</div></div>
  <div class="card"><div class="muted small">BADLAR</div><div class="big">${percent(REFS.badlar.bps, lang)}</div><div class="small muted">${REFS.badlar.source}</div></div>
</div>
<p class="small muted">${lang === "es" ? "Lo que ganás sube con el uso del fondo: quienes piden pagan la tasa del día y el 90% va a quienes prestan; el 10% forma una reserva que cubre primero cualquier préstamo que su garantía no alcance." : "What you earn rises with pool use: borrowers pay the day's rate and 90% goes to lenders; 10% builds a reserve that covers first any loan its guarantee does not."}</p>
${poolCard(v, lang)}
<div class="card">
  <div id="mine" class="small muted"></div>
  <label for="amount">${lang === "es" ? "Pesos (wARS)" : "Pesos (wARS)"}</label>
  <input id="amount" inputmode="numeric" pattern="[0-9.]*" placeholder="10000">
  <div id="status"></div>
  <div class="btns">
    <button class="btn" data-action="deposit" data-lang="${lang}">${t(lang, "deposit")}</button>
    <button class="btn secondary" data-action="withdraw" data-lang="${lang}">${t(lang, "withdraw")}</button>
  </div>
  <p class="small muted">${t(lang, "lendRisk")}</p>
</div>`,
    { path: "/prestar", wallet: true },
  );
}

export function plain(lang: Lang, title: string, body: H, path: string) {
  return layout(lang, title, body, { path });
}

export { raw, dep };
