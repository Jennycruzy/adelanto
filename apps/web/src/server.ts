import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { html } from "hono/html";
import { getAddress, isAddress } from "viem";
import { availableToBorrow, dollars, parseRule, pesos, percent } from "@adelanto/core";
import { CELO } from "@adelanto/chain";
import { REFS, adminEvents, noticesFor, priceHistory, weeklyPool, agentActions, attributionAudit, balancesOf, creditOf, dep, depositRows, labelOf, lastTick, loanEvents, loanRows, loanView, poolView, pub, quoteFor } from "./data.ts";
import { langOf, t, type Lang } from "./i18n.ts";
import { addrUrl, ago, borrowPage, guardPage, historyPage, home, href, layout, lendPage, loanPage, plain, txUrl } from "./views.ts";
import { ruleText, saveRule } from "./rules.ts";
import { catalog, credit, pesoRate, quote as paidQuote, x402Middleware } from "./x402.ts";

const app = new Hono();
const lang = (c: any): Lang => langOf(c.req.query("lang"));
const json = (c: any, body: unknown, status = 200) =>
  c.body(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2), status, { "content-type": "application/json; charset=utf-8" });

// Paid answers for other agents (x402 through Celo's facilitator); the catalogue is free.
app.get("/x402", (c) => catalog(c));
app.use("/x402/*", x402Middleware());
app.get("/x402/peso-rate", (c) => pesoRate(c));
app.get("/x402/quote", (c) => paidQuote(c));
app.get("/x402/credit/:address", (c) => credit(c));

app.use("/static/*", serveStatic({ root: "./apps/web/public", rewriteRequestPath: (p) => p.replace(/^\/static/, "") }));
app.get("/static/adelanto.png", serveStatic({ path: "./agent/adelanto.png" }));

app.get("/", async (c) => {
  const l = lang(c);
  const v = await poolView();
  const rows = loanRows();
  const closed = rows.find((r) => !r.open) ?? rows[0];
  let proof = null;
  if (closed) {
    const loan = await loanView(BigInt(closed.id), v);
    if (loan) proof = { loan, events: loanEvents(loan.id), actions: agentActions(loan.id, 5) };
  }
  const tick = lastTick();
  return c.html(home(l, v, proof, tick ? Date.now() - tick : null, agentActions(undefined, 4), priceHistory(24, 144)));
});

app.get("/pedir", async (c) => {
  const l = lang(c);
  const v = await poolView();
  // Suggested amount: what the pool can lend right now, at most 10,000 pesos, in whole hundreds; quoted at once.
  const avail = availableToBorrow(v.pool).pesos / 10n ** 18n;
  const suggested = (avail > 10_000n ? 10_000n : avail) / 100n * 100n;
  const raw = (c.req.query("pesos") ?? "").replace(/[^0-9]/g, "").slice(0, 12) || (suggested >= 1_000n ? suggested.toString() : "1000");
  const d = Number(c.req.query("dias") ?? 30);
  const days = [7, 30, 60, 90].includes(d) ? d : 30;
  return c.html(borrowPage(l, v, { pesos: raw, days }, quoteFor(v, BigInt(raw), days)));
});

app.get("/prestamo/:id", async (c) => {
  const l = lang(c);
  const id = c.req.param("id");
  if (!/^\d{1,9}$/.test(id)) return c.notFound();
  const v = await poolView();
  const loan = await loanView(BigInt(id), v);
  if (!loan) return c.notFound();
  return c.html(loanPage(l, v, loan, loanEvents(loan.id), agentActions(loan.id)));
});

app.get("/historial", async (c) => {
  const l = lang(c);
  const w = (c.req.query("w") ?? "").trim();
  if (!w) return c.html(historyPage(l, null));
  if (!isAddress(w)) return c.html(historyPage(l, null, true), 400);
  const who = getAddress(w);
  const credit = await creditOf(who);
  // open or closed is read from chain for each loan, so the list never lags the credit record above it
  const v = await poolView();
  const loans = await Promise.all(
    loanRows()
      .filter((r) => getAddress(r.borrower) === who)
      .map(async (r) => {
        const lv = await loanView(BigInt(r.id), v).catch(() => null);
        return lv ? { ...r, open: lv.open ? 1 : 0 } : r;
      }),
  );
  const actions = loans.flatMap((r) => agentActions(BigInt(r.id), 10)).sort((a, b) => Number(b.at) - Number(a.at)).slice(0, 10);
  return c.html(historyPage(l, { who, credit: credit as any, loans, actions, notices: noticesFor(who) }));
});

app.get("/prestar", async (c) => c.html(lendPage(lang(c), await poolView())));

app.get("/transparencia", async (c) => {
  const l = lang(c);
  const es = l === "es";
  const v = await poolView();
  const loans = loanRows();
  const deps = depositRows().map((r: any) => ({ ...r, args: JSON.parse(r.args) }));
  const audit = attributionAudit();
  const count = (lab: string) => loans.filter((r) => labelOf(r.borrower) === lab).length;
  const lenders = new Set(deps.filter((d) => d.name === "Deposit").map((d) => getAddress(d.args.owner)));
  const lenderCount = (lab: string) => [...lenders].filter((a) => labelOf(a) === lab).length;
  const pill = (lab: string) => html`<span class="pill ${lab === "USER" ? "ok" : lab === "JUDGE" ? "celeste" : ""}">${lab === "OURS" ? t(l, "ours") : lab === "JUDGE" ? t(l, "judge") : t(l, "user")}</span>`;
  const admin = adminEvents();
  const weekly = weeklyPool();
  return c.html(
    plain(
      l,
      t(l, "transparency"),
      html`<div class="kpis">
  <div class="card"><div class="card-label">${es ? "Préstamos de otras personas" : "Loans from other people"}</div><div class="figure sm num">${count("USER")}</div></div>
  <div class="card"><div class="card-label">${es ? "Préstamos del jurado" : "Judge loans"}</div><div class="figure sm num">${count("JUDGE")}</div></div>
  <div class="card"><div class="card-label">${es ? "Préstamos nuestros" : "Our own loans"}</div><div class="figure sm num">${count("OURS")}</div></div>
  <div class="card"><div class="card-label">${es ? "Quienes prestan · nuestros / otros" : "Lenders · ours / others"}</div><div class="figure sm num">${lenderCount("OURS")} / ${lenderCount("USER")}</div></div>
</div>
<div class="split" style="margin-top:20px">
<div>
<div class="card">
  <div class="card-label">${es ? "Salud del fondo" : "Pool health"}</div>
  <div class="row"><span>${es ? "Depositado" : "Deposited"}</span><span class="v">${pesos(v.totalAssets, l)}</span></div>
  <div class="row"><span>${es ? "Prestado" : "Lent"}</span><span class="v">${pesos(v.pool.totalDebt, l)}</span></div>
  <div class="row"><span>${es ? "Libre" : "Free"}</span><span class="v">${pesos(v.pool.cash, l)}</span></div>
  <div class="row"><span>${es ? "Reserva" : "Reserve"}</span><span class="v">${pesos(v.pool.reserve, l)}</span></div>
  <div class="row"><span>${es ? "Deuda sin cubrir" : "Uncovered debt"}</span><span class="v">${admin.filter((e: any) => e.name === "BadDebt").length === 0 ? pesos(0n, l) : es ? "ver cambios" : "see changes"}</span></div>
  <p class="small muted" style="margin:14px 0 0">${t(l, "updated")} <a href="https://celoscan.io/block/${v.block}">${v.block.toString()}</a></p>
</div>
${weekly ? html`<div class="card">
  <div class="card-label">${es ? "El resumen de la semana del agente" : "The agent's weekly summary"} · ${ago(Number(weekly.created_at), l)}</div>
  <p style="margin:0">${es ? weekly.text_es : weekly.text_en}</p>
  <p class="small muted" style="margin:12px 0 0">${es ? "Lo escribe solo cada domingo a las 20 h (Buenos Aires) con saldos leídos de Celo; si una cifra del texto no sale de esos datos, no se publica." : "It writes this by itself every Sunday at 8 pm (Buenos Aires) from balances read on Celo; if any figure in the text does not come from that data, it is not published."}</p>
</div>` : ""}
<div class="card" style="background:var(--ink);color:var(--paper);border-color:transparent">
  <div class="card-label" style="color:rgba(244,239,228,.6)">${es ? "Cada transacción lleva nuestra etiqueta" : "Every transaction carries our tag"}</div>
  ${audit
    ? html`<div style="display:flex;gap:28px;flex-wrap:wrap;margin:8px 0 14px">
    <div><div class="figure" style="color:var(--sol)">${audit.totals.tagged}</div><div class="small" style="color:rgba(244,239,228,.7)">${es ? "etiquetadas" : "tagged"}</div></div>
    <div><div class="figure">${audit.totals.untaggedAfterCodeIssued}</div><div class="small" style="color:rgba(244,239,228,.7)">${es ? "sin etiqueta después del código" : "untagged after the code"}</div></div>
    <div><div class="figure" style="color:rgba(244,239,228,.5)">${audit.totals.sentBeforeCodeIssued}</div><div class="small" style="color:rgba(244,239,228,.7)">${es ? "pruebas anteriores al código" : "tests before the code"}</div></div>
  </div>
  <p class="small" style="color:rgba(244,239,228,.7);margin:0">${dep.attributionCode} · ${es ? "revisado" : "checked"} ${audit.checkedAt} · <a style="color:var(--sol)" href="https://github.com/Jennycruzy/adelanto/blob/main/evidence/attribution-audit.json">attribution-audit.json</a></p>`
    : ""}
</div>
<div class="card">
  <div class="card-label">${es ? "Contratos" : "Contracts"}</div>
  <div class="addr-list">
    <a href="${addrUrl(dep.pool)}"><span>PesoPool</span><span>${dep.pool.slice(0, 10)}…</span></a>
    <a href="${addrUrl(dep.guard)}"><span>LoanGuard</span><span>${dep.guard.slice(0, 10)}…</span></a>
    <a href="${addrUrl(dep.creditBook)}"><span>CreditBook</span><span>${dep.creditBook.slice(0, 10)}…</span></a>
    <a href="${addrUrl(dep.priceModule)}"><span>PriceModule</span><span>${dep.priceModule.slice(0, 10)}…</span></a>
    ${dep.gentleKeeper ? html`<a href="${addrUrl(dep.gentleKeeper)}"><span>GentleKeeper</span><span>${dep.gentleKeeper.slice(0, 10)}…</span></a>` : ""}
    <a href="${addrUrl("0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1")}"><span>${es ? "Agente · ERC-8004 #10043" : "Agent · ERC-8004 #10043"}</span><span>0xB93A6B8f…</span></a>
  </div>
</div>
</div>
<div>
<div class="card">
  <div class="card-label">${es ? "Préstamos" : "Loans"}</div>
  ${loans.length === 0 ? html`<p class="small muted" style="margin:0">${es ? "Ninguno todavía." : "None yet."}</p>` : html`<ul class="log">${loans.map((r) => html`<li><a href="${href(l, `/prestamo/${r.id}`)}">#${r.id}</a> · ${r.open ? t(l, "open") : t(l, "closed")} · ${pill(labelOf(r.borrower))}</li>`)}</ul>`}
</div>
<div class="card">
  <div class="card-label">${es ? "Depósitos y retiros" : "Deposits and withdrawals"}</div>
  <ul class="log">${deps.map((d) => html`<li>${d.name === "Deposit" ? (es ? "Depositó" : "Deposited") : es ? "Retiró" : "Withdrew"} ${pesos(BigInt(d.args.assets), l)} ${pill(labelOf(d.args.owner))}<br><a class="tx" href="${txUrl(d.tx)}">${d.tx.slice(0, 10)}…</a></li>`)}</ul>
</div>
<div class="card">
  <div class="card-label">${es ? "Cambios de administración" : "Admin changes"}</div>
  ${admin.length === 0 ? html`<p class="small muted" style="margin:0">${es ? "Ninguno desde el despliegue." : "None since deployment."}</p>` : html`<ul class="log">${admin.map((e: any) => html`<li>${e.name}<br><a class="tx" href="${txUrl(e.tx)}">${e.tx.slice(0, 10)}…</a></li>`)}</ul>`}
</div>
</div>
</div>`,
      "/transparencia",
      { eyebrow: t(l, "transparency"), heading: es ? html`Todo, <em>a la vista.</em>` : html`Everything, <em>in the open.</em>`, lede: es ? "Todo lo que mostramos sale de la cadena. Separamos lo nuestro de lo del jurado y de lo de cualquier otra persona." : "Everything shown comes from the chain. Our own activity is kept apart from the judges' and everyone else's.", wide: true },
    ),
  );
});

app.get("/como-funciona", (c) => {
  const l = lang(c);
  const es = l === "es";
  const steps = es
    ? [
        ["Dejás dólares, recibís pesos", "Dejás USDT en garantía y recibís pesos digitales de Ripio (wARS) en el mismo minuto, hasta el 60% de lo que dejás. Te sugerimos 50%."],
        ["Pagás una tasa justa", `La tasa anual sigue el uso del fondo: 22% con el fondo libre, 36% con el 80% prestado, más 0,25% de comisión de apertura. Hoy el banco cobra ${percent(REFS.bankLoan.bps, l)} (${REFS.bankLoan.source}).`],
        ["El agente cuida tu préstamo", "Si querés, firmás una regla una vez y el agente agrega tus dólares o paga con tus pesos cuando llega a riesgo, sin pasarse de tus límites. El contrato hace cumplir los límites, no nosotros."],
        ["Pagás y recuperás", "Cuando pagás todo, tus dólares vuelven en la misma transacción. Cada préstamo pagado a tiempo baja tu tasa y sube tu límite la próxima vez."],
        ["Si el dólar baja mucho", "Si tu préstamo pasa el 80% de lo que dejaste, se vende solo la parte de tu garantía necesaria para volver al 78%, más 5%. El resto sigue siendo tuyo."],
      ]
    : [
        ["Leave dollars, get pesos", "Leave USDT as a guarantee and receive Ripio digital pesos (wARS) in the same minute, up to 60% of what you leave. We suggest 50%."],
        ["Pay a fair rate", `The yearly rate follows pool use: 22% when idle, 36% at 80% lent, plus a 0.25% opening fee. The bank charges ${percent(REFS.bankLoan.bps, l)} today (${REFS.bankLoan.source}).`],
        ["The agent looks after it", "If you want, sign a rule once and the agent adds your dollars or repays with your pesos when the loan reaches risk, never beyond your limits. The contract enforces the limits, not us."],
        ["Repay and get it back", "When you repay in full, your dollars come back in the same transaction. Each loan repaid on time lowers your rate and raises your limit next time."],
        ["If the dollar falls a lot", "If your loan passes 80% of what you left, only the part of the guarantee needed to get back to 78% is sold, plus 5%. The rest stays yours."],
      ];
  return c.html(
    plain(
      l,
      t(l, "how"),
      html`<ol class="log" style="margin-bottom:40px">${steps.map(([h, p]) => html`<li style="padding-bottom:28px"><h3 style="margin-bottom:8px">${h}</h3><p class="muted" style="margin:0">${p}</p></li>`)}</ol>
<div class="card">
  <div class="card-label">${es ? "Riesgos, en una línea cada uno" : "Risks, one line each"}</div>
  <div class="row"><span>${t(l, "borrowRisk")}</span></div>
  <div class="row"><span>${t(l, "lendRisk")}</span></div>
  <div class="row"><span>${es ? "Ripio puede pausar los pesos digitales; si pasa, tus dólares siguen siendo tuyos y el contrato tiene una salida para recuperarlos." : "Ripio can pause the digital pesos; if it does, your dollars stay yours and the contract has an exit to get them back."}</span></div>
  <div class="row"><span>${es ? "El precio sale del fondo wARS/USDT de Uniswap en Celo (promedio de 30 minutos); el agente lo compara con Binance y dolarapi y pausa préstamos nuevos si no coinciden." : "The price comes from the Uniswap wARS/USDT pool on Celo (30-minute average); the agent compares it with Binance and dolarapi and pauses new loans if they disagree."}</span></div>
</div>
<div class="cta-row" style="margin-top:28px"><a class="btn sol" href="${href(l, "/pedir")}">${t(l, "borrow")} <span class="arrow">→</span></a><a class="btn ghost" href="${href(l, "/transparencia")}">${t(l, "transparency")}</a></div>`,
      "/como-funciona",
      { eyebrow: t(l, "how"), heading: es ? html`Cinco cosas <em>y listo.</em>` : html`Five things, <em>that's all.</em>`, lede: es ? "Sin letra chica: todo esto está escrito en contratos públicos en Celo." : "No small print: all of this is written in public contracts on Celo." },
    ),
  );
});

app.get("/cuidar/:id", async (c) => {
  const l = lang(c);
  const id = c.req.param("id");
  if (!/^\d{1,9}$/.test(id)) return c.notFound();
  const v = await poolView();
  const loan = await loanView(BigInt(id), v);
  if (!loan) return c.notFound();
  return c.html(guardPage(l, loan, loan.guard ? ruleText(loan.guard.ruleHash) : null));
});

// The rule in the borrower's own words → limits, a question with buttons, or a stop. Nothing is signed here.
app.post("/api/parse-rule", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.text !== "string" || body.text.length > 600 || !/^\d{1,9}$/.test(String(body.loanId ?? ""))) return json(c, { error: "bad request" }, 400);
  const v = await poolView();
  const loan = await loanView(BigInt(body.loanId), v);
  if (!loan || !loan.open) return json(c, { error: "no open loan" }, 404);
  const block = await pub.getBlock();
  const r = parseRule(body.text, { debt: loan.debt, collateral: loan.collateral, dueAt: loan.dueAt, maxRateBps: 0 }, block.timestamp, body.lang === "en" ? "en" : "es");
  return json(c, r);
});

app.post("/api/rule", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !isAddress(body.borrower) || typeof body.text !== "string") return json(c, { error: "bad request" }, 400);
  const r = await saveRule(getAddress(body.borrower), body.text);
  return json(c, { result: r }, r === "saved" ? 200 : 400);
});

app.get("/probar", async (c) => {
  const l = lang(c);
  const es = l === "es";
  const v = await poolView();
  const q = quoteFor(v, 1_000n, 7);
  // the example: the newest closed loan the agent acted on, else the newest closed loan
  const closedRows = loanRows().filter((r) => !r.open);
  const closed = closedRows.find((r) => agentActions(BigInt(r.id), 1).length > 0) ?? closedRows[0];
  const steps = es
    ? [
        html`<b>Sin billetera.</b> Mirá un préstamo real cerrado, con cada transacción y lo que hizo el agente solo. ${closed ? html`<a href="${href(l, `/prestamo/${closed.id}`)}">Préstamo #${closed.id} →</a>` : ""}`,
        html`<b>Transparencia.</b> Lo nuestro, lo del jurado y lo de otras personas, por separado. <a href="${href(l, "/transparencia")}">Ver →</a>`,
        html`<b>Pedí $ 1.000.</b> En MiniPay (Ajustes → Acerca de → tocá la versión hasta activar el modo desarrollador → Developer settings → Load test page → esta dirección) o cualquier billetera de Celo con unos US$ 1,25 en USDT.`,
        html`<b>Decile qué hacer.</b> En la página del préstamo, «Cuidar mi préstamo»: escribí o dictá tu regla, por ejemplo «Cuando me entren pesos, pagá el préstamo, máximo 500 por día». Leé lo que va a hacer y firmá. Si después te mandan pesos, el agente paga solo y cita tu regla.`,
        html`<b>Pagalo.</b> «Pagar todo»: tus dólares vuelven en la misma transacción. Tu préstamo queda en <a href="${href(l, "/historial")}">Mi historial</a>.`,
        html`<b>Agentes.</b> <code class="tx">GET /api/public/rates</code>, <a href="/llms.txt">/llms.txt</a> y respuestas pagas por x402 en wARS o USD₮: <a href="/x402">/x402</a>. Código: <a href="https://github.com/Jennycruzy/adelanto">GitHub</a>.`,
      ]
    : [
        html`<b>No wallet.</b> Look at a real closed loan, with every transaction and what the agent did on its own. ${closed ? html`<a href="${href(l, `/prestamo/${closed.id}`)}">Loan #${closed.id} →</a>` : ""}`,
        html`<b>Transparency.</b> Ours, the judges' and other people's, apart. <a href="${href(l, "/transparencia")}">See →</a>`,
        html`<b>Borrow ARS 1,000.</b> In MiniPay (Settings → About → tap the version until developer mode is on → Developer settings → Load test page → this address) or any Celo wallet with about US$1.25 in USDT.`,
        html`<b>Tell it what to do.</b> On the loan page, “Look after my loan”: write or dictate your rule in Spanish, for example “Cuando me entren pesos, pagá el préstamo, máximo 500 por día”. Read what it will do and sign. If pesos are then sent to you, the agent repays on its own and quotes your rule.`,
        html`<b>Repay it.</b> “Repay all”: your dollars come back in the same transaction. The loan stays on <a href="${href(l, "/historial")}">My record</a>.`,
        html`<b>Agents.</b> <code class="tx">GET /api/public/rates</code>, <a href="/llms.txt">/llms.txt</a> and paid answers over x402 in wARS or USD₮: <a href="/x402">/x402</a>. Code: <a href="https://github.com/Jennycruzy/adelanto">GitHub</a>.`,
      ];
  return c.html(
    plain(
      l,
      t(l, "tryIt"),
      html`<div class="split">
<div class="card"><div class="card-label">${es ? "Diez minutos" : "Ten minutes"}</div><ul class="log">${steps.map((s) => html`<li style="padding-bottom:22px">${s}</li>`)}</ul></div>
<div>
${q.ok
  ? html`<div class="card" style="background:var(--celeste-wash);border-color:var(--ink)">
  <div class="card-label">${t(l, "youGet")}</div>
  <div class="figure">${pesos(q.received, l)}</div>
  <div class="row" style="margin-top:12px"><span>${t(l, "youLeave")}</span><span class="v">${dollars(q.collateral, l)}</span></div>
  <div class="row"><span>${t(l, "rateNow")}</span><span class="v">${percent(q.rateBps, l)}</span></div>
  <div class="row"><span>${t(l, "owedAtEnd")} (7 ${t(l, "days")})</span><span class="v">${pesos(q.owedAtTerm, l)}</span></div>
  <div id="status"></div>
  <button class="btn block" style="margin-top:18px" data-action="borrow" data-pesos="${q.pesos.toString()}" data-days="7" data-collateral="${q.collateral.toString()}" data-maxrate="${q.maxRateBps.toString()}" data-lang="${l}">${es ? "Pedir $ 1.000" : "Borrow ARS 1,000"} <span class="arrow">→</span></button>
  <p class="small muted" style="text-align:center;margin:12px 0 0">${es ? "Una firma gratis y una confirmación." : "One free signature and one confirmation."}</p>
</div>`
  : html`<div class="notice">${es ? "Ahora no hay lugar para un préstamo de prueba; volvé en un rato." : "There is no room for a test loan right now; try again shortly."}</div>`}
</div>
</div>`,
      "/probar",
      { eyebrow: t(l, "tryIt"), heading: es ? html`Probalo con <em>plata real y chica.</em>` : html`Try it with <em>small, real money.</em>`, lede: es ? "Todo queda en la cadena y en esta página." : "Everything stays on chain and on this site.", wide: true, wallet: true },
    ),
  );
});

// The calculator on the home page. A real quote when the pool can lend it now; above that, the same formulas at
// today's rate, marked as an estimate with what the pool can lend today.
app.get("/api/quote", async (c) => {
  const pesosWhole = BigInt((c.req.query("pesos") ?? "0").replace(/[^0-9]/g, "").slice(0, 10) || "0");
  const d = Number(c.req.query("dias") ?? 30);
  const days = [7, 30, 60, 90].includes(d) ? d : 30;
  const v = await poolView();
  const q = quoteFor(v, pesosWhole, days);
  const W = 10n ** 18n;
  if (q.ok) return json(c, { kind: "quote", pesos: q.pesos, days, collateral: q.collateral, rateBps: q.rateBps, fee: q.fee, received: q.received, interest: q.interest, bankInterest: q.bankInterest, saving: q.saving, block: v.block });
  if ((q.reason === "POOL_TOO_THIN" || q.reason === "CAP_REACHED") && v.borrowPrice && pesosWhole >= 1000n) {
    const pesos = pesosWhole * W, D = BigInt(days);
    const interest = (pesos * v.borrowRateBps * D) / (10_000n * 365n);
    const bankInterest = (pesos * REFS.bankLoan.bps * D) / (10_000n * 365n);
    const fee = (pesos * 25n + 9_999n) / 10_000n;
    const collateral = (pesos * 10_000n * 1_000_000n) / (5_000n * v.borrowPrice) + 1n;
    return json(c, { kind: "estimate", limit: (q as any).limit ?? 0n, pesos, days, collateral, rateBps: v.borrowRateBps, fee, received: pesos - fee, interest, bankInterest, saving: bankInterest > interest + fee ? bankInterest - interest - fee : 0n, block: v.block });
  }
  return json(c, { kind: "refused", reason: q.reason, limit: (q as any).limit ?? null, block: v.block });
});

app.get("/api/public/rates", async (c) => {
  const v = await poolView();
  return json(c, {
    readAt: new Date(v.readAt).toISOString(),
    block: v.block,
    borrowRateBps: v.borrowRateBps,
    lenderRateBps: v.lenderRateBps,
    utilizationBps: v.utilizationBps,
    freePesos: v.pool.cash,
    lentPesos: v.pool.totalDebt,
    pesosPerDollar: { borrow: v.borrowPrice, average30m: v.liquidationPrice, spot: v.spot },
    newLoans: v.paused ? "paused" : v.priceOk ? "open" : "price_refused",
    references: REFS,
    contracts: { pool: dep.pool, guard: dep.guard, creditBook: dep.creditBook, priceModule: dep.priceModule, gentleKeeper: dep.gentleKeeper ?? null, wars: CELO.wars, usdt: CELO.usdt },
  });
});

app.get("/api/public/prices", (c) => {
  const hours = Math.min(168, Math.max(1, Number(c.req.query("hours") ?? 24) || 24));
  const points = priceHistory(hours, 500);
  return json(c, {
    what: "The agent's own once-a-minute price check: the Celo wARS/USDT pool's 30-minute average against Binance USDTARS and dolarapi cripto, in pesos per dollar.",
    hours,
    points: points.map((p) => ({ at: new Date(p.t).toISOString(), pool30m: p.pool, binance: p.binance, dolarapi: p.dolarapi })),
  });
});

app.get("/api/loan/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^\d{1,9}$/.test(id)) return json(c, { error: "bad id" }, 400);
  const v = await poolView();
  const loan = await loanView(BigInt(id), v);
  return loan ? json(c, loan) : json(c, { error: "not found" }, 404);
});

app.get("/api/me/:addr", async (c) => {
  const a = c.req.param("addr");
  if (!isAddress(a)) return json(c, { error: "bad address" }, 400);
  const who = getAddress(a);
  const loans = loanRows().filter((r) => getAddress(r.borrower) === who).map((r) => ({ id: r.id, open: !!r.open }));
  const [bal, credit] = await Promise.all([balancesOf(who), creditOf(who)]);
  const notices = noticesFor(who, 20).map((n) => ({ kind: n.kind, loanId: n.loan_id, at: new Date(Number(n.created_at)).toISOString(), es: n.text_es, en: n.text_en }));
  return json(c, { address: who, ...bal, credit, loans, notices });
});

app.get("/health", (c) => {
  const tick = lastTick();
  return json(c, { ok: true, agentLastTickSecondsAgo: tick ? Math.round((Date.now() - tick) / 1000) : null });
});

app.get("/llms.txt", async (c) => {
  const v = await poolView();
  return c.text(`# ADELANTO

Pesos now, without selling your dollars. Loans of Ripio wARS on Celo against USDT, with an agent that looks after
each loan inside limits the borrower signs once. Personal loans at Argentine banks: 64.63% TNA (BCRA, 2 Nov 2026).

Today (block ${v.block}): borrow ${percent(v.borrowRateBps, "en")} a year, lenders earn ${percent(v.lenderRateBps, "en")},
${pesos(v.pool.cash, "en")} free to lend, ${pesos(v.pool.totalDebt, "en")} lent.

## Contracts (Celo mainnet, chain 42220, verified on Sourcify and Blockscout)
- PesoPool ${dep.pool}: lenders' wARS and loans against USDT
- LoanGuard ${dep.guard}: borrower-signed limits; the only way the agent touches a loan
- CreditBook ${dep.creditBook}: public credit record per wallet
- PriceModule ${dep.priceModule}: pesos per dollar from the wARS/USDT Uniswap v3 pool
${dep.gentleKeeper ? `- GentleKeeper ${dep.gentleKeeper}: gentle liquidation computed on chain\n` : ""}- Agent wallet 0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1, ERC-8004 identity 10043

## Check every claim on chain
- Price history the agent checks: GET /api/public/prices?hours=24 (free JSON)
- Rates and pool: GET /api/public/rates (free JSON), or read PesoPool.borrowRateBps(0), lenderRateBps(), cash(), totalDebt()
- A loan: GET /api/loan/<id>, or PesoPool.loans(id) and debtOf(id); its history is the pool's events for that id
- Attribution: every transaction since the event code carries ERC-8021 code celo_0e96c1ff3fa8 (evidence/attribution-audit.json)

## Paid answers over x402 (v2, scheme exact, eip155:42220)
Settled by Celo's facilitator (https://api.x402.celo.org) straight into the agent wallet. Pay in USD₮ (EIP-3009)
or wARS (Permit2; the facilitator sponsors the permit, so a wARS payer needs no CELO). GET /x402 lists them, free.
- GET /x402/peso-rate: the pool's 30-minute price against Binance and dolarapi, with a verdict. US$0.005 or 8 wARS
- GET /x402/quote?pesos=1000&days=30&tier=0: a firm borrow quote from the live pool. US$0.01 or 15 wARS
- GET /x402/credit/<address>: a wallet's repayment record and the line it unlocks. US$0.01 or 15 wARS
- Example buyer: scripts/x402-buy.ts in the source

## Source
https://github.com/Jennycruzy/adelanto
`);
});

const port = Number(process.env.PORT ?? 8795);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`web on http://${process.env.HOST ?? "127.0.0.1"}:${port}`);
