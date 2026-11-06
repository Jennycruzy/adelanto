import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { html } from "hono/html";
import { getAddress, isAddress } from "viem";
import { availableToBorrow, dollars, pesos, percent } from "@adelanto/core";
import { CELO } from "@adelanto/chain";
import { REFS, adminEvents, agentActions, attributionAudit, balancesOf, dep, depositRows, labelOf, lastTick, loanEvents, loanRows, loanView, poolView, quoteFor } from "./data.ts";
import { langOf, t, type Lang } from "./i18n.ts";
import { addrUrl, borrowPage, guardPage, home, href, lendPage, loanPage, plain, txUrl } from "./views.ts";
import { ruleText, saveRule } from "./rules.ts";

const app = new Hono();
const lang = (c: any): Lang => langOf(c.req.query("lang"));
const json = (c: any, body: unknown, status = 200) =>
  c.body(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2), status, { "content-type": "application/json; charset=utf-8" });

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
  return c.html(home(l, v, proof, tick ? Date.now() - tick : null));
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
  return c.html(
    plain(
      l,
      t(l, "transparency"),
      html`<h1>${t(l, "transparency")}</h1>
<p class="muted">${es ? "Todo lo que mostramos sale de la cadena. Separamos lo nuestro de lo de cualquier otra persona." : "Everything shown comes from the chain. Our own activity is kept apart from everyone else's."}</p>
<div class="card">
  <div class="row"><span>${es ? "Préstamos de nuestras billeteras" : "Loans from our wallets"}</span><span class="v">${count("OURS")}</span></div>
  <div class="row"><span>${es ? "Préstamos del jurado" : "Judge loans"}</span><span class="v">${count("JUDGE")}</span></div>
  <div class="row"><span>${es ? "Préstamos de otras personas" : "Loans from other people"}</span><span class="v">${count("USER")}</span></div>
  <div class="row"><span>${es ? "Quienes prestan (nuestros / otros)" : "Lenders (ours / others)"}</span><span class="v">${lenderCount("OURS")} / ${lenderCount("USER")}</span></div>
</div>
<h2>${es ? "Salud del fondo" : "Pool health"}</h2>
<div class="card">
  <div class="row"><span>${es ? "Depositado" : "Deposited"}</span><span class="v">${pesos(v.totalAssets, l)}</span></div>
  <div class="row"><span>${es ? "Prestado" : "Lent"}</span><span class="v">${pesos(v.pool.totalDebt, l)}</span></div>
  <div class="row"><span>${es ? "Reserva" : "Reserve"}</span><span class="v">${pesos(v.pool.reserve, l)}</span></div>
  <div class="row"><span>${es ? "Deuda sin cubrir" : "Uncovered debt"}</span><span class="v">${adminEvents().filter((e: any) => e.name === "BadDebt").length === 0 ? pesos(0n, l) : es ? "ver abajo" : "see below"}</span></div>
</div>
<h2>${es ? "Cada transacción lleva nuestra etiqueta" : "Every transaction carries our tag"}</h2>
<div class="card">${audit
  ? html`<div class="row"><span>${es ? "Etiquetadas desde el código del evento" : "Tagged since the event code"}</span><span class="v">${audit.totals.tagged}</span></div>
  <div class="row"><span>${es ? "Sin etiqueta después del código" : "Untagged after the code"}</span><span class="v">${audit.totals.untaggedAfterCodeIssued}</span></div>
  <div class="row"><span>${es ? "Pruebas de ruta anteriores al código (no cuentan)" : "Route tests before the code (not counted)"}</span><span class="v">${audit.totals.sentBeforeCodeIssued}</span></div>
  <p class="small muted">${es ? "Revisado" : "Checked"} ${audit.checkedAt} · <a href="https://github.com/Jennycruzy/adelanto/blob/main/evidence/attribution-audit.json">evidence/attribution-audit.json</a></p>`
  : ""}</div>
<h2>${es ? "Préstamos" : "Loans"}</h2>
<div class="card"><ul class="log">${loans.map((r) => html`<li><a href="${href(l, `/prestamo/${r.id}`)}">#${r.id}</a> · ${r.open ? t(l, "open") : t(l, "closed")} · <span class="pill">${labelOf(r.borrower)}</span></li>`)}</ul></div>
<h2>${es ? "Depósitos y retiros" : "Deposits and withdrawals"}</h2>
<div class="card"><ul class="log">${deps.map((d) => html`<li>${d.name === "Deposit" ? (es ? "Depositó" : "Deposited") : es ? "Retiró" : "Withdrew"} ${pesos(BigInt(d.args.assets), l)} <span class="pill">${labelOf(d.args.owner)}</span> · <a class="tx" href="${txUrl(d.tx)}">${d.tx.slice(0, 10)}…</a></li>`)}</ul></div>
<h2>${es ? "Cambios de administración" : "Admin changes"}</h2>
<div class="card">${adminEvents().length === 0 ? html`<p class="small muted">${es ? "Ninguno desde el despliegue." : "None since deployment."}</p>` : html`<ul class="log">${adminEvents().map((e: any) => html`<li>${e.name} · <a class="tx" href="${txUrl(e.tx)}">${e.tx.slice(0, 10)}…</a></li>`)}</ul>`}</div>
<h2>${es ? "Contratos" : "Contracts"}</h2>
<div class="card small">
  <div class="row"><span>PesoPool</span><a class="tx" href="${addrUrl(dep.pool)}">${dep.pool}</a></div>
  <div class="row"><span>LoanGuard</span><a class="tx" href="${addrUrl(dep.guard)}">${dep.guard}</a></div>
  <div class="row"><span>CreditBook</span><a class="tx" href="${addrUrl(dep.creditBook)}">${dep.creditBook}</a></div>
  <div class="row"><span>PriceModule</span><a class="tx" href="${addrUrl(dep.priceModule)}">${dep.priceModule}</a></div>
  ${dep.gentleKeeper ? html`<div class="row"><span>GentleKeeper</span><a class="tx" href="${addrUrl(dep.gentleKeeper)}">${dep.gentleKeeper}</a></div>` : ""}
  <div class="row"><span>${es ? "Agente (ERC-8004 #10043)" : "Agent (ERC-8004 #10043)"}</span><a class="tx" href="${addrUrl("0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1")}">0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1</a></div>
</div>`,
      "/transparencia",
    ),
  );
});

app.get("/como-funciona", (c) => {
  const l = lang(c);
  const es = l === "es";
  return c.html(
    plain(
      l,
      t(l, "how"),
      html`<h1>${t(l, "how")}</h1>
<div class="card"><ol>
${es
  ? html`<li>Dejás dólares (USDT) en garantía. Recibís pesos digitales de Ripio (wARS) en el mismo minuto, hasta el 60% de lo que dejás (te sugerimos 50%).</li>
<li>Pagás una tasa anual que depende del uso del fondo: 22% con el fondo libre, 36% con el 80% prestado. Hoy el banco cobra ${percent(REFS.bankLoan.bps, l)} (${REFS.bankLoan.source}).</li>
<li>Si querés, firmás una regla una vez y el agente cuida el préstamo: agrega tus dólares o paga con tus pesos cuando llega a riesgo, sin pasarse de tus límites. El contrato hace cumplir los límites, no nosotros.</li>
<li>Cuando pagás todo, tus dólares vuelven en la misma transacción. Cada préstamo pagado a tiempo baja tu tasa y sube tu límite la próxima vez.</li>
<li>Si el dólar baja mucho (tu préstamo pasa el 80% de lo que dejaste), se vende sólo la parte de tu garantía necesaria para volver al 78%, más 5%. El resto sigue siendo tuyo.</li>`
  : html`<li>You leave dollars (USDT) as a guarantee and receive Ripio digital pesos (wARS) in the same minute, up to 60% of what you leave (we suggest 50%).</li>
<li>You pay a yearly rate that follows pool use: 22% when idle, 36% at 80% lent. The bank charges ${percent(REFS.bankLoan.bps, l)} today (${REFS.bankLoan.source}).</li>
<li>If you want, you sign a rule once and the agent looks after the loan: it adds your dollars or repays with your pesos when the loan reaches risk, never beyond your limits. The contract enforces the limits, not us.</li>
<li>When you repay in full, your dollars come back in the same transaction. Each loan repaid on time lowers your rate and raises your limit next time.</li>
<li>If the dollar falls a lot (your loan passes 80% of what you left), only the part of the guarantee needed to get back to 78% is sold, plus 5%. The rest stays yours.</li>`}
</ol></div>
<h2>${es ? "Riesgos, en una línea cada uno" : "Risks, one line each"}</h2>
<div class="card small"><ul>
<li>${t(l, "borrowRisk")}</li>
<li>${t(l, "lendRisk")}</li>
<li>${es ? "Ripio puede pausar los pesos digitales; si pasa, tus dólares siguen siendo tuyos y el contrato tiene una salida para recuperarlos." : "Ripio can pause the digital pesos; if it does, your dollars stay yours and the contract has an exit to get them back."}</li>
<li>${es ? "El precio sale del fondo wARS/USDT de Uniswap en Celo (promedio de 30 minutos); el agente lo compara con Binance y dolarapi y pausa préstamos nuevos si no coinciden." : "The price comes from the Uniswap wARS/USDT pool on Celo (30-minute average); the agent compares it with Binance and dolarapi and pauses new loans if they disagree."}</li>
</ul></div>
<p><a href="${href(l, "/transparencia")}">${t(l, "transparency")}</a> · <a href="https://github.com/Jennycruzy/adelanto">GitHub</a></p>`,
      "/como-funciona",
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

app.post("/api/rule", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !isAddress(body.borrower) || typeof body.text !== "string") return json(c, { error: "bad request" }, 400);
  const r = await saveRule(getAddress(body.borrower), body.text);
  return json(c, { result: r }, r === "saved" ? 200 : 400);
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
  return json(c, { address: who, ...(await balancesOf(who)), loans });
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
- Rates and pool: GET /api/public/rates (free JSON), or read PesoPool.borrowRateBps(0), lenderRateBps(), cash(), totalDebt()
- A loan: GET /api/loan/<id>, or PesoPool.loans(id) and debtOf(id); its history is the pool's events for that id
- Attribution: every transaction since the event code carries ERC-8021 code celo_0e96c1ff3fa8 (evidence/attribution-audit.json)

## Source
https://github.com/Jennycruzy/adelanto
`);
});

const port = Number(process.env.PORT ?? 8795);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? "127.0.0.1" });
console.log(`web on http://${process.env.HOST ?? "127.0.0.1"}:${port}`);
