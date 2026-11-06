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

/** The mark: a sun of 16 rays, after the Sol de Mayo, without the face. */
const SUN = (size = 30) =>
  raw(`<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><g fill="#f2a900">${Array.from({ length: 16 }, (_, i) => {
    const long = i % 2 === 0;
    return `<path transform="rotate(${i * 22.5} 32 32)" d="M32 ${long ? 2 : 7} L34.2 ${long ? 15 : 16} L29.8 ${long ? 15 : 16} Z"/>`;
  }).join("")}<circle cx="32" cy="32" r="13"/></g><circle cx="32" cy="32" r="13" fill="none" stroke="#17140f" stroke-opacity=".12"/></svg>`);

/** Large decorative sun for backgrounds: thin rays only. */
const SUN_RAYS = raw(`<svg class="sun" viewBox="0 0 400 400" aria-hidden="true"><g stroke="#f2a900" stroke-width="1" stroke-opacity=".55" fill="none">${Array.from({ length: 64 }, (_, i) => {
  const a = (i * Math.PI * 2) / 64, r1 = i % 2 ? 120 : 96, r2 = 198;
  return `<line x1="${(200 + Math.cos(a) * r1).toFixed(1)}" y1="${(200 + Math.sin(a) * r1).toFixed(1)}" x2="${(200 + Math.cos(a) * r2).toFixed(1)}" y2="${(200 + Math.sin(a) * r2).toFixed(1)}"/>`;
}).join("")}<circle cx="200" cy="200" r="80"/><circle cx="200" cy="200" r="58" stroke-opacity=".3"/></g></svg>`);

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
<meta name="theme-color" content="#f4efe4">
<meta property="og:title" content="Adelanto · ${t(lang, "tagline")}">
<meta property="og:description" content="${es ? "Pesos contra tus dólares, en MiniPay, mucho más barato que el banco. Un agente cuida el préstamo dentro de una regla que firmás vos." : "Pesos against your dollars, in MiniPay, far cheaper than the bank. An agent looks after the loan inside a rule you sign."}">
<meta property="og:image" content="/static/img/kiosco-1600.webp">
<link rel="icon" href="/static/adelanto.png">
<link rel="preload" href="/static/fonts/instrument-serif-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/fonts/schibsted-grotesk-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/app.css?v=2">
</head>
<body>
<header class="nav"><div class="wrap">
  <a class="brand" href="${href(lang, "/")}" aria-label="Adelanto">${SUN()}<span class="word">Adelanto</span></a>
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
<script src="/static/site.js?v=2" defer></script>
</body>
</html>`;
}

function footer(lang: Lang) {
  const es = lang === "es";
  return html`<footer class="foot"><div class="wrap">
  <div>
    <a class="brand" href="${href(lang, "/")}">${SUN(26)}<span class="word">Adelanto</span></a>
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

export function home(lang: Lang, v: PoolView, proof: { loan: LoanView; events: any[]; actions: any[] } | null, tickAge: number | null) {
  const es = lang === "es";
  const rate = Number(v.borrowRateBps) / 10_000;
  const bankRate = Number(REFS.bankLoan.bps) / 10_000;
  // The README's example, at today's rate: 400,000 pesos for 30 days.
  const P = 400_000, D = 30;
  const bankCost = Math.round((P * bankRate * D) / 365);
  const ourInterest = Math.round((P * rate * D) / 365);
  const ourCost = ourInterest + Math.round(P * 0.0025);
  const saving = bankCost - ourCost;
  const w = Math.max(8, Math.round((ourCost / bankCost) * 100));
  const price = Number((v.borrowPrice ?? v.liquidationPrice) / 10n ** 15n) / 1000;
  const lockUsd = Math.round(P / 0.6 / price);
  const free = Number(v.pool.cash / 10n ** 18n);
  const tick = tickAge === null ? null : Math.max(1, Math.round(tickAge / 1000));
  const ticker = [
    html`<span>${es ? "Tasa hoy" : "Rate today"} <b>${percent(v.borrowRateBps, lang)}</b></span>`,
    html`<span>${es ? "Banco" : "Bank"} <b>${percent(REFS.bankLoan.bps, lang)}</b></span>`,
    html`<span>${es ? "Pesos libres" : "Free pesos"} <b>${pesos(v.pool.cash, lang)}</b></span>`,
    html`<span>${es ? "Dólar del fondo" : "Pool dollar"} <b>$ ${num(price, lang, 2)}</b></span>`,
    html`<span>${es ? "Bloque" : "Block"} <b>${v.block.toString()}</b></span>`,
    tick !== null ? html`<span>${es ? "El agente revisó hace" : "Agent checked"} <b>${tick} s</b>${es ? "" : " ago"}</span>` : "",
    html`<span>${es ? "Etiqueta en cada transacción" : "Tag on every transaction"} <b>${dep.attributionCode}</b></span>`,
    html`<span>ERC-8004 <b>#10043</b></span>`,
  ];
  const b = proof?.events.find((e) => e.name === "Borrowed");

  return layout(
    lang,
    es ? "Pesos ya, sin vender tus dólares" : "Pesos now, without selling your dollars",
    html`
<section class="hero">${SUN_RAYS}<div class="wrap">
  <div class="hero-in">
    <span class="eyebrow">${es ? "Préstamos en pesos · en MiniPay" : "Peso loans · in MiniPay"}</span>
    <h1>${es ? html`Pesos hoy.<br><em>Tus dólares,</em> intactos.` : html`Pesos today.<br><em>Your dollars,</em> untouched.`}</h1>
    <p class="lede">${es
      ? "Dejá USDT en garantía y recibí pesos digitales de Ripio en un minuto, a una fracción de lo que cobra el banco. Un agente cuida tu préstamo dentro de una regla que firmás vos."
      : "Leave USDT as a guarantee and get Ripio digital pesos in a minute, at a fraction of what the bank charges. An agent looks after your loan inside a rule you sign."}</p>
    <div class="cta-row">
      <a class="btn sol" href="${href(lang, "/pedir")}">${t(lang, "borrow")} <span class="arrow">→</span></a>
      <a class="btn ghost" href="${href(lang, "/probar")}">${t(lang, "tryIt")}</a>
    </div>
    <div class="hero-proof">
      <div><b class="num" data-count="${(rate * 100).toFixed(1)}" data-dec="${Number.isInteger(Math.round(rate * 1000) / 10) ? 0 : 1}" data-post="%" data-locale="${es ? "es-AR" : "en-US"}">${percent(v.borrowRateBps, lang)}</b><span>${es ? "tasa anual hoy, en vivo" : "yearly rate today, live"}</span></div>
      <div><s>${percent(REFS.bankLoan.bps, lang)}</s><span>${es ? "préstamo personal en el banco" : "bank personal loan"} · BCRA</span></div>
      <div><b>0</b><span>${es ? "dólares que tenés que vender" : "dollars you have to sell"}</span></div>
    </div>
  </div>
  <div class="stage" aria-hidden="true">
    <div class="phone"><div class="screen">
      <div class="notch"></div>
      <div class="ph-top"><span>Adelanto</span><span>MiniPay</span></div>
      <div class="ph-card">
        <div class="ph-label">${t(lang, "youGet")}</div>
        <div class="ph-big">$ 400.000</div>
        <div class="ph-bar"><i></i></div>
      </div>
      <div class="ph-card">
        <div class="ph-row"><span>${t(lang, "youLeave")}</span><b>US$ ${num(lockUsd, lang)}</b></div>
        <div class="ph-row"><span>${es ? "Tasa anual" : "Yearly rate"}</span><b>${percent(v.borrowRateBps, lang)}</b></div>
        <div class="ph-row"><span>${es ? "En el banco" : "At the bank"}</span><b style="text-decoration:line-through;color:var(--muted)">${percent(REFS.bankLoan.bps, lang)}</b></div>
        <div class="ph-row"><span>${t(lang, "youSave")}</span><b style="color:var(--ok)">$ ${num(saving, lang)}</b></div>
      </div>
      <div class="ph-btn">${es ? "Pedir · 3 toques" : "Borrow · 3 taps"}</div>
    </div></div>
    <div class="chip a"><span class="ic">✦</span><span>${es ? html`<b>El agente agregó US$ 3</b><br>Tu regla: «cuidalo hasta US$ 10 por semana»` : html`<b>The agent added US$3</b><br>Your rule: “protect it up to US$10 a week”`}</span></div>
    <div class="chip b"><span class="ic">✓</span><span>${es ? html`<b>Préstamo pagado</b><br>Tus dólares volvieron en la misma transacción` : html`<b>Loan repaid</b><br>Your dollars came back in the same transaction`}</span></div>
  </div>
</div></section>

<div class="ticker" aria-label="${es ? "Datos en vivo de la cadena" : "Live data from the chain"}"><div class="track">${ticker}${ticker}</div></div>

<section class="section"><div class="wrap">
  <div class="head reveal">
    <div><span class="eyebrow">${es ? "La cuenta" : "The maths"}</span><h2>${es ? html`El mismo préstamo,<br><em>otra cuenta.</em>` : html`The same loan,<br><em>a different bill.</em>`}</h2></div>
    <p>${es ? `$ 400.000 por ${D} días. El banco cobra ${percent(REFS.bankLoan.bps, lang)} al año; Adelanto, la tasa de hoy más una comisión de apertura del 0,25%.` : `ARS 400,000 for ${D} days. The bank charges ${percent(REFS.bankLoan.bps, lang)} a year; Adelanto, today's rate plus a 0.25% opening fee.`}</p>
  </div>
  <div class="compare reveal" style="--w:${w}%">
    <div class="bar-row bank"><div class="who">${es ? "Banco" : "Bank"}<small>${es ? "préstamo personal" : "personal loan"} · ${percent(REFS.bankLoan.bps, lang)}</small></div><div class="bar"><i></i></div><div class="amt num">$ ${num(bankCost, lang)}</div></div>
    <div class="bar-row us"><div class="who">Adelanto<small>${percent(v.borrowRateBps, lang)} + 0,25%</small></div><div class="bar"><i></i></div><div class="amt num">$ ${num(ourCost, lang)}</div></div>
    <div class="compare-note">
      <div><div class="card-label">${es ? "Te quedan en el bolsillo" : "Stays in your pocket"}</div><div class="saving num" data-count="${saving}" data-pre="$ " data-locale="${es ? "es-AR" : "en-US"}">$ ${num(saving, lang)}</div></div>
      <p class="muted small" style="max-width:34em;margin:0">${es ? `Y no vendés ni un dólar: con el dólar del fondo a $ ${num(price, lang, 2)}, dejás unos US$ ${num(lockUsd, lang)} que vuelven cuando pagás. Interés simple a la tasa de hoy; la tasa real sigue el uso del fondo y la ves antes de firmar.` : `And you sell no dollars: with the pool's dollar at ARS ${num(price, lang, 2)}, you leave about US$${num(lockUsd, lang)}, returned when you repay. Simple interest at today's rate; the real rate follows pool use and you see it before you sign.`}</p>
    </div>
  </div>
</div></section>

<section class="section"><div class="wrap story">
  <figure class="photo reveal" style="margin:0">
    <img src="/static/img/kiosco-800.webp" srcset="/static/img/kiosco-800.webp 800w, /static/img/kiosco-1600.webp 1600w" sizes="(max-width: 860px) 100vw, 50vw" alt="${es ? "Alfajores apilados en un kiosco de Buenos Aires" : "Alfajores stacked in a Buenos Aires kiosk"}" loading="lazy" width="800" height="686">
    <figcaption><span class="tag">${es ? "Ejemplo, no una clienta" : "An example, not a customer"}</span><span class="credit">Just a Man · CC BY 4.0</span></figcaption>
  </figure>
  <div class="reveal d1">
    <span class="eyebrow">${es ? "Para quién es" : "Who it is for"}</span>
    <h2 style="margin-top:16px">${es ? html`Lucía tiene un kiosco <em>en Caballito.</em>` : html`Lucía runs a kiosk <em>in Caballito.</em>`}</h2>
    <p class="quote">${es ? "«Ahorro en dólares porque el peso se va. Pero la mercadería la pago en pesos.»" : "“I save in dollars because the peso melts. But I pay for stock in pesos.”"}</p>
    <p class="lede">${es
      ? "Necesita $ 400.000 para reponer este mes. Vender dólares es perderlos; el banco le cobra 64,63% al año. Con Adelanto deja una parte de sus USDT, recibe los pesos al instante y sus dólares siguen siendo suyos. Si el peso sigue cayendo, lo que debe en pesos vale cada vez menos en dólares."
      : "She needs ARS 400,000 to restock this month. Selling dollars means losing them; the bank charges 64.63% a year. With Adelanto she leaves part of her USDT, gets the pesos at once, and her dollars stay hers. If the peso keeps falling, what she owes in pesos is worth less and less in dollars."}</p>
    <div class="facts">
      <div><b>33,4%</b><span>${es ? "inflación anual (INDEC)" : "yearly inflation (INDEC)"}</span></div>
      <div><b>22%</b><span>${es ? "más caro el dólar tarjeta que el cripto" : "dearer card dollar than crypto dollar"}</span></div>
      <div><b>1 min</b><span>${es ? "de tus dólares a tus pesos" : "from your dollars to your pesos"}</span></div>
    </div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  <div class="head reveal">
    <div><span class="eyebrow">${es ? "Qué hace" : "What it does"}</span><h2>${es ? html`Un crédito que <em>se cuida solo.</em>` : html`Credit that <em>looks after itself.</em>`}</h2></div>
    <p>${es ? "Todo lo importante pasa en contratos públicos en Celo: el préstamo, los límites del agente, tu historial. Nadie, ni nosotros, puede mover tu plata a otro lado." : "Everything that matters happens in public contracts on Celo: the loan, the agent's limits, your record. No one, us included, can move your money anywhere else."}</p>
  </div>
  <div class="bento">
    <article class="tile t-agent reveal">
      <span class="eyebrow">${es ? "El agente" : "The agent"}</span>
      <h3>${es ? "Firmás una regla. El agente la cumple." : "You sign a rule. The agent keeps it."}</h3>
      <p>${es ? "Si tu préstamo se acerca al riesgo, agrega tus propios dólares o paga con tus propios pesos, en el orden que elegiste y sin pasarse de tus topes diarios. Cada acción cita tu regla." : "If your loan nears risk, it adds your own dollars or repays with your own pesos, in the order you chose and never past your daily caps. Every action quotes your rule."}</p>
      <div class="card-label" style="margin-top:22px;margin-bottom:0;color:rgba(244,239,228,.5)">${es ? "Así te habla · ejemplos" : "How it talks to you · examples"}</div>
      <div class="feed" style="margin-top:12px">
        <div><time>09:41</time><span>${es ? "Tu préstamo llegó al 71%. Agregué US$ 3 de tus dólares. Volvió al 60%." : "Your loan reached 71%. I added US$3 of your dollars. Back to 60%."}</span></div>
        <div><time>14:05</time><span>${es ? "Te entraron $ 50.000. Pagué $ 40.000 y te dejé $ 10.000, como pediste." : "ARS 50,000 arrived. I repaid ARS 40,000 and left you ARS 10,000, as you asked."}</span></div>
        <div><time>18:30</time><span>${es ? "Los precios no coinciden con Binance ni con dolarapi. Pausé préstamos nuevos." : "Prices disagree with Binance and dolarapi. I paused new loans."}</span></div>
      </div>
    </article>
    <article class="tile t-taps reveal d1">
      <span class="eyebrow">MiniPay</span>
      <h3>${es ? "Tres toques." : "Three taps."}</h3>
      <p>${es ? "Una firma gratis por tus dólares y una confirmación. MiniPay paga la red en dólares." : "One free signature for your dollars and one confirmation. MiniPay pays the network in dollars."}</p>
      <div class="bottom"><div class="steps-mini"><span></span><span></span><span></span></div></div>
    </article>
    <article class="tile t-dollars reveal d2">
      <span class="eyebrow">${es ? "Tus dólares" : "Your dollars"}</span>
      <h3>${es ? "Siguen siendo tuyos." : "Stay yours."}</h3>
      <p>${es ? "Cuando pagás todo, vuelven en la misma transacción. Pagar tarde nunca vende tu garantía." : "When you repay in full they come back in the same transaction. Paying late never sells your guarantee."}</p>
    </article>
    <article class="tile t-lend reveal">
      <img src="/static/img/mercado-800.webp" srcset="/static/img/mercado-800.webp 800w, /static/img/mercado-1600.webp 1600w" sizes="(max-width: 960px) 100vw, 50vw" alt="${es ? "Mercado de San Telmo, Buenos Aires" : "San Telmo market, Buenos Aires"}" loading="lazy">
      <span class="credit">Josefito123 · CC BY-SA 4.0</span>
      <div class="over">
        <span class="eyebrow" style="color:rgba(244,239,228,.7)">${es ? "Para quien tiene pesos" : "If you hold pesos"}</span>
        <h3>${es ? "Prestá y ganá todos los días." : "Lend and earn every day."}</h3>
        <p>${es ? `Al 80% de uso, quienes prestan ganan cerca de 25,9% al año, más que la BADLAR (${percent(REFS.badlar.bps, lang)}). Retirás cuando haya pesos libres.` : `At 80% use, lenders earn about 25.9% a year, above BADLAR (${percent(REFS.badlar.bps, lang)}). Withdraw whenever there are free pesos.`}</p>
        <a class="btn light" href="${href(lang, "/prestar")}" style="margin-top:14px">${t(lang, "lend")} <span class="arrow">→</span></a>
      </div>
    </article>
    <article class="tile t-credit reveal d1">
      <span class="eyebrow">${es ? "Tu historial" : "Your record"}</span>
      <h3>${es ? "Pagar a tiempo te abarata el próximo." : "Paying on time makes the next one cheaper."}</h3>
      <p>${es ? "Cada préstamo pagado a tiempo queda escrito en Celo, a tu nombre. Lo puede leer cualquier app." : "Every loan repaid on time is written on Celo, in your name. Any app can read it."}</p>
      <div class="tiers">
        <div><b>60%</b><span>${es ? "primer préstamo" : "first loan"}</span></div>
        <div><b>−1</b><span>${es ? "punto tras 1" : "point after 1"}</span></div>
        <div><b>−2</b><span>${es ? "tras 3" : "after 3"}</span></div>
        <div><b>−3</b><span>${es ? "tras 6" : "after 6"}</span></div>
      </div>
    </article>
    <article class="tile t-open reveal">
      <div>
        <span class="eyebrow">${es ? "A la vista" : "In the open"}</span>
        <h3>${es ? "Cada transacción, verificable." : "Every transaction, checkable."}</h3>
        <p>${es ? "Cinco contratos verificados en Celo, sin dueño que pueda retirar fondos. Cada transacción lleva la etiqueta del evento." : "Five verified contracts on Celo, with no owner able to withdraw funds. Every transaction carries the event's tag."}</p>
        <div class="big-num" style="margin-top:18px">0</div>
        <p class="muted small">${es ? "transacciones sin etiqueta desde el código del evento" : "untagged transactions since the event code"}</p>
      </div>
      <div class="addr-list">
        <a href="${addrUrl(dep.pool)}"><span>PesoPool</span><span>${short(dep.pool)}</span></a>
        <a href="${addrUrl(dep.guard)}"><span>LoanGuard</span><span>${short(dep.guard)}</span></a>
        <a href="${addrUrl(dep.creditBook)}"><span>CreditBook</span><span>${short(dep.creditBook)}</span></a>
        <a href="${addrUrl(dep.priceModule)}"><span>PriceModule</span><span>${short(dep.priceModule)}</span></a>
        ${dep.gentleKeeper ? html`<a href="${addrUrl(dep.gentleKeeper)}"><span>GentleKeeper</span><span>${short(dep.gentleKeeper)}</span></a>` : ""}
        <a href="${addrUrl(AGENT)}"><span>${es ? "Agente · ERC-8004 #10043" : "Agent · ERC-8004 #10043"}</span><span>${short(AGENT)}</span></a>
      </div>
    </article>
  </div>
</div></section>

<section class="section"><div class="wrap reveal">
  <div class="head">
    <div><span class="eyebrow">${es ? "Cómo funciona" : "How it works"}</span><h2>${es ? html`De tus dólares a tus pesos, <em>y de vuelta.</em>` : html`From your dollars to your pesos, <em>and back.</em>`}</h2></div>
    <p>${es ? "Sin formularios, sin cuenta en un banco, sin vender nada." : "No forms, no bank account, nothing sold."}</p>
  </div>
  <ol class="steps">
    <li><h3>${es ? "Cotizá" : "Get a quote"}</h3><p>${es ? "Cuántos pesos y por cuánto tiempo. Ves la tasa, lo que devolvés y lo que pagarías en el banco." : "How many pesos and for how long. You see the rate, what you repay and what the bank would charge."}</p></li>
    <li><h3>${es ? "Pedí" : "Borrow"}</h3><p>${es ? "Una firma gratis por tus USDT y una confirmación. Los pesos llegan a tu billetera." : "One free signature for your USDT and one confirmation. The pesos land in your wallet."}</p></li>
    <li><h3>${es ? "Dejalo en manos del agente" : "Hand it to the agent"}</h3><p>${es ? "Si querés, firmás una regla con topes. El contrato no lo deja pasarse." : "If you want, sign a rule with caps. The contract won't let it go further."}</p></li>
    <li><h3>${es ? "Pagá y recuperá" : "Repay and get it back"}</h3><p>${es ? "En pesos o en dólares, cuando quieras. Tus dólares vuelven en la misma transacción." : "In pesos or dollars, whenever you want. Your dollars come back in the same transaction."}</p></li>
  </ol>
</div></section>

<section class="dark section"><div class="wrap">
  <div class="head reveal">
    <div><span class="eyebrow">${es ? "Las líneas" : "The lines"}</span><h2>${es ? html`Un peso que cae <em>te cuida.</em>` : html`A falling peso <em>protects you.</em>`}</h2></div>
    <p>${es ? "Debés en pesos y dejaste dólares: si el peso cae, tu préstamo está más seguro. El riesgo llega si el peso se fortalece, y ahí actúa el agente." : "You owe pesos and left dollars: if the peso falls, your loan gets safer. Risk comes if the peso strengthens, and that is when the agent acts."}</p>
  </div>
  <div class="lines reveal" role="img" aria-label="${es ? "Tu préstamo empieza por debajo del 60%; el agente actúa al 70%; pasando el 80% se puede vender una parte, hasta volver al 78%." : "Your loan starts below 60%; the agent acts at 70%; past 80% a part can be sold, back to 78%."}">
    <div class="track"></div>
    <div class="you"></div>
    <div class="pin" style="left:40%"><b>60%</b><span>${es ? "máximo para empezar" : "most you can start at"}</span></div>
    <div class="pin" style="left:60%"><b>70%</b><span>${es ? "el agente te protege" : "the agent protects you"}</span></div>
    <div class="pin" style="left:80%"><b>80%</b><span>${es ? "se vende lo justo, hasta el 78%" : "only enough is sold, to 78%"}</span></div>
  </div>
  <ul class="lines-legend">
    <li><b>60%</b>${es ? "lo máximo para empezar" : "the most you can start at"}</li>
    <li><b>70%</b>${es ? "el agente te protege con tu plata" : "the agent protects you with your money"}</li>
    <li><b>80%</b>${es ? "se vende lo justo, hasta volver al 78%" : "only enough is sold, back to 78%"}</li>
  </ul>
  <div class="never reveal">
    <div><b>${es ? "Nunca mueve plata a otro lado." : "Never moves money elsewhere."}</b><p>${es ? "Solo de tu billetera a tu propio préstamo. Lo hace cumplir LoanGuard en la cadena." : "Only from your wallet into your own loan. LoanGuard enforces it on chain."}</p></div>
    <div><b>${es ? "Nunca se pasa de tus topes." : "Never goes past your caps."}</b><p>${es ? "Dólares por día, pesos por día y lo que siempre te deja. Vence cuando vos digas." : "Dollars a day, pesos a day and what it always leaves you. Expires when you say."}</p></div>
    <div><b>${es ? "Vende lo mínimo, si tiene que vender." : "Sells the least, if it must sell."}</b><p>${es ? "Primero intenta salvarlo con tu plata. Si no alcanza, vende solo hasta el 78%: en un préstamo de 1.000 USDT perdés US$ 5,80 en vez de US$ 19." : "It first tries to save it with your money. If that fails, it sells only to 78%: on a 1,000 USDT loan you lose US$5.80 instead of US$19."}</p></div>
  </div>
</div></section>

${proof && b ? html`<section class="section"><div class="wrap">
  <div class="head reveal">
    <div><span class="eyebrow">${es ? "Prueba" : "Proof"}</span><h2>${es ? html`Un préstamo real, <em>de punta a punta.</em>` : html`A real loan, <em>end to end.</em>`}</h2></div>
    <p>${es ? "En Celo mainnet, con wARS de verdad. Cada paso tiene su transacción; tocá cualquiera para verla en el explorador." : "On Celo mainnet, with real wARS. Every step has its transaction; tap any to see it on the explorer."}</p>
  </div>
  <div class="proof">
    <div class="card reveal">
      <div class="card-label">${t(lang, "myLoan")} #${proof.loan.id.toString()} · ${pillFor(proof.loan.borrower, lang)}</div>
      <div class="figure">${pesos(BigInt(b.args.pesos), lang)}</div>
      <div class="row"><span>${es ? "Dejó" : "Left"}</span><span class="v">${dollars(BigInt(b.args.collateral), lang)}</span></div>
      <div class="row"><span>${t(lang, "rateNow")}</span><span class="v">${percent(BigInt(b.args.rateBps), lang)}</span></div>
      <div class="row"><span>${es ? "Estado" : "Status"}</span><span class="v">${proof.loan.open ? t(lang, "open") : html`<span class="pill ok">${t(lang, "closed")}</span>`}</span></div>
      <a class="btn ghost block" style="margin-top:18px" href="${href(lang, `/prestamo/${proof.loan.id}`)}">${es ? "Ver el préstamo" : "See the loan"} <span class="arrow">→</span></a>
    </div>
    <div class="card reveal d1"><ul class="log">${proof.events.map((e) => html`<li>${eventLine(e, lang)}<br><a class="tx" href="${txUrl(e.tx)}">${short(e.tx)}</a></li>`)}</ul></div>
  </div>
</div></section>` : ""}

<section class="section"><div class="narrow faq reveal">
  <span class="eyebrow">${es ? "Preguntas" : "Questions"}</span>
  <h2 style="margin:16px 0 32px">${es ? html`Lo que <em>conviene saber.</em>` : html`Worth <em>knowing.</em>`}</h2>
  <details><summary>${es ? "¿Qué pasa si no pago a tiempo?" : "What if I don't repay on time?"}</summary><p>${es ? "La tasa sube 5 puntos hasta que pagues y, a los 7 días, tu historial lo marca como atrasado. Nunca se vende tu garantía por pagar tarde: solo el precio puede hacer que se venda una parte." : "The rate rises 5 points until you repay and, after 7 days, your record marks it late. Your guarantee is never sold for paying late: only the price can trigger a partial sale."}</p></details>
  <details><summary>${es ? "¿Quién tiene mis dólares?" : "Who holds my dollars?"}</summary><p>${es ? "El contrato PesoPool en Celo. No tiene ninguna función para que un administrador los retire. Vuelven a tu billetera cuando pagás." : "The PesoPool contract on Celo. It has no function that lets an administrator withdraw them. They return to your wallet when you repay."}</p></details>
  <details><summary>${es ? "¿Qué son los wARS?" : "What is wARS?"}</summary><p>${es ? "Pesos digitales de Ripio: 1 wARS = 1 peso. Los podés usar en Celo o pasarlos a tu cuenta bancaria desde la app de Ripio." : "Ripio's digital pesos: 1 wARS = 1 peso. Use them on Celo or move them to your bank account from the Ripio app."}</p></details>
  <details><summary>${es ? "¿Y si Ripio congela los wARS?" : "What if Ripio freezes wARS?"}</summary><p>${es ? "Tras 24 horas congelados, cada persona puede recuperar sus dólares hasta la línea del 70%. Está en el contrato y probado." : "After 24 hours frozen, each borrower can take their dollars back down to the 70% line. It is in the contract and tested."}</p></details>
  <details><summary>${es ? "¿De dónde sale el precio del dólar?" : "Where does the dollar price come from?"}</summary><p>${es ? "Del fondo wARS/USDT de Uniswap en Celo, con promedio de 30 minutos. El agente lo compara cada minuto con Binance y dolarapi; si no coinciden, pausa préstamos nuevos." : "From the wARS/USDT Uniswap pool on Celo, as a 30-minute average. The agent compares it every minute with Binance and dolarapi; if they disagree, it pauses new loans."}</p></details>
</div></section>

<section class="closing">${SUN_RAYS}<div class="narrow reveal">
  <span class="eyebrow">${es ? "Empezá con poco" : "Start small"}</span>
  <h2>${es ? html`Probalo con <em>un dólar.</em>` : html`Try it with <em>one dollar.</em>`}</h2>
  <p class="lede" style="margin:0 auto 32px">${es ? `Pedí $ 1.000 contra cerca de US$ 1, mirá cómo cuida el agente y devolvelo. Hoy hay ${pesos(v.pool.cash, lang)} libres para prestar.` : `Borrow ARS 1,000 against about US$1, watch the agent at work and repay it. ${pesos(v.pool.cash, lang)} are free to lend today.`}</p>
  <div class="cta-row">
    <a class="btn sol" href="${href(lang, "/probar")}">${t(lang, "tryIt")} <span class="arrow">→</span></a>
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
  ${presets.map((p) => html`<button class="btn ghost block" style="justify-content:space-between;text-align:left;min-height:70px;border-radius:16px;padding:12px 20px" data-action="preset" data-preset="${p.id}" data-loan="${loan.id.toString()}" data-debt="${loan.debt.toString()}" data-lang="${lang}"><span>${es ? p.es : p.en}<br><small class="muted" style="font-weight:400">${es ? p.sub.es : p.sub.en}</small></span><span class="arrow">→</span></button>`)}
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
<div class="card" id="readback" hidden style="background:var(--sol-wash);border-color:transparent">
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
