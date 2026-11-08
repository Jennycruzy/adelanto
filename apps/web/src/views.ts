// Server-rendered pages (hono/html escapes every interpolated value). Numbers come from data.ts.
// The wallet client (client/wallet.ts) binds to data-action buttons, #status, #readback, #rule-words, #amount, #mine
// and the g-* inputs: keep those names when changing markup.
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { availableToBorrow, discountBps, dollars, maxLtvBpsForTier, maxPesosForTier, pesos, percent, type Quote } from "@adelanto/core";
import { CELO } from "@adelanto/chain";
import { t, type Lang } from "./i18n.ts";
import { REFS, dep, labelOf, networkCostUsd, type LoanView, type PoolView, type PricePoint } from "./data.ts";

type H = HtmlEscapedString | Promise<HtmlEscapedString>;

// What the wallet code may talk to: the deployed contracts and the two tokens, nothing else.
const walletCfg = JSON.stringify({ code: dep.attributionCode, pool: dep.pool, guard: dep.guard, usdt: CELO.usdt, wars: CELO.wars, rpc: process.env.WEB_CLIENT_RPC ?? "https://forno.celo.org" });
const AGENT = "0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1";
const REPO = "https://github.com/Jennycruzy/adelanto";

export const href = (lang: Lang, path: string) => (lang === "en" ? `${path}${path.includes("?") ? "&" : "?"}lang=en` : path);
export const txUrl = (h: string) => `https://celoscan.io/tx/${h}`;
export const addrUrl = (a: string) => `https://celoscan.io/address/${a}`;
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const date = (sec: bigint, lang: Lang) =>
  new Date(Number(sec) * 1000).toLocaleDateString(lang === "es" ? "es-AR" : "en-GB", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long", year: "numeric" });
const usd = (x: number, lang: Lang) => (x < 0.01 ? (lang === "es" ? "menos de US$ 0,01" : "under US$0.01") : x.toLocaleString(lang === "es" ? "es-AR" : "en-US", { style: "currency", currency: "USD" }));
const num = (n: number, lang: Lang, dec = 0) => n.toLocaleString(lang === "es" ? "es-AR" : "en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const label = (a: string, lang: Lang) => {
  const l = labelOf(a);
  return l === "OURS" ? t(lang, "ours") : l === "JUDGE" ? t(lang, "judge") : t(lang, "user");
};
const pillFor = (a: string, lang: Lang) => {
  const l: string = labelOf(a);
  return html`<span class="pill ${l === "USER" ? "ok" : l === "JUDGE" ? "celeste" : ""}">${label(a, lang)}</span>`;
};

/** The mark: the word, and a square of the flag's celeste. */
const MARK = raw(`<span class="mark" aria-hidden="true">A</span><span class="word">Adelanto</span>`);

// ---------------------------------------------------------------- shell

export function layout(lang: Lang, title: string, body: H, opts: { path: string; wallet?: boolean; bare?: boolean } = { path: "/" }) {
  const es = lang === "es";
  const other = es ? "EN" : "ES";
  const otherHref = es ? `${opts.path}${opts.path.includes("?") ? "&" : "?"}lang=en` : opts.path.replace(/[?&]lang=en/, "") || "/";
  const here = opts.path.split("?")[0];
  const nav = (p: string, k: Parameters<typeof t>[1]) => html`<a href="${href(lang, p)}" ${here === p ? raw('aria-current="page"') : ""}>${t(lang, k)}</a>`;
  return html`<!doctype html>
<html lang="${lang}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title} · Adelanto</title>
<meta name="description" content="${t(lang, "tagline")}">
<meta name="theme-color" content="#ffffff">
<meta property="og:title" content="Adelanto · ${t(lang, "tagline")}">
<meta property="og:description" content="${es ? "Pesos contra tus dólares, en MiniPay, mucho más barato que el banco. Un agente cuida el préstamo dentro de una regla que firmás vos." : "Pesos against your dollars, in MiniPay, far cheaper than the bank. An agent looks after the loan inside a rule you sign."}">
<meta property="og:image" content="/static/img/kiosco-1600.webp">
<link rel="icon" href="/static/adelanto.png">
<link rel="preload" href="/static/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/app.css?v=7">
</head>
<body>
<header class="nav"><div class="wrap">
  <a class="brand" href="${href(lang, "/")}" aria-label="Adelanto">${MARK}</a>
  <nav class="links">
    ${nav("/como-funciona", "how")}
    ${nav("/prestar", "lend")}
    ${nav("/transparencia", "transparency")}
    <a href="${href(lang, "/historial")}" ${here === "/historial" ? raw('aria-current="page"') : ""}>${es ? "Mi historial" : "My record"}</a>
  </nav>
  <a class="lang" href="${otherHref}" hreflang="${es ? "en" : "es"}">${other}</a>
  <a class="btn" href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a>
</div></header>
<main>${body}</main>
${footer(lang)}
${opts.wallet ? html`<script id="adelanto-cfg" type="application/json">${raw(walletCfg)}</script><script type="module" src="/static/wallet.js"></script>` : ""}
<script src="/static/site.js?v=5" defer></script>
</body>
</html>`;
}

function footer(lang: Lang) {
  const es = lang === "es";
  return html`<footer class="foot"><div class="wrap">
  <div>
    <a class="brand" href="${href(lang, "/")}">${MARK}</a>
    <p style="margin-top:14px;max-width:30em">${es ? "Préstamos en pesos contra tus dólares, en Celo. Las reglas están en contratos públicos sin dueño que pueda tocar tu plata." : "Peso loans against your dollars, on Celo. The rules live in public contracts with no owner who can touch your money."}</p>
  </div>
  <div><h4>${es ? "Usar" : "Use"}</h4><ul>
    <li><a href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a></li>
    <li><a href="${href(lang, "/prestar")}">${t(lang, "lend")}</a></li>
    <li><a href="${href(lang, "/probar")}">${t(lang, "tryIt")}</a></li>
  </ul></div>
  <div><h4>${es ? "Entender" : "Understand"}</h4><ul>
    <li><a href="${href(lang, "/como-funciona")}">${t(lang, "how")}</a></li>
    <li><a href="${href(lang, "/transparencia")}">${t(lang, "transparency")}</a></li>
    <li><a href="${href(lang, "/historial")}">${es ? "Mi historial" : "My record"}</a></li>
    <li><a href="/llms.txt">llms.txt</a></li>
  </ul></div>
  <div><h4>${es ? "Código" : "Code"}</h4><ul>
    <li><a href="${REPO}">GitHub</a></li>
    <li><a href="${addrUrl(dep.pool)}">PesoPool</a></li>
    <li><a href="${addrUrl(AGENT)}">${es ? "Agente" : "Agent"} · ERC-8004 #10043</a></li>
  </ul></div>
  <div class="credits">${es ? "Fotos" : "Photos"}: ${es ? "kiosco en Buenos Aires" : "kiosk in Buenos Aires"}, Just a Man, CC BY 4.0 · Mercado de San Telmo, Josefito123, CC BY-SA 4.0 · ${es ? "vía Wikimedia Commons" : "via Wikimedia Commons"}. ${es ? "Tasas de referencia" : "Reference rates"}: ${REFS.bankLoan.source}; ${REFS.inflation.source}.</div>
</div></footer>`;
}

/** Header block for app screens. */
function appHead(eyebrow: string, title: H | string, lede?: H | string, wide = false) {
  return html`<section class="app-head"><div class="${wide ? "wrap" : "narrow"} hero-in">
  <span class="eyebrow">${eyebrow}</span>
  <h1 style="margin-top:16px">${title}</h1>
  ${lede ? html`<p class="lede">${lede}</p>` : ""}
</div></section>`;
}

function stateNotice(v: PoolView, lang: Lang) {
  if (v.paused) return html`<div class="notice">${t(lang, "paused")}</div>`;
  if (!v.borrowPrice) return html`<div class="notice">${t(lang, "priceRefused")}</div>`;
  return "";
}

// ---------------------------------------------------------------- landing

const ICON: Record<string, string> = {
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
  chain: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8L3 12z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M15 11.2c3.4.3 6 1.6 6 2.8 0 1.7-2.7 3-6 3-1.3 0-2.6-.2-3.6-.6"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
  arrows: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  scale: '<path d="M12 4v16M5 20h14M6 8l-3 6h6l-3-6zM18 8l-3 6h6l-3-6zM6 8h12"/>',
};
const icon = (k: string) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="#0e2a47" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`);

export function home(lang: Lang, v: PoolView, proof: { loan: LoanView; events: any[]; actions: any[] } | null, tickAge: number | null, feed: any[] = [], prices: PricePoint[] = [], rep: { count: number; avg: number } | null = null) {
  const es = lang === "es";
  const loc = es ? "es-AR" : "en-US";
  const rate = Number(v.borrowRateBps) / 10_000;
  const bankRate = Number(REFS.bankLoan.bps) / 10_000;
  const P = 400_000, D = 30;
  const bankCost = Math.round((P * bankRate * D) / 365);
  const ourCost = Math.round((P * rate * D) / 365) + Math.round(P * 0.0025);
  const saving = bankCost - ourCost;
  const canLend = Number(availableToBorrow(v.pool).pesos / 10n ** 18n);
  const start = Math.max(1000, Math.min(5000, Math.floor(canLend / 100) * 100));
  const b = proof?.events.find((e) => e.name === "Borrowed");
  const pct2 = (bps: bigint) => (Number(bps) / 100).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";

  return layout(
    lang,
    es ? "Pesos ya, sin vender tus dólares" : "Pesos now, without selling your dollars",
    html`
<section class="hero"><div class="wrap">
  <div class="hero-in">
    <h1>${es ? "Pesos ya, sin vender tus dólares" : "Pesos now, without selling your dollars"}</h1>
    <p class="lede">${es ? "Dejá USDT en garantía y recibí pesos al instante en MiniPay. Pagás una fracción de lo que cobra el banco, y un agente cuida tu préstamo." : "Leave USDT as a guarantee and get pesos instantly in MiniPay. You pay a fraction of the bank's rate, and an agent looks after your loan."}</p>
    <div class="cta-row"><a class="btn" href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a><a class="btn ghost" href="${href(lang, "/probar")}">${t(lang, "tryIt")}</a></div>
  </div>
  <form class="calc" id="calc" method="get" action="/pedir" data-lang="${lang}" data-bank="${REFS.bankLoan.bps.toString()}" data-rate="${v.borrowRateBps.toString()}" data-price="${(v.borrowPrice ?? v.liquidationPrice).toString()}">
    ${lang === "en" ? html`<input type="hidden" name="lang" value="en">` : ""}
    <div class="c-top"><span class="c-live">${es ? "Tasa en vivo de Celo" : "Live rate from Celo"}</span><span class="small muted">${es ? "bloque" : "block"} <span id="c-block">${v.block.toString()}</span></span></div>
    <div class="field">
      <label for="c-pesos">${es ? "Necesito" : "I need"}</label>
      <div class="in"><input id="c-pesos" name="pesos" inputmode="numeric" autocomplete="off" value="${start.toLocaleString(loc)}"><span class="cur"><span class="flag"></span>ARS</span></div>
    </div>
    <div class="terms">${[7, 30, 60, 90].map((d) => html`<label><input type="radio" name="dias" value="${d}" ${d === 30 ? "checked" : ""}><span>${d}<small>${t(lang, "days")}</small></span></label>`)}</div>
    <div class="lines">
      <div class="ln"><span><span class="ic">${icon("lock")}</span>${es ? "Dejás en garantía" : "You leave as guarantee"}</span><b id="c-coll">—</b></div>
      <div class="ln"><span><span class="ic">${icon("clock")}</span>${es ? "Tasa anual hoy" : "Yearly rate today"}</span><b id="c-rate">${percent(v.borrowRateBps, lang)}</b></div>
      <div class="ln"><span><span class="ic">${icon("coins")}</span>${es ? "Interés + comisión" : "Interest + fee"}</span><b id="c-cost">—</b></div>
      <div class="ln bank"><span><span class="ic">${icon("bank")}</span>${es ? `En el banco (${pct2(REFS.bankLoan.bps)})` : `At the bank (${pct2(REFS.bankLoan.bps)})`}</span><b id="c-bank">—</b></div>
    </div>
    <div class="save-box"><span>${t(lang, "youSave")}</span><b id="c-save">—</b></div>
    <button class="btn block" type="submit" id="c-go">${t(lang, "borrow")}</button>
    <p class="note" id="c-note"></p>
  </form>
</div>
<div class="wrap trust">
  <div><span class="ic">${icon("shield")}</span><b>${es ? "Tu plata en contratos públicos" : "Your money in public contracts"}</b><span>${es ? "Cinco contratos verificados en Celo, sin retiro de administrador" : "Five verified contracts on Celo, no admin withdraw"}</span></div>
  <div><span class="ic">${icon("sliders")}</span><b>${es ? "Un agente con límites" : "An agent with limits"}</b><span>${es ? "Agente ERC-8004 #10043; actúa solo dentro de tu regla" : "ERC-8004 agent #10043; acts only inside your rule"}</span></div>
  <div><span class="ic">${icon("tag")}</span><b>${es ? "Todo a la vista" : "All in the open"}</b><span>${es ? "Cada transacción en la cadena, con la etiqueta del evento" : "Every transaction on chain, with the event's tag"}</span></div>
</div></section>

${agentSection(lang, tickAge, feed, prices, rep)}

<section class="band"><div class="wrap">
  <h2 class="reveal">${es ? "Dejá de pagar la tasa del banco" : "Stop paying the bank's rate"}</h2>
  <p class="lede reveal d1">${es ? `Los bancos cobran ${pct2(REFS.bankLoan.bps)} al año por un préstamo personal (${REFS.bankLoan.source}). Nosotros no vendemos tus dólares ni te cobramos de más: la tasa sale del uso del fondo y la ves antes de firmar.` : `Banks charge ${pct2(REFS.bankLoan.bps)} a year for a personal loan (${REFS.bankLoan.source}). We don't sell your dollars or overcharge: the rate comes from pool use and you see it before you sign.`}</p>
  <div class="cta-row reveal d1"><a class="btn dark" href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a><a class="link-arrow" href="${href(lang, "/como-funciona")}">${t(lang, "how")}</a></div>
  <div class="cmp reveal d2" style="--w:${Math.max(6, Math.round((ourCost / bankCost) * 100))}%">
    <div class="cmp-head"><span>${es ? `Ejemplo: $ 400.000 por ${D} días` : `Example: ARS 400,000 for ${D} days`}</span><span>${es ? "Interés simple a la tasa de hoy" : "Simple interest at today's rate"}</span></div>
    <div class="cmp-grid">
      <div class="opt us"><div class="who">Adelanto <span class="pill celeste">${percent(v.borrowRateBps, lang)} + 0,25%</span></div><div class="amt" data-count="${ourCost}" data-pre="$ " data-locale="${loc}">$ ${num(ourCost, lang)}</div><p>${es ? "Tus dólares quedan en garantía y vuelven cuando pagás." : "Your dollars stay as guarantee and come back when you repay."}</p><div class="bar"><i></i></div></div>
      <div class="opt them"><div class="who">${es ? "Banco" : "Bank"} <span class="pill">${pct2(REFS.bankLoan.bps)}</span></div><div class="amt" data-count="${bankCost}" data-pre="$ " data-locale="${loc}">$ ${num(bankCost, lang)}</div><p>${es ? `Pagás $ ${num(saving, lang)} más por el mismo préstamo.` : `You pay ARS ${num(saving, lang)} more for the same loan.`}</p><div class="bar"><i></i></div></div>
    </div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="feature">
    <div class="reveal">
      <h2>${es ? html`Tu préstamo, <em>cuidado</em>` : html`Your loan, <em>looked after</em>`}</h2>
      <p class="lede">${es ? "Firmás una regla una vez. Si el préstamo se acerca al riesgo, el agente agrega tus propios dólares o paga con tus propios pesos, sin pasarse de tus topes. Si te entran pesos, puede pagar solo. Cada acción cita tu regla." : "You sign a rule once. If the loan nears risk, the agent adds your own dollars or repays with your own pesos, never past your caps. If pesos arrive, it can repay on its own. Every action quotes your rule."}</p>
      <a class="link-arrow" href="${href(lang, "/como-funciona")}">${es ? "Cómo funciona el agente" : "How the agent works"}</a>
    </div>
    <div class="art reveal d1" aria-hidden="true">
      <div class="mini-phone"><div class="scr">
        <div class="t">${t(lang, "myLoan")}</div>
        <div class="big">$ 400.000</div>
        <div class="mtrack"><i></i></div>
        <div class="msg"><b>${es ? "Agente · tu regla" : "Agent · your rule"}</b>${es ? "Tu préstamo llegó al 71%. Agregué US$ 3 de tus dólares y volvió al 60%." : "Your loan reached 71%. I added US$3 of your dollars; it's back to 60%."}</div>
        <div class="mrow"><span>${t(lang, "guarantee")}</span><b>US$ 405</b></div>
        <div class="mrow"><span>${es ? "Vence" : "Due"}</span><b>${es ? "en 30 días" : "in 30 days"}</b></div>
        <div class="mbtn">${t(lang, "payAll")}</div>
      </div></div>
    </div>
  </div>
  <div class="icons3">
    <div class="reveal"><span class="ic">${icon("arrows")}</span><b>${es ? "Nunca mueve plata a otro lado" : "Never moves money elsewhere"}</b><p>${es ? "Solo de tu billetera a tu propio préstamo. Lo hace cumplir el contrato, no nosotros." : "Only from your wallet into your own loan. The contract enforces it, not us."}</p></div>
    <div class="reveal d1"><span class="ic">${icon("sliders")}</span><b>${es ? "Nunca se pasa de tus topes" : "Never goes past your caps"}</b><p>${es ? "Dólares por día, pesos por día y lo que siempre te deja. Le quitás el permiso cuando quieras." : "Dollars a day, pesos a day and what it always leaves you. Take the permission back any time."}</p></div>
    <div class="reveal d2"><span class="ic">${icon("scale")}</span><b>${es ? "Vende lo mínimo, si tiene que vender" : "Sells the least, if it must"}</b><p>${es ? "Solo hasta volver al 78%: en un préstamo de 1.000 USDT perdés US$ 5,80 en vez de US$ 19." : "Only back to 78%: on a 1,000 USDT loan you lose US$5.80 instead of US$19."}</p></div>
  </div>
</div></section>

<section class="wrap cards"><div class="bigcard navy reveal"><div class="bc-grid">
  <div>
    <h2>${es ? html`¿Tenés pesos? <em>Prestalos</em>` : html`Holding pesos? <em>Lend them</em>`}</h2>
    <p class="lede" style="margin:18px 0 26px">${es ? "Quienes piden pagan la tasa del día y el 90% del interés va a quienes prestan. Retirás cuando haya pesos libres en el fondo." : "Borrowers pay the day's rate and 90% of the interest goes to lenders. Withdraw whenever the pool has free pesos."}</p>
    <a class="btn" href="${href(lang, "/prestar")}">${t(lang, "lend")}</a>
  </div>
  <div class="rate-tiles">
    <div class="hi"><b data-count="25.9" data-dec="1" data-post="%" data-locale="${loc}">25,9%</b><span>${es ? "lo que ganás con el fondo prestado al 80%" : "what you earn with the pool 80% lent"}</span></div>
    <div><b>${percent(REFS.badlar.bps, lang)}</b><span>${es ? "BADLAR, depósitos a plazo" : "BADLAR, term deposits"} · ${REFS.badlar.source}</span></div>
  </div>
</div></div></section>

${proof && b ? html`<section class="section"><div class="wrap">
  <div class="proof-head reveal">
    <div><h2>${es ? "Un préstamo real" : "A real loan"}</h2><div class="proof-sum"><span>${es ? "Pidió" : "Borrowed"} <b>${pesos(BigInt(b.args.pesos), lang)}</b></span><span>${es ? "Dejó" : "Left"} <b>${dollars(BigInt(b.args.collateral), lang)}</b></span><span>${es ? "Tasa" : "Rate"} <b>${percent(BigInt(b.args.rateBps), lang)}</b></span><span class="pill ok" style="font-size:15px;padding:8px 14px">${proof.loan.open ? t(lang, "open") : t(lang, "closed")}</span></div></div>
    <p class="lede" style="margin:0;max-width:26em">${es ? "En Celo, con wARS de verdad, desde una billetera nuestra. Tocá cualquier paso para verlo en el explorador." : "On Celo, with real wARS, from one of our own wallets. Tap any step to see it on the explorer."}</p>
  </div>
  <div class="steps-row">${proof.events.map((e, i) => html`<a class="st reveal" style="text-decoration:none;color:inherit;transition-delay:${i * 60}ms" href="${txUrl(e.tx)}"><span class="n">${i + 1}</span><b>${eventLine(e, lang)}</b><span class="tx">${short(e.tx)} ↗</span></a>`)}</div>
  <p style="margin-top:24px"><a class="link-arrow" href="${href(lang, `/prestamo/${proof.loan.id}`)}">${es ? "Ver el préstamo completo" : "See the full loan"}</a> &nbsp; <a class="link-arrow" href="${href(lang, "/transparencia")}">${t(lang, "transparency")}</a></p>
</div></section>` : ""}

<section class="wrap cards"><div class="bigcard photo-card reveal">
  <img src="/static/img/kiosco-1600.webp" srcset="/static/img/kiosco-800.webp 800w, /static/img/kiosco-1600.webp 1600w" sizes="(max-width: 1200px) 100vw, 1200px" alt="${es ? "Alfajores en un kiosco de Buenos Aires" : "Alfajores in a Buenos Aires kiosk"}" loading="lazy">
  <span class="credit">Just a Man · CC BY 4.0</span>
  <div class="pc-body">
    <h2>${es ? "Para el kiosco, el alquiler, el fin de mes" : "For the shop, the rent, the end of the month"}</h2>
    <p class="lede">${es ? `Lucía (un ejemplo) tiene un kiosco en Caballito y ahorra en dólares. Para reponer $ 400.000 este mes, el banco le cobraría $ ${num(bankCost, lang)} de interés. Con Adelanto paga $ ${num(ourCost, lang)} y sus dólares siguen siendo suyos.` : `Lucía (an example) runs a kiosk in Caballito and saves in dollars. To restock ARS 400,000 this month, the bank would charge ARS ${num(bankCost, lang)} in interest. With Adelanto she pays ARS ${num(ourCost, lang)} and her dollars stay hers.`}</p>
    <a class="btn light" href="${href(lang, "/probar")}">${t(lang, "tryIt")}</a>
  </div>
</div></section>

<section class="section"><div class="wrap faq">
  <div class="reveal"><h2>${es ? "Preguntas frecuentes" : "Questions"}</h2></div>
  <div class="reveal d1">
    <details><summary>${es ? "¿Qué pasa si no pago a tiempo?" : "What if I don't repay on time?"}</summary><p>${es ? "La tasa sube 5 puntos hasta que pagues y, a los 7 días, tu historial lo marca como atrasado. Nunca se vende tu garantía por pagar tarde: solo el precio puede hacer que se venda una parte." : "The rate rises 5 points until you repay and, after 7 days, your record marks it late. Your guarantee is never sold for paying late: only the price can trigger a partial sale."}</p></details>
    <details><summary>${es ? "¿Quién tiene mis dólares?" : "Who holds my dollars?"}</summary><p>${es ? "El contrato PesoPool en Celo. No tiene ninguna función para que un administrador los retire. Vuelven a tu billetera cuando pagás." : "The PesoPool contract on Celo. It has no function that lets an administrator withdraw them. They return to your wallet when you repay."}</p></details>
    <details><summary>${es ? "¿Qué son los wARS?" : "What is wARS?"}</summary><p>${es ? "Pesos digitales de Ripio: 1 wARS = 1 peso. Los podés usar en Celo o pasarlos a tu cuenta bancaria con Ripio: el botón «Mandar a mi banco» está en tu préstamo." : "Ripio's digital pesos: 1 wARS = 1 peso. Use them on Celo or move them to your bank account with Ripio: the “Send to my bank” button is on your loan."}</p></details>
    <details><summary>${es ? "¿Cuándo hay riesgo?" : "When is there risk?"}</summary><p>${es ? "Debés pesos y dejaste dólares: si el peso cae, tu préstamo está más seguro. El riesgo llega si el peso se fortalece mucho. Al 70% el agente te protege; pasando el 80% se vende solo lo justo para volver al 78%." : "You owe pesos and left dollars: if the peso falls, your loan gets safer. Risk comes if the peso strengthens a lot. At 70% the agent protects you; past 80% only enough is sold to get back to 78%."}</p></details>
    <details><summary>${es ? "¿Y si Ripio congela los wARS?" : "What if Ripio freezes wARS?"}</summary><p>${es ? "Tras 24 horas congelados, cada persona puede recuperar sus dólares hasta la línea del 70%. Está escrito en el contrato y probado." : "After 24 hours frozen, each borrower can take their dollars back down to the 70% line. It is written in the contract and tested."}</p></details>
    <details><summary>${es ? "¿De dónde sale el precio del dólar?" : "Where does the dollar price come from?"}</summary><p>${es ? "Del fondo wARS/USDT de Uniswap en Celo, promedio de 30 minutos. El agente lo compara cada minuto con Binance y dolarapi; si no coinciden, pausa préstamos nuevos." : "From the wARS/USDT Uniswap pool on Celo, as a 30-minute average. The agent compares it every minute with Binance and dolarapi; if they disagree, it pauses new loans."}</p></details>
  </div>
</div></section>`,
    { path: "/" },
  );
}

export function eventLine(e: { name: string; args: any; byAgent?: boolean }, lang: Lang): string {
  const a = e.args;
  const es = lang === "es";
  if (e.byAgent && e.name === "Repaid") return es ? `El agente pagó ${pesos(BigInt(a.pesos))} con tus pesos; quedan ${pesos(BigInt(a.debtLeft))}` : `The agent repaid ${pesos(BigInt(a.pesos), "en")} with your pesos; ${pesos(BigInt(a.debtLeft), "en")} left`;
  if (e.byAgent && e.name === "CollateralAdded") return es ? `El agente agregó ${dollars(BigInt(a.usdt))} de tus dólares` : `The agent added ${dollars(BigInt(a.usdt), "en")} of your dollars`;
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
    case "AutoRepaid":
      return es ? `El agente pagó ${pesos(BigInt(a.warsRepaid))} con pesos que te entraron` : `The agent repaid ${pesos(BigInt(a.warsRepaid), "en")} with pesos that arrived`;
    case "Protected":
    case "ProtectedByRepay":
      return es ? "El agente protegió el préstamo" : "The agent protected the loan";
    case "PenaltyAdded":
      return es ? `Interés por atraso: ${pesos(BigInt(a.pesos))}` : `Late interest: ${pesos(BigInt(a.pesos), "en")}`;
    default:
      return e.name;
  }
}

// ---------------------------------------------------------------- borrow

export function borrowPage(lang: Lang, v: PoolView, input: { pesos: string; days: number }, q: Quote | { ok: false; reason: string; limit?: bigint } | null) {
  const es = lang === "es";
  const days = [7, 30, 60, 90];
  return layout(
    lang,
    t(lang, "borrow"),
    html`${appHead(es ? "Pedir pesos" : "Borrow pesos", es ? html`¿Cuántos pesos <em>necesitás?</em>` : html`How many pesos <em>do you need?</em>`, es ? "Ves el costo completo, comparado con el banco, antes de firmar nada." : "You see the full cost, against the bank, before you sign anything.")}
<section class="app-main"><div class="narrow">
${stateNotice(v, lang)}
<form method="get" action="/pedir" class="card">
  ${lang === "en" ? html`<input type="hidden" name="lang" value="en">` : ""}
  <label for="pesos" style="margin-top:0">${t(lang, "howMany")}</label>
  <div class="money"><input id="pesos" name="pesos" inputmode="numeric" pattern="[0-9.]*" value="${input.pesos}" autocomplete="off" aria-describedby="pool-free"></div>
  <p class="small muted" id="pool-free" style="margin:8px 0 0">${es ? "Libres para prestar hoy" : "Free to lend today"}: ${pesos(v.pool.cash, lang)} · ${es ? "mínimo" : "minimum"} ${pesos(1000n * 10n ** 18n, lang)}</p>
  <label>${t(lang, "forHowLong")}</label>
  <div class="terms">${days.map((d) => html`<label><input type="radio" name="dias" value="${d}" ${d === input.days ? "checked" : ""}><span>${d}<small>${t(lang, "days")}</small></span></label>`)}</div>
  <button class="btn ghost block" type="submit" style="margin-top:20px">${t(lang, "seeQuote")}</button>
</form>
${q ? quoteCard(lang, v, q) : ""}
</div></section>`,
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
  const es = lang === "es";
  if (!q.ok) return html`<div class="notice" style="margin-top:14px">${refusal(lang, q)}</div>`;
  const cost = networkCostUsd(v, 450_000n);
  return html`<div class="card reveal" style="margin-top:14px">
  <div class="card-label">${t(lang, "youGet")}</div>
  <div class="figure">${pesos(q.received, lang)}</div>
  <div class="vs" style="margin:22px 0 8px">
    <div class="card"><div class="card-label">Adelanto</div><div class="figure sm num">${percent(q.rateBps, lang)}</div><div class="small muted">${es ? "tasa anual hoy" : "yearly rate today"}</div></div>
    <div class="card them"><div class="card-label">${es ? "Banco" : "Bank"}</div><div class="figure sm num">${percent(REFS.bankLoan.bps, lang)}</div><div class="small muted">${REFS.bankLoan.source}</div></div>
  </div>
  <div class="row"><span>${t(lang, "youLeave")}</span><span class="v">${dollars(q.collateral, lang)}</span></div>
  <div class="row"><span>${t(lang, "fee")}</span><span class="v">${pesos(q.fee, lang)}</span></div>
  <div class="row"><span>${t(lang, "interest")} (${q.termDays} ${t(lang, "days")})</span><span class="v">${pesos(q.interest, lang)}</span></div>
  <div class="row"><span>${t(lang, "atBank")}</span><span class="v muted">${pesos(q.bankInterest, lang)}</span></div>
  <div class="row"><span>${t(lang, "networkCost")}</span><span class="v">${usd(cost, lang)}</span></div>
  <div class="row total"><span>${t(lang, "owedAtEnd")}</span><span class="v">${pesos(q.owedAtTerm, lang)}</span></div>
  <div class="row"><span><b>${t(lang, "youSave")}</b></span><span class="v save">${pesos(q.saving, lang)}</span></div>
  <div class="notice" style="margin-top:18px;background:var(--paper-2);border-color:var(--line);color:var(--ink-2)">
    <p class="small" style="margin:0 0 6px">${t(lang, "riskLine")} <b>${pesos(q.riskPrice, lang)}</b> ${es ? "por dólar" : "per dollar"} (${es ? "hoy" : "today"} ${pesos(v.liquidationPrice, lang)}), ${t(lang, "riskLineEnd")}</p>
    <p class="small" style="margin:0 0 6px">${t(lang, "saleLine")} <b>${pesos(q.salePrice, lang)}</b>, ${t(lang, "saleLineEnd")}</p>
    <p class="small muted" style="margin:0">${t(lang, "borrowRisk")}</p>
  </div>
  <div id="status"></div>
  <button class="btn sol block" style="margin-top:18px" data-action="borrow" data-pesos="${q.pesos.toString()}" data-days="${q.termDays}" data-collateral="${q.collateral.toString()}" data-maxrate="${q.maxRateBps.toString()}" data-lang="${lang}">${t(lang, "confirm")} ${pesos(q.pesos, lang)} <span class="arrow">→</span></button>
  <p class="small muted" style="text-align:center;margin:12px 0 0">${es ? "Dos toques en tu billetera: firmás el uso exacto de tus dólares y confirmás el préstamo." : "Two taps in your wallet: you sign the exact use of your dollars and confirm the loan."}</p>
</div>`;
}

// ---------------------------------------------------------------- loan

/** Ripio's off-ramp: wARS to an Argentine bank account. It needs no partner keys; Ripio asks the person for their email and ID. */
export const ripioOffRamp = (pesosWhole: bigint) => `https://ramp.ripio.com/off-ramp?country=AR&chain=42220&token=WARS&amount=${pesosWhole.toString()}`;

/** "Send the pesos to my bank", prefilled with what the loan paid out (pesos minus the opening fee). */
export function cashOut(lang: Lang, events: { name: string; args: any }[]) {
  const b = events.find((e) => e.name === "Borrowed");
  if (!b) return "";
  const es = lang === "es";
  const paid = BigInt(b.args.pesos) - BigInt(b.args.fee ?? 0);
  const whole = paid / 10n ** 18n;
  if (whole <= 0n) return "";
  return html`<div class="card cashout">
  <div class="card-label">${es ? "¿Los querés en el banco?" : "Want them in your bank?"}</div>
  <h3>${es ? html`Pasá ${pesos(whole * 10n ** 18n, lang)} a tu cuenta con Ripio` : html`Move ${pesos(whole * 10n ** 18n, lang)} to your account with Ripio`}</h3>
  <ol class="steps-sm">
    <li>${es ? "Abrís Ripio con el monto ya cargado." : "Open Ripio with the amount filled in."}</li>
    <li>${es ? "La primera vez te pide tu email y validar tu identidad." : "The first time, it asks for your email and to verify your ID."}</li>
    <li>${es ? "Elegís tu CBU o CVU y mandás los wARS desde esta billetera a la dirección que te muestra Ripio." : "Choose your CBU or CVU and send the wARS from this wallet to the address Ripio shows you."}</li>
  </ol>
  <a class="btn ghost block" href="${ripioOffRamp(whole)}" target="_blank" rel="noopener">${es ? "Mandar a mi banco con Ripio" : "Send to my bank with Ripio"} <span class="arrow">↗</span></a>
  <p class="small muted" style="margin:10px 0 0">${es ? "Es la página de Ripio, que emite los wARS; nosotros no vemos tus datos." : "It is Ripio's own page, the issuer of wARS; we never see your details."}</p>
</div>`;
}

const starsText = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/**
 * After a loan closes, its borrower can rate the agent on ERC-8004 (one transaction, their own wallet). Never offered
 * on our own wallets' loans. `rated` is the borrower's rating of this loan if they already gave one.
 */
export function rateCard(lang: Lang, loan: LoanView, rated: number | null | undefined) {
  if (loan.open || labelOf(loan.borrower) === "OURS" || rated === undefined) return "";
  const es = lang === "es";
  if (rated !== null)
    return html`<div class="card"><div class="card-label">${es ? "Tu calificación del agente" : "Your rating of the agent"}</div><div class="stars-done" aria-label="${rated} / 5">${starsText(rated)}</div><p class="small muted" style="margin:8px 0 0">${es ? "Escrita en Celo, en el registro ERC-8004 del agente #10043." : "Written on Celo, in agent #10043's ERC-8004 record."}</p></div>`;
  return html`<div class="card rate">
  <div class="card-label">${es ? "¿Cómo te cuidó el agente?" : "How did the agent look after you?"}</div>
  <h3>${es ? "Calificá al agente" : "Rate the agent"}</h3>
  <p class="small" style="margin:0 0 12px">${es ? "Solo quien pidió este préstamo puede calificarlo, una vez, con su billetera. Queda en Celo, en el registro ERC-8004 del agente #10043, con este préstamo como prueba." : "Only the wallet that took this loan can rate it, once. It is written on Celo, in agent #10043's ERC-8004 record, with this loan as the evidence."}</p>
  <div class="stars" role="group" aria-label="${es ? "Calificación" : "Rating"}">${[1, 2, 3, 4, 5].map((n) => html`<button type="button" data-action="rateAgent" data-loan="${loan.id.toString()}" data-stars="${n}" data-borrower="${loan.borrower}" data-lang="${lang}" aria-label="${n} / 5">★</button>`)}</div>
  <div id="status"></div>
</div>`;
}

export function loanPage(lang: Lang, v: PoolView, loan: LoanView, events: any[], actions: any[], rated?: number | null) {
  const es = lang === "es";
  const widthPct = Math.min(100, Number(loan.ltvBps) / 80);
  const bandWord = { tranquilo: es ? "Tranquilo" : "Calm", atencion: es ? "Atención" : "Watch", riesgo: es ? "Riesgo" : "At risk", liquidable: es ? "Se puede vender parte de tu garantía" : "Part of the guarantee can be sold" }[loan.band];
  return layout(
    lang,
    `${t(lang, "myLoan")} ${loan.id}`,
    html`${appHead(`${t(lang, "myLoan")} #${loan.id.toString()}`, loan.open ? html`${pesos(loan.debt, lang)}` : html`${t(lang, "closed")}<em>.</em>`, loan.open ? (es ? "Lo que debés ahora, con el interés de hoy." : "What you owe now, with today's interest.") : undefined, true)}
<section class="app-main"><div class="wrap"><div class="split">
<div>
${loan.open
  ? html`<div class="card">
  <div class="card-label">${t(lang, "health")} · <span class="band-${loan.band}">${bandWord}</span> · ${pillFor(loan.borrower, lang)}</div>
  <div class="meter ${loan.band}">
    <div class="track"><div class="fill" data-w="${widthPct}%" style="width:0"></div></div>
    <div class="mark" style="left:75%"><span>60%</span></div>
    <div class="mark" style="left:87.5%"><span>70%</span></div>
    <div class="mark" style="left:100%"><span>80%</span></div>
  </div>
  <p class="small">${es ? `Pediste el ${percent(loan.ltvBps, lang)} de lo que dejaste. Entra en riesgo con el dólar a ` : `You borrowed ${percent(loan.ltvBps, lang)} of what you left. It reaches risk with the dollar at `}<b>${pesos(loan.riskPrice, lang)}</b> (${es ? "hoy" : "today"} ${pesos(v.liquidationPrice, lang)}).</p>
  <div class="row"><span>${t(lang, "guarantee")}</span><span class="v">${dollars(loan.collateral, lang)}</span></div>
  <div class="row"><span>${t(lang, "due")}</span><span class="v">${date(loan.dueAt, lang)}</span></div>
  <div id="status"></div>
  <button class="btn sol block" style="margin-top:18px" data-action="repayAll" data-loan="${loan.id.toString()}" data-lang="${lang}">${t(lang, "payAll")} <span class="arrow">→</span></button>
  <label class="small" for="loan-amount" style="display:block;margin-top:14px">${es ? "Para pagar una parte (pesos) o agregar dólares, escribí el monto:" : "To repay part (pesos) or add dollars, enter the amount:"}</label>
  <input id="loan-amount" inputmode="decimal" autocomplete="off" style="width:100%;margin-top:6px">
  <div class="btns">
    <button class="btn ghost" data-action="repayPart" data-loan="${loan.id.toString()}" data-lang="${lang}">${t(lang, "payPart")}</button>
    <button class="btn ghost" data-action="addCollateral" data-loan="${loan.id.toString()}" data-lang="${lang}">${t(lang, "addDollars")}</button>
  </div>
</div>
<div class="card" style="${loan.guard ? "" : "background:var(--ink);color:var(--paper);border-color:transparent"}">
  <div class="card-label" style="${loan.guard ? "" : "color:rgba(244,239,228,.6)"}">${es ? "El agente" : "The agent"}</div>
  <h3 style="${loan.guard ? "" : "color:var(--paper)"}">${loan.guard ? t(lang, "guardOn") : t(lang, "guardOff")}</h3>
  ${loan.guard ? guardWords(lang, loan.guard.limits) : html`<p class="small" style="color:rgba(244,239,228,.75)">${es ? "Con un permiso que firmás una vez, el agente puede agregar tus dólares o pagar con tus pesos cuando el préstamo llega a riesgo, sin pasarse de tus límites." : "With one permission you sign once, the agent can add your dollars or repay with your pesos when the loan reaches risk, never beyond your limits."}</p>`}
  <a class="btn ${loan.guard ? "ghost" : "light"} block" style="margin-top:14px" href="${href(lang, `/cuidar/${loan.id}`)}">${t(lang, "guard")} <span class="arrow">→</span></a>
</div>
${cashOut(lang, events)}`
  : html`<div class="card"><div class="card-label">${es ? "Estado" : "Status"} · ${pillFor(loan.borrower, lang)}</div><h3>${loan.liquidated ? (es ? "Se vendió parte de la garantía." : "Part of the guarantee was sold.") : es ? "Pagado. Los dólares volvieron a su billetera." : "Repaid. The dollars went back to the wallet."}</h3>
  <p style="margin:12px 0 0"><a class="link-arrow" href="${href(lang, `/historial?w=${loan.borrower}`)}">${es ? "Ver el historial de esta billetera" : "See this wallet's record"}</a></p></div>
${rateCard(lang, loan, rated)}`}
</div>
<div>
<div class="card">
  <div class="card-label">${t(lang, "agentDid")}</div>
  ${actions.length === 0 ? html`<p class="small muted" style="margin:0">${es ? "Todavía nada: el préstamo no lo necesitó." : "Nothing yet: the loan has not needed it."}</p>` : html`<ul class="log">${actions.map((a) => html`<li>${es ? a.sentence_es : a.sentence_en}${a.tx ? html`<br><a class="tx" href="${txUrl(a.tx)}">${short(a.tx)}</a>` : ""}</li>`)}</ul>`}
</div>
<div class="card">
  <div class="card-label">${t(lang, "history")}</div>
  <ul class="log">${events.map((e) => html`<li>${eventLine(e, lang)}<br><a class="tx" href="${txUrl(e.tx)}">${short(e.tx)}</a></li>`)}</ul>
  <p class="small muted" style="margin:18px 0 0">${es ? "Billetera" : "Wallet"} <a class="tx" href="${addrUrl(loan.borrower)}">${short(loan.borrower)}</a> · ${t(lang, "updated")} ${v.block.toString()}</p>
</div>
</div>
</div></div></section>`,
    { path: `/prestamo/${loan.id}`, wallet: loan.open || rated === null },
  );
}

function guardWords(lang: Lang, l: any) {
  const es = lang === "es";
  const parts: string[] = [];
  if (l.autoRepay && l.maxRepayWarsPerDay > 0n) parts.push(es ? `cuando te entran pesos, paga el préstamo con ellos, hasta ${pesos(l.maxRepayWarsPerDay)} por día` : `when pesos arrive, it repays the loan with them, up to ${pesos(l.maxRepayWarsPerDay, "en")} a day`);
  else if (l.maxRepayWarsPerDay > 0n) parts.push(es ? `si llega a riesgo, paga con tus pesos hasta ${pesos(l.maxRepayWarsPerDay)} por día` : `if it reaches risk, it repays from your pesos, up to ${pesos(l.maxRepayWarsPerDay, "en")} a day`);
  if (l.maxTopUpUsdtPerDay > 0n) parts.push(es ? `si llega a riesgo, agrega hasta ${dollars(l.maxTopUpUsdtPerDay)} por día de tus dólares` : `if it reaches risk, it adds up to ${dollars(l.maxTopUpUsdtPerDay, "en")} a day of your dollars`);
  else parts.push(es ? "nunca toca tus dólares" : "it never touches your dollars");
  if (l.keepWarsBuffer > 0n) parts.push(es ? `siempre te deja ${pesos(l.keepWarsBuffer)}` : `it always leaves you ${pesos(l.keepWarsBuffer, "en")}`);
  if (!l.autoRepay && l.maxRepayWarsPerDay === 0n && l.maxTopUpUsdtPerDay === 0n) return html`<p class="small">${es ? "No mueve plata: solo te avisa." : "It moves no money: it only tells you."} ${es ? "Vence el" : "Until"} ${date(l.expiry, lang)}.</p>`;
  const list = parts.join("; ");
  return html`<p class="small">${list.charAt(0).toUpperCase() + list.slice(1)}. ${es ? "Vence el" : "Until"} ${date(l.expiry, lang)}.</p>`;
}

// ---------------------------------------------------------------- guard

export function guardPage(lang: Lang, loan: LoanView, words: string | null, prefill = "") {
  const es = lang === "es";
  const presets = [
    { id: "cuidalo", es: "Cuidalo con hasta US$ 10 por semana", en: "Protect it with up to US$10 a week", sub: { es: "Agrega tus dólares si llega a riesgo", en: "Adds your dollars if it reaches risk" } },
    { id: "pesos", es: "Pagá con mis pesos cuando entren", en: "Repay with my pesos when they arrive", sub: { es: "Usa lo que te llega, nada más", en: "Uses what arrives, nothing else" } },
    { id: "avisame", es: "No hagas nada sin preguntarme", en: "Do nothing without asking me", sub: { es: "Solo te avisa", en: "Only tells you" } },
  ];
  if (!loan.open)
    return plain(lang, t(lang, "guard"), html`<div class="card"><p style="margin:0">${es ? "Este préstamo ya está cerrado, así que el agente no actúa más en él." : "This loan is closed, so the agent no longer acts on it."}${words ? html` ${es ? "Su regla era:" : "Its rule was:"}</p><p class="quote" style="font-size:22px;margin:10px 0 0">«${words}»</p>` : html`</p>`}</div>
<p style="margin-top:22px"><a href="${href(lang, `/prestamo/${loan.id}`)}">← ${es ? "Volver al préstamo" : "Back to the loan"}</a> &nbsp; <a href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a></p>`, `/cuidar/${loan.id}`, { eyebrow: `${t(lang, "guard")} · #${loan.id.toString()}`, heading: es ? html`Préstamo <em>cerrado.</em>` : html`Loan <em>closed.</em>` });
  return layout(
    lang,
    t(lang, "guard"),
    html`${appHead(`${t(lang, "guard")} · #${loan.id.toString()}`, es ? html`Decile al agente <em>qué puede hacer.</em>` : html`Tell the agent <em>what it may do.</em>`, es ? "Cuando tu préstamo llega a riesgo (70%), actúa dentro de esto. El contrato no lo deja pasarse, nunca mueve plata a otro lado y le quitás el permiso cuando quieras." : "When your loan reaches risk (70%), it acts inside this. The contract never lets it go further or move money anywhere else, and you can take the permission away at any time.")}
<section class="app-main"><div class="narrow">
${loan.guard
  ? html`<div class="card"><div class="card-label">${t(lang, "guardOn")}</div>${guardWords(lang, loan.guard.limits)}${words ? html`<p class="quote" style="font-size:24px;margin:10px 0">«${words}»</p>` : ""}
  <div id="status"></div><button class="btn ghost block" data-action="revokeGuard" data-lang="${lang}">${es ? "Quitarle el permiso al agente" : "Take the agent's permission away"}</button></div>`
  : ""}
<div class="card">
  <div class="card-label">${es ? "Decíselo con tus palabras" : "Say it in your own words"}</div>
  <label for="rule-text" class="small">${es ? "Por ejemplo: «Cuando me entren pesos de las ventas, pagá el préstamo. Nunca vendas mis dólares.»" : "For example: \"When pesos from my sales arrive, repay the loan. Never sell my dollars.\""}</label>
  <textarea id="rule-text" rows="3" maxlength="600" style="width:100%;font:inherit;font-size:18px;padding:12px 14px;border-radius:16px;border:1.5px solid var(--line);margin-top:8px" placeholder="${es ? "Escribí tu regla" : "Write your rule"}">${prefill}</textarea>
  <div style="display:flex;gap:10px;margin-top:12px">
    <button class="btn ghost" data-action="dictate" data-lang="${lang}" hidden style="gap:8px"><span style="width:20px;height:20px;display:inline-flex">${icon("mic")}</span>${es ? "Dictar" : "Dictate"}</button>
    <button class="btn" style="flex:1;min-width:0;padding:0 16px" data-action="parseWords" data-loan="${loan.id.toString()}" data-debt="${loan.debt.toString()}" data-lang="${lang}">${es ? "Ver qué va a hacer" : "See what it will do"}</button>
  </div>
  <div id="rule-question" hidden style="margin-top:14px"></div>
</div>
<div class="card">
  <div class="card-label">${es ? "Elegí una" : "Pick one"}</div>
  <div style="display:grid;gap:10px;grid-template-columns:minmax(0,1fr)">
  ${presets.map((p) => html`<button class="btn ghost block" style="justify-content:space-between;text-align:left;min-height:70px;padding:12px 18px" data-action="preset" data-preset="${p.id}" data-loan="${loan.id.toString()}" data-debt="${loan.debt.toString()}" data-lang="${lang}"><span>${es ? p.es : p.en}<br><small class="muted" style="font-weight:400">${es ? p.sub.es : p.sub.en}</small></span><span class="arrow">→</span></button>`)}
  </div>
</div>
<details class="card"><summary>${es ? "Armar mi propia regla" : "Make my own rule"}</summary>
  <label for="g-usd">${es ? "Dólares por día que puede agregar (0 = nunca)" : "Dollars a day it may add (0 = never)"}</label><input id="g-usd" inputmode="decimal" value="1">
  <label for="g-pesos">${es ? "Pesos por día que puede pagar con tu plata (0 = nunca)" : "Pesos a day it may repay from your money (0 = never)"}</label><input id="g-pesos" inputmode="numeric" value="0">
  <label class="check"><input type="checkbox" id="g-auto"> ${es ? "Cuando me entren pesos, pagá el préstamo" : "When pesos arrive, repay the loan"}</label>
  <label for="g-keep">${es ? "Pesos que siempre te deja" : "Pesos it always leaves you"}</label><input id="g-keep" inputmode="numeric" value="0">
  <label class="check"><input type="checkbox" id="g-rate" checked> ${es ? "Avisame si aparece una tasa más barata" : "Tell me if a cheaper rate appears"}</label>
  <button class="btn block" style="margin-top:18px" data-action="customGuard" data-loan="${loan.id.toString()}" data-debt="${loan.debt.toString()}" data-lang="${lang}">${es ? "Ver mi regla" : "See my rule"}</button>
</details>
<div class="card" id="readback" hidden style="background:var(--celeste-wash);border-color:var(--ink)">
  <div class="card-label">${es ? "Esto es lo que vas a firmar" : "This is what you will sign"}</div>
  <p id="rule-words" class="quote" style="font-size:24px"></p>
  <p id="rule-readback" class="small" hidden></p>
  <div id="status"></div>
  <button class="btn block" data-action="signGuard" data-loan="${loan.id.toString()}" data-lang="${lang}">${es ? "Firmar" : "Sign"} <span class="arrow">→</span></button>
</div>
<p style="margin-top:22px"><a href="${href(lang, `/prestamo/${loan.id}`)}">← ${es ? "Volver al préstamo" : "Back to the loan"}</a></p>
</div></section>`,
    { path: `/cuidar/${loan.id}`, wallet: true },
  );
}

// ---------------------------------------------------------------- lend

export function lendPage(lang: Lang, v: PoolView) {
  const es = lang === "es";
  return layout(
    lang,
    t(lang, "lend"),
    html`${appHead(es ? "Prestar pesos" : "Lend pesos", es ? html`Tus pesos, <em>trabajando.</em>` : html`Your pesos, <em>at work.</em>`, t(lang, "lendTitle"), true)}
<section class="app-main"><div class="wrap"><div class="split">
<div>
${v.paused ? html`<div class="notice">${es ? "Los depósitos nuevos están en pausa mientras los precios no coinciden. Retirar funciona igual." : "New deposits are paused while prices disagree. Withdrawing still works."}</div>` : ""}
<div class="card">
  <div id="mine" class="small muted"></div>
  <label for="amount" style="margin-top:0">${es ? "Pesos (wARS)" : "Pesos (wARS)"}</label>
  <div class="money"><input id="amount" inputmode="numeric" pattern="[0-9.]*" placeholder="10000"></div>
  <div id="status"></div>
  <div class="btns" style="margin-top:16px">
    <button class="btn sol" data-action="deposit" data-lang="${lang}">${t(lang, "deposit")}</button>
    <button class="btn ghost" data-action="withdraw" data-lang="${lang}">${t(lang, "withdraw")}</button>
  </div>
  <p class="small muted" style="margin:16px 0 0">${t(lang, "lendRisk")}</p>
</div>
</div>
<div>
<div class="vs">
  <div class="card"><div class="card-label">${t(lang, "lendersEarn")}</div><div class="figure sm num">${percent(v.lenderRateBps, lang)}</div><div class="small muted">${es ? "hoy, sube con el uso" : "today, rises with use"}</div></div>
  <div class="card them" style="text-decoration:none"><div class="card-label">BADLAR</div><div class="figure sm num" style="text-decoration:none;color:var(--ink-2)">${percent(REFS.badlar.bps, lang)}</div><div class="small muted">${REFS.badlar.source}</div></div>
</div>
<div class="card">
  <div class="card-label">${es ? "El fondo, en vivo" : "The pool, live"}</div>
  <div class="row"><span>${t(lang, "deposited")}</span><span class="v">${pesos(v.totalAssets, lang)}</span></div>
  <div class="row"><span>${t(lang, "poolLent")}</span><span class="v">${pesos(v.pool.totalDebt, lang)}</span></div>
  <div class="row"><span>${t(lang, "poolFree")}</span><span class="v">${pesos(v.pool.cash, lang)}</span></div>
  <div class="row"><span>${t(lang, "poolUse")}</span><span class="v">${percent(v.utilizationBps, lang)}</span></div>
  <p class="small muted" style="margin:14px 0 0">${es ? "Quienes piden pagan la tasa del día; el 90% va a quienes prestan y el 10% forma una reserva que cubre primero cualquier préstamo que su garantía no alcance." : "Borrowers pay the day's rate; 90% goes to lenders and 10% builds a reserve that covers first any loan its guarantee does not."} ${t(lang, "updated")} <a href="https://celoscan.io/block/${v.block}">${v.block.toString()}</a>.</p>
</div>
</div>
</div></div></section>`,
    { path: "/prestar", wallet: true },
  );
}

// ---------------------------------------------------------------- simple pages

/** A content page with a header; `wide` for tables and lists. */
export function plain(lang: Lang, title: string, body: H, path: string, opts: { eyebrow?: string; heading?: H | string; lede?: string; wide?: boolean; wallet?: boolean } = {}) {
  return layout(
    lang,
    title,
    html`${appHead(opts.eyebrow ?? title, opts.heading ?? title, opts.lede, opts.wide)}
<section class="app-main"><div class="${opts.wide ? "wrap" : "narrow"}">${body}</div></section>`,
    { path, wallet: opts.wallet },
  );
}

// ---------------------------------------------------------------- the agent's own actions

const JOB: Record<string, { es: string; en: string }> = {
  A1_protect: { es: "Protegió un préstamo", en: "Protected a loan" },
  A2_autorepay: { es: "Pagó con pesos que entraron", en: "Repaid with pesos that arrived" },
  A3_ratewatch: { es: "Avisó de una tasa mejor", en: "Flagged a better rate" },
  A4_pause: { es: "Frenó por el precio", en: "Paused on the price" },
  A5_gentle: { es: "Vendió lo mínimo", en: "Sold the least" },
};

export function ago(ms: number, lang: Lang): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  const es = lang === "es";
  if (s < 90) return es ? "hace un momento" : "just now";
  const m = Math.round(s / 60);
  if (m < 90) return es ? `hace ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return es ? `hace ${h} h` : `${h} h ago`;
  const d = Math.round(h / 24);
  return es ? `hace ${d} días` : `${d} days ago`;
}

/** One line per thing the agent did on chain, newest first, with its sentence and its transaction. */
export function agentFeed(lang: Lang, actions: any[]) {
  const es = lang === "es";
  if (actions.length === 0) return html`<p class="small muted" style="margin:0">${es ? "Todavía no actuó en ningún préstamo." : "It has not acted on a loan yet."}</p>`;
  return html`<ul class="feed">${actions.map((a) => {
    const j = JOB[a.job] ?? { es: a.job, en: a.job };
    return html`<li>
  <div class="feed-top"><b>${es ? j.es : j.en}</b><span class="small muted">${ago(Number(a.at), lang)}</span></div>
  <p>${es ? a.sentence_es : a.sentence_en ?? a.sentence_es}</p>
  <div class="small">${a.loan_id ? html`<a href="${href(lang, `/prestamo/${a.loan_id}`)}">${es ? "Préstamo" : "Loan"} #${a.loan_id}</a> · ` : ""}${a.tx ? html`<a class="tx" href="${txUrl(a.tx)}">${short(a.tx)} ↗</a>` : html`<span class="muted">${es ? "sin transacción" : "no transaction"}</span>`}</div>
</li>`;
  })}</ul>`;
}

/** The home page's agent block: is it running, the rule it last acted on, and what it did on chain. */
/** The agent's ERC-8004 rating from borrowers of closed loans, when there is one. */
export function repLine(lang: Lang, rep: { count: number; avg: number } | null) {
  if (!rep) return "";
  const es = lang === "es";
  const avg = rep.avg.toLocaleString(es ? "es-AR" : "en-US", { maximumFractionDigits: 1 });
  return html`<p class="rep-line"><span class="stars-done" aria-hidden="true">${starsText(Math.round(rep.avg))}</span> <b>${avg}</b> / 5 · ${es
    ? `${rep.count} ${rep.count === 1 ? "calificación" : "calificaciones"} en ERC-8004, solo de quienes cerraron un préstamo`
    : `${rep.count} ERC-8004 ${rep.count === 1 ? "rating" : "ratings"}, only from people who closed a loan`}</p>`;
}

function agentSection(lang: Lang, tickAge: number | null, feed: any[], prices: PricePoint[] = [], rep: { count: number; avg: number } | null = null) {
  const es = lang === "es";
  const live = tickAge !== null && tickAge < 5 * 60_000;
  const quoted = feed.map((a) => /«([^»]+)»/.exec(a.sentence_es ?? "")?.[1]).find(Boolean);
  const secs = tickAge === null ? null : Math.max(1, Math.round(tickAge / 1000));
  return html`<section class="section agent-sec"><div class="wrap"><div class="agent-grid">
  <div class="reveal">
    <span class="live ${live ? "on" : ""}"><i></i>${live
      ? es ? `Agente #10043 en vivo · revisó los préstamos hace ${secs} s` : `Agent #10043 live · checked the loans ${secs} s ago`
      : es ? "Agente #10043" : "Agent #10043"}</span>
    <h2 style="margin-top:14px">${es ? html`Decile qué hacer <em>con tus palabras</em>` : html`Tell it what to do <em>in your own words</em>`}</h2>
    <p class="lede">${es
      ? "Escribís o dictás una regla. El agente la convierte en topes que ves antes de firmar, y desde ahí cuida tu préstamo solo, día y noche: paga cuando te entran pesos, agrega tus dólares si se acerca al riesgo y nunca se pasa de lo que firmaste."
      : "You write or dictate a rule. The agent turns it into caps you see before you sign, and from then on looks after your loan by itself, day and night: it repays when pesos arrive, adds your dollars if risk gets close, and never goes past what you signed."}</p>
    ${quoted ? html`<blockquote class="rule-q"><span class="small muted">${es ? "Una regla real, firmada en Celo" : "A real rule, signed on Celo"}</span>«${quoted}»</blockquote>` : ""}
    <div class="cta-row"><a class="btn" href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a><a class="link-arrow" href="${href(lang, "/como-funciona")}">${es ? "Qué puede y qué no puede hacer" : "What it can and can't do"}</a></div>
  </div>
  <div class="card reveal d1">
    <div class="card-label">${es ? "Lo último que hizo, en Celo" : "What it did last, on Celo"}</div>
    ${agentFeed(lang, feed)}
    ${repLine(lang, rep)}
  </div>
  ${priceChart(lang, prices)}
</div></div></section>`;
}

/** Gap between two prices, in percent of the second. */
const gapPct = (a: number, b: number) => Math.abs(a / b - 1) * 100;

/**
 * The prices the agent checks every minute, drawn from its own readings: the chain's 30-minute pool price against
 * Binance and dolarapi. Nothing is drawn from fewer than ten real readings.
 */
export function priceChart(lang: Lang, h: PricePoint[]) {
  if (h.length < 10) return "";
  const es = lang === "es";
  const W = 600, H = 180, padT = 10, padB = 10;
  const vals = h.flatMap((p) => [p.pool, p.binance ?? p.pool, p.dolarapi ?? p.pool]);
  const lo0 = Math.min(...vals), hi0 = Math.max(...vals), m = (hi0 - lo0) * 0.12 || 1;
  const lo = lo0 - m, hi = hi0 + m;
  const t0 = h[0].t, t1 = h[h.length - 1].t;
  const x = (t: number) => (((t - t0) / (t1 - t0 || 1)) * W).toFixed(1);
  const y = (v: number) => (padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB)).toFixed(1);
  const path = (k: "pool" | "binance" | "dolarapi") => {
    let d = "", pen = false;
    for (const p of h) {
      const v = p[k];
      if (v == null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(p.t)} ${y(v)}`;
      pen = true;
    }
    return d;
  };
  const last = h[h.length - 1];
  const maxBin = Math.max(...h.map((p) => (p.binance ? gapPct(p.pool, p.binance) : 0)));
  const withApi = h.filter((p) => p.dolarapi);
  const maxApi = withApi.length ? Math.max(...withApi.map((p) => gapPct(p.pool, p.dolarapi!))) : null;
  const hours = Math.max(1, Math.round((t1 - t0) / 3_600_000));
  const pct = (n: number) => n.toLocaleString(es ? "es-AR" : "en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + "%";
  const num = (n: number) => "$" + n.toLocaleString(es ? "es-AR" : "en-US", { maximumFractionDigits: 0 });
  const yTicks = [hi0, (hi0 + lo0) / 2, lo0];
  return html`<div class="card price-card reveal d2">
  <div class="price-head">
    <div><div class="card-label">${es ? `El precio que mira el agente · últimas ${hours} h` : `The price the agent watches · last ${hours} h`}</div>
      <div class="price-now"><b>${num(last.pool)}</b> <span class="muted small">${es ? "por dólar en el fondo de Celo" : "per dollar in the Celo pool"}</span></div></div>
    <div class="legend"><span class="k-pool">${es ? "Fondo en Celo (30 min)" : "Celo pool (30 min)"}</span><span class="k-binance">Binance</span><span class="k-dolarapi">dolarapi</span></div>
  </div>
  <div class="price-plot">
    <div class="plot-area">
      <div class="y-ticks" aria-hidden="true">${yTicks.map((v) => html`<span style="top:${((Number(y(v)) / H) * 100).toFixed(1)}%">${num(v)}</span>`)}</div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${es ? `Precio del dólar en el fondo de Celo contra Binance y dolarapi, últimas ${hours} horas` : `Dollar price in the Celo pool against Binance and dolarapi, last ${hours} hours`}">
        ${yTicks.map((v) => raw(`<line class="grid" x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`))}
        ${raw(`<path class="l-dolarapi" d="${path("dolarapi")}"/><path class="l-binance" d="${path("binance")}"/><path class="l-pool" d="${path("pool")}"/>`)}
      </svg>
      <i class="dot-now" style="left:${((Number(x(last.t)) / W) * 100).toFixed(2)}%;top:${((Number(y(last.pool)) / H) * 100).toFixed(1)}%"></i>
    </div>
    <div class="x-ticks muted small" aria-hidden="true"><span>${es ? `hace ${hours} h` : `${hours} h ago`}</span><span>${es ? "ahora" : "now"}</span></div>
  </div>
  <p class="small muted" style="margin:12px 0 0">${es
    ? html`Mayor diferencia en este tiempo: <b>${pct(maxBin)}</b> con Binance${maxApi !== null ? html`, <b>${pct(maxApi)}</b> con dolarapi` : ""}. El agente frena los préstamos nuevos solo si el fondo se aleja más de 1,5% de todas las fuentes durante 3 minutos.`
    : html`Largest gap in this window: <b>${pct(maxBin)}</b> from Binance${maxApi !== null ? html`, <b>${pct(maxApi)}</b> from dolarapi` : ""}. The agent pauses new loans only if the pool is more than 1.5% from every source for 3 minutes.`}</p>
</div>`;
}

// ---------------------------------------------------------------- mi historial

const STEP_NEEDS = [0, 1, 3, 6] as const;

export type HistoryData = {
  who: string;
  credit: { opened: number; repaidOnTime: number; repaidLate: number; liquidated: number; onTimeSinceLiquidation: number; pesosBorrowed: bigint; pesosRepaid: bigint; lastCountedAt: bigint; tier: number };
  loans: any[];
  actions: any[];
  notices?: any[];
};

const NOTICE_KIND: Record<string, { es: string; en: string }> = {
  weekly: { es: "Tu resumen de la semana", en: "Your week" },
  due_soon: { es: "Vence pronto", en: "Due soon" },
  due: { es: "Venció", en: "Due" },
  late: { es: "Atrasado", en: "Late" },
  health: { es: "Tu préstamo", en: "Your loan" },
  rate_watch: { es: "Tasa más barata", en: "Cheaper rate" },
  A1_protect: { es: "Te cuidó", en: "Protected you" },
  A2_autorepay: { es: "Pagó por vos", en: "Repaid for you" },
};

/** What the agent told this wallet: the weekly summary on top, then every notice, newest first. */
export function noticeList(lang: Lang, notices: any[]) {
  const es = lang === "es";
  if (!notices.length)
    return html`<p class="small muted" style="margin:0">${es ? "Todavía nada. Cuando tengas un préstamo, el agente te avisa acá antes del vencimiento, si cambia el riesgo y cada domingo a las 20 h con el resumen de tu semana." : "Nothing yet. Once you have a loan, the agent tells you here before it is due, if the risk changes, and every Sunday at 8 pm with your week."}</p>`;
  return html`<ul class="notices">${notices.map((n) => {
    const k = NOTICE_KIND[n.kind] ?? { es: "Aviso", en: "Notice" };
    return html`<li class="${n.kind === "weekly" ? "weekly" : ""}"><div class="n-head"><b>${es ? k.es : k.en}</b><span class="muted small">${ago(Number(n.created_at), lang)}</span></div><p>${es ? n.text_es : n.text_en}</p></li>`;
  })}</ul>`;
}

export function historyPage(lang: Lang, d: HistoryData | null, error = false) {
  const es = lang === "es";
  const title = es ? "Mi historial" : "My record";
  const lede = es
    ? "Cada préstamo que pagás a tiempo queda escrito en Celo y te sube un escalón: más pesos, una garantía menor y una tasa más baja. Es público: cualquiera puede verlo, nadie puede borrarlo."
    : "Every loan you repay on time is written on Celo and moves you up a step: more pesos, a smaller guarantee and a lower rate. It is public: anyone can read it, nobody can erase it.";
  const lookup = html`<form class="card hist-find" method="get" action="/historial">
  ${lang === "en" ? html`<input type="hidden" name="lang" value="en">` : ""}
  <div class="card-label">${es ? "Ver el historial de una billetera" : "See a wallet's record"}</div>
  <div class="hist-row">
    <input name="w" placeholder="0x…" autocomplete="off" spellcheck="false" value="${d?.who ?? ""}" aria-label="${es ? "Dirección" : "Address"}">
    <button class="btn" type="submit">${es ? "Ver" : "See"}</button>
  </div>
  <button class="btn ghost block" type="button" data-action="myRecord" data-lang="${lang}" style="margin-top:12px">${es ? "Usar mi billetera" : "Use my wallet"}</button>
  ${error ? html`<p class="small" style="color:#b42318;margin:10px 0 0">${es ? "Esa no es una dirección válida." : "That is not a valid address."}</p>` : ""}
  <p class="small muted" style="margin:10px 0 0" id="status"></p>
</form>`;
  if (!d) return plain(lang, title, lookup, "/historial", { eyebrow: title, heading: es ? html`Tu historial, <em>en la cadena</em>` : html`Your record, <em>on chain</em>`, lede, wallet: true });

  const c = d.credit;
  const step = Math.max(0, Math.min(3, c.tier));
  const counted = c.onTimeSinceLiquidation;
  const next = step < 3 ? STEP_NEEDS[step + 1] - counted : 0;
  const lastCounted = Number(c.lastCountedAt);
  const ladder = html`<ol class="ladder">${[0, 1, 2, 3].map((i) => html`<li class="${i < step ? "done" : i === step ? "here" : ""}">
  <div class="lad-n">${i}</div>
  <div class="lad-b">
    <b>${i === 0 ? (es ? "Primer préstamo" : "First loan") : es ? `Después de ${STEP_NEEDS[i]} a tiempo` : `After ${STEP_NEEDS[i]} on time`}</b>
    <span>${es ? "Hasta" : "Up to"} ${pesos(maxPesosForTier(i), lang)} · ${es ? "pedís hasta el" : "borrow up to"} ${percent(maxLtvBpsForTier(i), lang)} ${es ? "de tu garantía" : "of your guarantee"}${i > 0 ? html` · ${es ? "tasa" : "rate"} −${percent(discountBps(i), lang)}` : ""}</span>
  </div>
  ${i === step ? html`<span class="pill celeste">${es ? "Estás acá" : "You are here"}</span>` : ""}
</li>`)}</ol>`;
  const short6 = `${d.who.slice(0, 6)}…${d.who.slice(-4)}`;
  const body = html`<div class="split">
<div>
<div class="card">
  <div class="card-label">${es ? "Escalón" : "Step"} · <a class="tx" href="${addrUrl(d.who)}">${short6}</a></div>
  <div class="figure num">${step} <span class="small muted" style="font-size:18px">/ 3</span></div>
  <p style="margin:8px 0 0">${step === 3
    ? es ? "Llegaste al escalón más alto." : "You are on the top step."
    : es ? html`Te ${next === 1 ? "falta" : "faltan"} <b>${next}</b> ${next === 1 ? "préstamo pagado" : "préstamos pagados"} a tiempo para el escalón ${step + 1}.` : html`<b>${next}</b> more on-time ${next === 1 ? "loan" : "loans"} to reach step ${step + 1}.`}</p>
  ${ladder}
  <p class="small muted" style="margin:14px 0 0">${es
    ? "Un préstamo cuenta para subir si lo tuviste al menos 7 días y lo abriste después del último que contó, así los escalones llevan tiempo real y no se compran abriendo y cerrando. Si te liquidan, volvés al escalón 0; nada se borra."
    : "A loan counts towards a step if you held it at least 7 days and opened it after the last one that counted, so steps take real time and can't be bought by opening and closing. A liquidation sends you back to step 0; nothing is erased."}</p>
</div>
</div>
<div>
<div class="card">
  <div class="card-label">${es ? "Lo que dice CreditBook" : "What CreditBook says"}</div>
  <div class="row"><span>${es ? "Préstamos abiertos en total" : "Loans opened"}</span><span class="v">${c.opened}</span></div>
  <div class="row"><span>${es ? "Pagados a tiempo" : "Repaid on time"}</span><span class="v">${c.repaidOnTime}</span></div>
  <div class="row"><span>${es ? "Que cuentan para subir" : "Counting towards steps"}</span><span class="v">${counted}</span></div>
  <div class="row"><span>${es ? "Pagados tarde" : "Repaid late"}</span><span class="v">${c.repaidLate}</span></div>
  <div class="row"><span>${es ? "Liquidaciones" : "Liquidations"}</span><span class="v">${c.liquidated}</span></div>
  <div class="row"><span>${es ? "Pesos pedidos" : "Pesos borrowed"}</span><span class="v">${pesos(c.pesosBorrowed, lang)}</span></div>
  <div class="row"><span>${es ? "Pesos devueltos" : "Pesos repaid"}</span><span class="v">${pesos(c.pesosRepaid, lang)}</span></div>
  ${lastCounted ? html`<div class="row"><span>${es ? "Último que contó" : "Last one counted"}</span><span class="v">${date(c.lastCountedAt, lang)}</span></div>` : ""}
  <p class="small muted" style="margin:14px 0 0">${es ? "Leído ahora de" : "Read now from"} <a href="${addrUrl(dep.creditBook)}">CreditBook</a>. ${es ? "Otros agentes lo compran por x402 en" : "Other agents buy it over x402 at"} <code class="tx">/x402/credit/${short6}</code>.</p>
</div>
<div class="card">
  <div class="card-label">${es ? "Tus préstamos" : "Your loans"}</div>
  ${d.loans.length === 0
    ? html`<p class="small muted" style="margin:0">${es ? "Ninguno todavía." : "None yet."} <a href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a></p>`
    : html`<ul class="log">${d.loans.map((r) => html`<li><a href="${href(lang, `/prestamo/${r.id}`)}">#${r.id}</a> · ${r.open ? t(lang, "open") : r.liquidated ? (es ? "liquidado" : "liquidated") : t(lang, "closed")} · ${date(BigInt(r.opened_at), lang)}${r.open ? html` · <a href="${href(lang, `/cuidar/${r.id}`)}">${es ? "regla del agente" : "agent rule"}</a>` : ""}</li>`)}</ul>`}
</div>
<div class="card">
  <div class="card-label">${es ? "Lo que te dijo el agente" : "What the agent told you"}</div>
  ${noticeList(lang, d.notices ?? [])}
  <button class="btn ghost block" type="button" style="margin-top:14px" data-action="linkTelegram" data-who="${d.who}" data-lang="${lang}">${es ? "Avisarme por Telegram" : "Notify me on Telegram"}</button>
  <p class="small muted" style="margin:8px 0 0">${es ? "Firmás un mensaje gratis con esta billetera (no mueve plata) y se abre @adelanto_ar_bot. Desde ahí también podés preguntar cuánto debés o escribir tu regla." : "You sign a free message with this wallet (it moves no money) and @adelanto_ar_bot opens. You can also ask it what you owe or write your rule there."}</p>
  <div id="status"></div>
</div>
<div class="card">
  <div class="card-label">${es ? "Lo que hizo el agente por vos" : "What the agent did for you"}</div>
  ${agentFeed(lang, d.actions)}
</div>
</div>
</div>
<div style="margin-top:20px">${lookup}</div>`;
  return plain(lang, title, body, `/historial?w=${d.who}`, { eyebrow: title, heading: es ? html`Tu historial, <em>en la cadena</em>` : html`Your record, <em>on chain</em>`, lede, wide: true, wallet: true });
}

export { raw, dep };
