// Server-rendered pages (hono/html escapes every interpolated value). Numbers come from data.ts.
// The wallet client (client/wallet.ts) binds to data-action buttons, #status, #readback, #rule-words, #amount, #mine
// and the g-* inputs: keep those names when changing markup.
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { dollars, pesos, percent, type Quote } from "@adelanto/core";
import { CELO } from "@adelanto/chain";
import { t, type Lang } from "./i18n.ts";
import { REFS, dep, labelOf, networkCostUsd, type LoanView, type PoolView } from "./data.ts";

type H = HtmlEscapedString | Promise<HtmlEscapedString>;

// What the wallet code may talk to: the deployed contracts and the two tokens, nothing else.
const walletCfg = JSON.stringify({ code: dep.attributionCode, pool: dep.pool, guard: dep.guard, usdt: CELO.usdt, wars: CELO.wars, rpc: "https://forno.celo.org" });
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
const MARK = raw(`<span class="word">Adelanto</span><span class="flag" aria-hidden="true"></span>`);

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
<meta name="theme-color" content="#f6f5f0">
<meta property="og:title" content="Adelanto · ${t(lang, "tagline")}">
<meta property="og:description" content="${es ? "Pesos contra tus dólares, en MiniPay, mucho más barato que el banco. Un agente cuida el préstamo dentro de una regla que firmás vos." : "Pesos against your dollars, in MiniPay, far cheaper than the bank. An agent looks after the loan inside a rule you sign."}">
<meta property="og:image" content="/static/img/kiosco-1600.webp">
<link rel="icon" href="/static/adelanto.png">
<link rel="preload" href="/static/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/app.css?v=3">
</head>
<body>
<header class="nav"><div class="wrap">
  <a class="brand" href="${href(lang, "/")}" aria-label="Adelanto">${MARK}</a>
  <nav class="links">
    ${nav("/como-funciona", "how")}
    ${nav("/prestar", "lend")}
    ${nav("/transparencia", "transparency")}
  </nav>
  <a class="lang" href="${otherHref}" hreflang="${es ? "en" : "es"}">${other}</a>
  <a class="btn" href="${href(lang, "/pedir")}">${t(lang, "borrow")}</a>
</div></header>
<main>${body}</main>
${footer(lang)}
${opts.wallet ? html`<script id="adelanto-cfg" type="application/json">${raw(walletCfg)}</script><script type="module" src="/static/wallet.js"></script>` : ""}
<script src="/static/site.js?v=3" defer></script>
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

/** A number on the rate board: one tile per character, flipping in one after another. */
function boardDigits(text: string, start = 0) {
  return html`<span class="digits flip">${[...text].map((ch, i) =>
    html`<b class="${/[0-9]/.test(ch) ? "" : "p"}" style="animation-delay:${start + i * 45}ms">${ch}</b>`,
  )}</span>`;
}

export function home(lang: Lang, v: PoolView, proof: { loan: LoanView; events: any[]; actions: any[] } | null, tickAge: number | null) {
  const es = lang === "es";
  const loc = es ? "es-AR" : "en-US";
  const rate = Number(v.borrowRateBps) / 10_000;
  const bankRate = Number(REFS.bankLoan.bps) / 10_000;
  // The README's example, at today's rate: 400,000 pesos for 30 days, simple interest.
  const P = 400_000, D = 30;
  const bankCost = Math.round((P * bankRate * D) / 365);
  const ourInterest = Math.round((P * rate * D) / 365);
  const fee = Math.round(P * 0.0025);
  const ourCost = ourInterest + fee;
  const saving = bankCost - ourCost;
  const price = Number((v.borrowPrice ?? v.liquidationPrice) / 10n ** 15n) / 1000;
  const lockUsd = Math.round(P / 0.6 / price);
  const tick = tickAge === null ? null : Math.max(1, Math.round(tickAge / 1000));
  const pct = (bps: bigint) => (Number(bps) / 100).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  const b = proof?.events.find((e) => e.name === "Borrowed");

  return layout(
    lang,
    es ? "Pesos ya, sin vender tus dólares" : "Pesos now, without selling your dollars",
    html`
<section class="hero"><div class="wrap">
  <div>
    <span class="eyebrow">${es ? "Préstamos en pesos contra dólares, en MiniPay" : "Peso loans against dollars, in MiniPay"}</span>
    <h1>${es ? "Pesos ya, sin vender tus dólares." : "Pesos now, without selling your dollars."}</h1>
    <p class="lede">${es
      ? "Dejás USDT en garantía y recibís pesos digitales de Ripio en un minuto. Pagás mucho menos que en el banco, y un agente cuida el préstamo dentro de una regla que firmás vos."
      : "Leave USDT as a guarantee and get Ripio digital pesos in a minute. You pay far less than at the bank, and an agent looks after the loan inside a rule you sign."}</p>
    <div class="cta-row">
      <a class="btn sol" href="${href(lang, "/pedir")}">${t(lang, "borrow")} <span class="arrow">→</span></a>
      <a class="btn ghost" href="${href(lang, "/probar")}">${t(lang, "tryIt")}</a>
    </div>
  </div>
  <div class="board" role="table" aria-label="${es ? "Pizarra de tasas, leída de la cadena" : "Rate board, read from the chain"}">
    <div class="board-head"><span>${es ? "Pizarra" : "Board"} · Celo</span><span class="live">${es ? "En vivo" : "Live"}</span></div>
    <div class="board-row them" role="row"><div class="what" role="cell">${es ? "Banco" : "Bank"}<small>${es ? "préstamo personal" : "personal loan"} · ${REFS.bankLoan.source}</small></div><div role="cell">${boardDigits(pct(REFS.bankLoan.bps))}</div></div>
    <div class="board-row" role="row"><div class="what" role="cell">Adelanto<small>${es ? "tasa anual hoy" : "yearly rate today"}</small></div><div role="cell">${boardDigits(pct(v.borrowRateBps), 250)}</div></div>
    <div class="board-row dim" role="row"><div class="what" role="cell">${es ? "Dólar del fondo" : "Pool dollar"}<small>${es ? "pesos por USDT, promedio 30 min" : "pesos per USDT, 30-min average"}</small></div><div role="cell">${boardDigits(price.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 500)}</div></div>
    <div class="board-row dim" role="row"><div class="what" role="cell">${es ? "Pesos para prestar" : "Pesos to lend"}<small>${es ? "libres en el fondo ahora" : "free in the pool now"}</small></div><div role="cell">${boardDigits(Number(v.pool.cash / 10n ** 18n).toLocaleString(loc), 750)}</div></div>
    <div class="board-foot">${es ? "Bloque" : "Block"} ${v.block.toString()}${tick !== null ? (es ? ` · el agente revisó hace ${tick} s` : ` · agent checked ${tick} s ago`) : ""}</div>
  </div>
</div></section>

<section class="celeste"><div class="wrap">
  <div class="reveal">
    <h2>${es ? "Mismo préstamo, otra cuenta." : "Same loan, different bill."}</h2>
    <p>${es ? `Por $ 400.000 durante ${D} días, el banco te cobra ${pct(REFS.bankLoan.bps)} al año. Con Adelanto te quedan en el bolsillo` : `For ARS 400,000 over ${D} days, the bank charges ${pct(REFS.bankLoan.bps)} a year. With Adelanto you keep`}</p>
    <div class="big-saving num">$ ${num(saving, lang)}</div>
    <p>${es ? "y no vendés ni un dólar: quedan en garantía y vuelven cuando pagás." : "and you sell no dollars: they stay as guarantee and come back when you repay."}</p>
  </div>
  <div class="ticket reveal" aria-label="${es ? "Cotización de ejemplo" : "Example quote"}">
    <div class="t-head"><b>Adelanto</b>${es ? "Cotización de ejemplo" : "Example quote"}</div>
    <div class="t-row"><span>${es ? "Pedís" : "You borrow"}</span><span>$ ${num(P, lang)}</span></div>
    <div class="t-row"><span>${es ? "Plazo" : "Term"}</span><span>${D} ${t(lang, "days")}</span></div>
    <div class="t-row"><span>${es ? "Tasa anual hoy" : "Yearly rate today"}</span><span>${percent(v.borrowRateBps, lang)}</span></div>
    <div class="t-sep"></div>
    <div class="t-row"><span>${es ? "Interés" : "Interest"}</span><span>$ ${num(ourInterest, lang)}</span></div>
    <div class="t-row"><span>${es ? "Comisión 0,25%" : "Fee 0.25%"}</span><span>$ ${num(fee, lang)}</span></div>
    <div class="t-row t-total"><span>${es ? "Te cuesta" : "It costs"}</span><span>$ ${num(ourCost, lang)}</span></div>
    <div class="t-row strike"><span>${es ? "En el banco" : "At the bank"}</span><span>$ ${num(bankCost, lang)}</span></div>
    <div class="t-sep"></div>
    <div class="t-row"><span>${es ? "Dejás en garantía" : "Guarantee"}</span><span>US$ ${num(lockUsd, lang)}</span></div>
    <div class="t-row"><span>${es ? "Dólares vendidos" : "Dollars sold"}</span><span>0</span></div>
    <div class="t-foot">${es ? "Interés simple a la tasa de hoy. La tasa real sigue el uso del fondo y la ves antes de firmar." : "Simple interest at today's rate. The real rate follows pool use; you see it before you sign."}</div>
  </div>
</div></section>

<figure class="story-photo">
  <img src="/static/img/kiosco-1600.webp" srcset="/static/img/kiosco-800.webp 800w, /static/img/kiosco-1600.webp 1600w" sizes="100vw" alt="${es ? "Alfajores apilados en un kiosco de Buenos Aires" : "Alfajores stacked in a Buenos Aires kiosk"}" loading="lazy">
</figure>
<div class="caption"><span>${es ? "Kiosco en Buenos Aires. Lucía es un ejemplo, no una clienta." : "A kiosk in Buenos Aires. Lucía is an example, not a customer."}</span><span>Foto: Just a Man, CC BY 4.0</span></div>

<section class="section"><div class="wrap cols">
  <div class="side reveal"><h2>${es ? "Lucía tiene un kiosco en Caballito." : "Lucía runs a kiosk in Caballito."}</h2></div>
  <div class="reveal">
    <p class="quote">${es ? "Ahorra en dólares porque el peso se va. Pero la mercadería la paga en pesos." : "She saves in dollars because the peso melts. But she pays for stock in pesos."}</p>
    <p class="lede">${es
      ? "Este mes necesita $ 400.000 para reponer. Vender dólares es perderlos; el banco le cobra 64,63% al año; pagar en cuotas con la tarjeta le sale el dólar tarjeta. Con Adelanto deja una parte de sus USDT, recibe los pesos al instante y sus dólares siguen siendo suyos. Si el peso sigue cayendo, lo que debe en pesos vale cada vez menos en dólares."
      : "This month she needs ARS 400,000 to restock. Selling dollars means losing them; the bank charges 64.63% a year; card instalments cost the card dollar. With Adelanto she leaves part of her USDT, gets the pesos at once, and her dollars stay hers. If the peso keeps falling, what she owes in pesos is worth less and less in dollars."}</p>
    <div class="facts">
      <div><b>33,4%</b><span>${es ? "inflación de los últimos 12 meses (INDEC)" : "inflation over 12 months (INDEC)"}</span></div>
      <div><b>+22%</b><span>${es ? "el dólar tarjeta contra el dólar cripto" : "card dollar against crypto dollar"}</span></div>
      <div><b>1 min</b><span>${es ? "de tus USDT a tus pesos" : "from your USDT to your pesos"}</span></div>
    </div>
  </div>
</div></section>

<section class="dark section"><div class="wrap">
  <div class="sec-head reveal">
    <h2>${es ? "Firmás una regla. El agente la cumple." : "You sign a rule. The agent keeps it."}</h2>
    <p>${es ? "Si el préstamo se acerca al riesgo, el agente agrega tus propios dólares o paga con tus propios pesos, en el orden que elegiste y sin pasarse de tus topes diarios. Cada acción cita tu regla." : "If the loan nears risk, the agent adds your own dollars or repays with your own pesos, in the order you chose and never past your daily caps. Every action quotes your rule."}</p>
  </div>
  <div class="agent-log reveal">
    <div class="lh"><span>${es ? "Así te avisa" : "How it tells you"}</span><span>${es ? "ejemplos" : "examples"}</span></div>
    <div class="ll"><time>09:41</time><span>${es ? "Tu préstamo llegó al 71%. Agregué US$ 3 de tus dólares y volvió al 60%." : "Your loan reached 71%. I added US$3 of your dollars; it is back to 60%."}<span class="why">${es ? "Tu regla: «cuidalo con hasta US$ 10 por semana»" : "Your rule: “protect it with up to US$10 a week”"}</span></span></div>
    <div class="ll"><time>14:05</time><span>${es ? "Te entraron $ 50.000. Pagué $ 40.000 del préstamo y te dejé $ 10.000." : "ARS 50,000 arrived. I repaid ARS 40,000 and left you ARS 10,000."}<span class="why">${es ? "Tu regla: «pagá cuando me entren pesos, dejame siempre $ 10.000»" : "Your rule: “repay when pesos arrive, always leave me ARS 10,000”"}</span></span></div>
    <div class="ll"><time>18:30</time><span>${es ? "El precio del fondo no coincide con Binance ni con dolarapi hace 3 minutos. Pausé préstamos nuevos; pagar sigue igual." : "The pool price has disagreed with Binance and dolarapi for 3 minutes. I paused new loans; repaying works as usual."}</span></div>
  </div>
  <div class="limits reveal">
    <div><b>${es ? "Nunca mueve plata a otro lado." : "Never moves money elsewhere."}</b><p>${es ? "Solo de tu billetera a tu propio préstamo. Lo hace cumplir el contrato LoanGuard, no nosotros." : "Only from your wallet into your own loan. The LoanGuard contract enforces it, not us."}</p></div>
    <div><b>${es ? "Nunca se pasa de tus topes." : "Never goes past your caps."}</b><p>${es ? "Dólares por día, pesos por día, lo que siempre te deja y hasta cuándo. Le quitás el permiso cuando quieras." : "Dollars a day, pesos a day, what it always leaves you and until when. Take the permission back any time."}</p></div>
    <div><b>${es ? "Si tiene que vender, vende lo mínimo." : "If it must sell, it sells the least."}</b><p>${es ? "Primero intenta salvarlo con tu plata. Si no alcanza, vende solo hasta el 78%: en un préstamo de 1.000 USDT perdés US$ 5,80 en vez de US$ 19." : "It first tries to save it with your money. If that fails, it sells only to 78%: on a 1,000 USDT loan you lose US$5.80 instead of US$19."}</p></div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="sec-head reveal">
    <h2>${es ? "Si el peso cae, tu préstamo está más seguro." : "If the peso falls, your loan gets safer."}</h2>
    <p>${es ? "Debés pesos y dejaste dólares. El riesgo llega si el peso se fortalece mucho; la línea es cuánto pediste contra lo que dejaste." : "You owe pesos and left dollars. Risk comes only if the peso strengthens a lot; the line is what you borrowed against what you left."}</p>
  </div>
  <div class="ruler reveal" role="img" aria-label="${es ? "Empezás hasta el 60%; el agente actúa al 70%; pasando el 80% se vende lo justo para volver al 78%." : "You start at up to 60%; the agent acts at 70%; past 80% just enough is sold to get back to 78%."}">
    <div class="ticks"><span style="left:60%">60%</span><span style="left:70%">70%</span><span style="left:80%">80%</span></div>
    <div class="bar"><i></i><i></i><i></i><i></i></div>
  </div>
  <div class="ruler-legend">
    <span><b>0–60%</b>${es ? "Empezás acá: hasta el 60% de lo que dejás." : "You start here: up to 60% of what you leave."}</span>
    <span><b>70%</b>${es ? "Te cuida el agente." : "The agent steps in."}</span>
    <span><b>80%</b>${es ? "Se vende lo justo." : "Just enough is sold."}</span>
    <span><b>78%</b>${es ? "Hasta volver al 78%. El resto sigue siendo tuyo." : "Back to 78%. The rest stays yours."}</span>
  </div>
</div></section>

<section class="lend">
  <figure><img src="/static/img/mercado-1600.webp" srcset="/static/img/mercado-800.webp 800w, /static/img/mercado-1600.webp 1600w" sizes="(max-width: 900px) 100vw, 50vw" alt="${es ? "Mercado de San Telmo, Buenos Aires" : "San Telmo market, Buenos Aires"}" loading="lazy"><figcaption>Mercado de San Telmo · Josefito123, CC BY-SA 4.0</figcaption></figure>
  <div class="body reveal">
    <h2>${es ? "¿Tenés pesos? Prestalos." : "Holding pesos? Lend them."}</h2>
    <p class="lede" style="margin-top:18px">${es ? "Quienes piden pagan la tasa del día; el 90% del interés va a quienes prestan. Retirás cuando haya pesos libres en el fondo." : "Borrowers pay the day's rate; 90% of the interest goes to lenders. Withdraw whenever the pool has free pesos."}</p>
    <div class="rates">
      <div><b>25,9%</b><span>${es ? "lo que ganás con el fondo prestado al 80%" : "what you earn with the pool 80% lent"}</span></div>
      <div><b>${percent(REFS.badlar.bps, lang)}</b><span>${es ? "BADLAR, depósitos a plazo" : "BADLAR, term deposits"} · ${REFS.badlar.source}</span></div>
    </div>
    <a class="btn" href="${href(lang, "/prestar")}">${t(lang, "lend")} <span class="arrow">→</span></a>
  </div>
</section>

${proof && b ? html`<section class="section"><div class="wrap">
  <div class="sec-head reveal">
    <h2>${es ? `Préstamo #${proof.loan.id}, de punta a punta.` : `Loan #${proof.loan.id}, end to end.`}</h2>
    <p>${es ? "En Celo, con wARS de verdad, desde una billetera nuestra. Cada paso tiene su transacción." : "On Celo, with real wARS, from one of our own wallets. Every step has its transaction."}</p>
  </div>
  <div class="proof-sum reveal">
    <div><b>${pesos(BigInt(b.args.pesos), lang)}</b><span>${es ? "pidió" : "borrowed"}</span></div>
    <div><b>${dollars(BigInt(b.args.collateral), lang)}</b><span>${es ? "dejó en garantía" : "left as guarantee"}</span></div>
    <div><b>${percent(BigInt(b.args.rateBps), lang)}</b><span>${es ? "tasa anual" : "yearly rate"}</span></div>
    <div><b>${proof.loan.open ? t(lang, "open") : t(lang, "closed")}</b><span>${es ? "estado" : "status"} · ${label(proof.loan.borrower, lang)}</span></div>
  </div>
  <table class="ledger reveal">
    <thead><tr><th class="n">#</th><th>${es ? "Qué pasó" : "What happened"}</th><th>${es ? "Transacción" : "Transaction"}</th></tr></thead>
    <tbody>${proof.events.map((e, i) => html`<tr><td class="n">${String(i + 1).padStart(2, "0")}</td><td>${eventLine(e, lang)}</td><td><a class="tx" href="${txUrl(e.tx)}">${short(e.tx)}</a></td></tr>`)}</tbody>
  </table>
  <p style="margin-top:22px"><a href="${href(lang, `/prestamo/${proof.loan.id}`)}">${es ? "Ver la página del préstamo →" : "See the loan page →"}</a> · <a href="${href(lang, "/transparencia")}">${es ? "Transparencia y contratos →" : "Transparency and contracts →"}</a></p>
</div></section>` : ""}

<section class="section" style="padding-top:0"><div class="wrap faq">
  <h2 class="reveal">${es ? "Preguntas." : "Questions."}</h2>
  <dl class="reveal">
    <dt>${es ? "¿Qué pasa si no pago a tiempo?" : "What if I don't repay on time?"}</dt><dd>${es ? "La tasa sube 5 puntos hasta que pagues y, a los 7 días, tu historial lo marca como atrasado. Nunca se vende tu garantía por pagar tarde: solo el precio puede hacer que se venda una parte." : "The rate rises 5 points until you repay and, after 7 days, your record marks it late. Your guarantee is never sold for paying late: only the price can trigger a partial sale."}</dd>
    <dt>${es ? "¿Quién tiene mis dólares?" : "Who holds my dollars?"}</dt><dd>${es ? "El contrato PesoPool en Celo. No tiene ninguna función para que un administrador los retire. Vuelven a tu billetera cuando pagás." : "The PesoPool contract on Celo. It has no function that lets an administrator withdraw them. They return to your wallet when you repay."}</dd>
    <dt>${es ? "¿Qué son los wARS?" : "What is wARS?"}</dt><dd>${es ? "Pesos digitales de Ripio: 1 wARS = 1 peso. Los podés usar en Celo o pasarlos a tu cuenta bancaria desde la app de Ripio." : "Ripio's digital pesos: 1 wARS = 1 peso. Use them on Celo or move them to your bank account from the Ripio app."}</dd>
    <dt>${es ? "¿Y si Ripio congela los wARS?" : "What if Ripio freezes wARS?"}</dt><dd>${es ? "Tras 24 horas congelados, cada persona puede recuperar sus dólares hasta la línea del 70%. Está escrito en el contrato y probado." : "After 24 hours frozen, each borrower can take their dollars back down to the 70% line. It is written in the contract and tested."}</dd>
    <dt>${es ? "¿De dónde sale el precio del dólar?" : "Where does the dollar price come from?"}</dt><dd>${es ? "Del fondo wARS/USDT de Uniswap en Celo, promedio de 30 minutos. El agente lo compara cada minuto con Binance y dolarapi; si no coinciden, pausa préstamos nuevos." : "From the wARS/USDT Uniswap pool on Celo, as a 30-minute average. The agent compares it every minute with Binance and dolarapi; if they disagree, it pauses new loans."}</dd>
  </dl>
</div></section>

<section class="closing"><div class="wrap">
  <div class="reveal">
    <h2>${es ? "Probalo con un dólar." : "Try it with one dollar."}</h2>
    <p>${es ? `Pedí $ 1.000 contra cerca de US$ 1, mirá cómo lo cuida el agente y devolvelo. Hoy hay ${pesos(v.pool.cash, lang)} libres para prestar.` : `Borrow ARS 1,000 against about US$1, watch the agent at work and repay it. ${pesos(v.pool.cash, lang)} are free to lend today.`}</p>
  </div>
  <div class="cta-row reveal">
    <a class="btn" href="${href(lang, "/probar")}">${t(lang, "tryIt")} <span class="arrow">→</span></a>
    <a class="btn ghost" href="${href(lang, "/como-funciona")}">${t(lang, "how")}</a>
  </div>
</div></section>`,
    { path: "/" },
  );
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

export function loanPage(lang: Lang, v: PoolView, loan: LoanView, events: any[], actions: any[]) {
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
</div>`
  : html`<div class="card"><div class="card-label">${es ? "Estado" : "Status"} · ${pillFor(loan.borrower, lang)}</div><h3>${loan.liquidated ? (es ? "Se vendió parte de la garantía." : "Part of the guarantee was sold.") : es ? "Pagado. Los dólares volvieron a su billetera." : "Repaid. The dollars went back to the wallet."}</h3></div>`}
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
  return html`<p class="small">${es ? "Puede " : "It may "}${parts.join("; ")}. ${es ? "Vence el" : "Until"} ${date(l.expiry, lang)}.</p>`;
}

// ---------------------------------------------------------------- guard

export function guardPage(lang: Lang, loan: LoanView, words: string | null) {
  const es = lang === "es";
  const presets = [
    { id: "cuidalo", es: "Cuidalo con hasta US$ 10 por semana", en: "Protect it with up to US$10 a week", sub: { es: "Agrega tus dólares si llega a riesgo", en: "Adds your dollars if it reaches risk" } },
    { id: "pesos", es: "Pagá con mis pesos cuando entren", en: "Repay with my pesos when they arrive", sub: { es: "Usa lo que te llega, nada más", en: "Uses what arrives, nothing else" } },
    { id: "avisame", es: "No hagas nada sin preguntarme", en: "Do nothing without asking me", sub: { es: "Solo te avisa", en: "Only tells you" } },
  ];
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
  <div class="card-label">${es ? "Elegí una" : "Pick one"}</div>
  <div style="display:grid;gap:10px">
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

export { raw, dep };
