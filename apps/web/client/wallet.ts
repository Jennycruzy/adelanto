// Wallet actions for the pages. Runs in MiniPay (connects on load) or any Celo wallet. Every transaction:
// - goes only to the contract addresses the server published for this page (from the deploy record);
// - carries the ERC-8021 attribution suffix;
// - is checked against balances before the wallet is asked to sign, and its receipt is checked after.
import { toDataSuffix } from "@celo/attribution-tags";
import {
  concatHex,
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  parseEventLogs,
  parseSignature,
  parseUnits,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { celo } from "viem/chains";
import { permitTypedData } from "./permit.ts";
import { PRESETS, ruleSentence, type RuleInput } from "./rule.ts";

type Cfg = { code: string; pool: Address; guard: Address; usdt: Address; wars: Address; rpc: string };
const cfg: Cfg = JSON.parse(document.getElementById("adelanto-cfg")!.textContent!);
const pub = createPublicClient({ chain: celo, transport: http(cfg.rpc) });
const eth = (window as any).ethereum;

const poolAbi = parseAbi([
  "function borrow(uint256 collateral, uint256 pesos, uint16 termDays, uint256 maxRateBps) returns (uint256)",
  "function borrowWithPermit(uint256 collateral, uint256 pesos, uint16 termDays, uint256 maxRateBps, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256)",
  "function repayWithPermit(uint256 loanId, uint256 pesos, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256)",
  "function repay(uint256 loanId, uint256 pesos) returns (uint256)",
  "function repayWithSwap(uint256 loanId, uint256 usdtIn, uint256 minPesosOut) returns (uint256)",
  "function addCollateral(uint256 loanId, uint256 amount)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address holder) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address holder) returns (uint256)",
  "function maxWithdraw(address holder) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function debtOf(uint256 loanId) view returns (uint256)",
  "event Borrowed(uint256 indexed loanId, address indexed borrower, uint256 collateral, uint256 pesos, uint256 fee, uint16 termDays, uint8 tier, uint256 price, uint256 rateBps)",
]);
const permitAbi = parseAbi(["function nonces(address owner) view returns (uint256)"]);

// --------------------------------------------------------------------------- words
const W = {
  es: {
    noWallet: "Abrí esta página en MiniPay o en una billetera de Celo.",
    wrongChain: "Cambiá tu billetera a la red Celo.",
    sign: "Firmá en tu billetera el uso exacto de tus dólares…",
    signPesos: "Firmá en tu billetera el uso exacto de tus pesos…",
    confirm: "Confirmá en tu billetera…",
    approve: "Primero autorizá el monto exacto en tu billetera…",
    waiting: "Esperando la confirmación de la red…",
    done: "Listo.",
    failed: "No se hizo nada: ",
    rejected: "Lo cancelaste; no se hizo nada.",
    lowUsdt: (need: string, have: string) => `Necesitás ${need} en tu billetera; tenés ${have}.`,
    lowWars: (need: string, have: string) => `Necesitás ${need} en tu billetera para pagar; tenés ${have}.`,
    howMuchPesos: "¿Cuántos pesos querés pagar?",
    howMuchDollars: "¿Cuántos dólares querés agregar?",
    amount: "Escribí un monto.",
    amountAbove: "Escribí el monto arriba de los botones.",
    orDollars: (usd: string) => `Tampoco alcanzan tus dólares sueltos para cubrir la diferencia (hacen falta ${usd}).`,
    gap: (pesos: string, usd: string) => `Te faltan ${pesos}: los cubrimos con ${usd} de tus dólares sueltos…`,
    none: "No tenés pesos depositados.",
    mine: (dep: string, wars: string) => `Tu depósito: ${dep}. Pesos en tu billetera: ${wars} (MiniPay no los muestra en su saldo).`,
  },
  en: {
    noWallet: "Open this page in MiniPay or a Celo wallet.",
    wrongChain: "Switch your wallet to the Celo network.",
    sign: "Sign the exact use of your dollars in your wallet…",
    signPesos: "Sign the exact use of your pesos in your wallet…",
    confirm: "Confirm in your wallet…",
    approve: "First approve the exact amount in your wallet…",
    waiting: "Waiting for the network…",
    done: "Done.",
    failed: "Nothing happened: ",
    rejected: "You cancelled; nothing happened.",
    lowUsdt: (need: string, have: string) => `You need ${need} in your wallet; you have ${have}.`,
    lowWars: (need: string, have: string) => `You need ${need} in your wallet to repay; you have ${have}.`,
    howMuchPesos: "How many pesos do you want to repay?",
    howMuchDollars: "How many dollars do you want to add?",
    amount: "Enter an amount.",
    amountAbove: "Enter the amount above the buttons.",
    orDollars: (usd: string) => `Your spare dollars do not cover the gap either (${usd} needed).`,
    gap: (pesos: string, usd: string) => `You are ${pesos} short: covering it with ${usd} of your spare dollars…`,
    none: "You have no pesos deposited.",
    mine: (dep: string, wars: string) => `Your deposit: ${dep}. Pesos in your wallet: ${wars} (MiniPay does not show them in its balance).`,
  },
};
const lang = (document.documentElement.lang === "en" ? "en" : "es") as "es" | "en";
const w = W[lang];
const fmtPesos = (x: bigint) => `$ ${Number(x / 10n ** 18n).toLocaleString(lang === "es" ? "es-AR" : "en-US")}`;
const fmtUsd = (x: bigint) => `US$ ${(Number(x) / 1e6).toLocaleString(lang === "es" ? "es-AR" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function status(text: string, kind: "" | "ok" | "bad" = "") {
  document.querySelectorAll<HTMLElement>("#status").forEach((el) => {
    el.textContent = text;
    el.className = kind;
  });
}

// --------------------------------------------------------------------------- wallet
let account: Address | null = null;

async function connect(): Promise<Address> {
  if (!eth) throw new Error(w.noWallet);
  if (account) return account;
  const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error(w.noWallet);
  const chainId = await eth.request({ method: "eth_chainId" });
  if (Number(chainId) !== 42220) {
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa4ec" }] });
    } catch {
      throw new Error(w.wrongChain);
    }
  }
  account = accounts[0] as Address;
  return account;
}

function tagged(data: Hex): Hex {
  return concatHex([data, toDataSuffix(cfg.code) as Hex]);
}

const ALLOWED = () => new Set([cfg.pool, cfg.guard, cfg.usdt, cfg.wars].map((a) => a.toLowerCase()));

/** One transaction: only to our published contracts, tagged, and its receipt checked. */
async function send(to: Address, data: Hex) {
  if (!ALLOWED().has(to.toLowerCase())) throw new Error("unexpected destination");
  const from = await connect();
  const input = tagged(data);
  // Our own gas limit, with room: a wallet's estimate runs against the last block, where the pool's interest is
  // already brought up to date, but the transaction lands in the next one and pays for that update again (seen as
  // an out-of-gas close right after a swap). The extra 80k also covers paying the network fee in a stablecoin
  // (MiniPay). Only the gas actually used is charged. An estimate that reverts stops here, before any signature.
  const est = await pub.estimateGas({ account: from, to, data: input });
  const gas = (est * 125n) / 100n + 80_000n;
  status(w.confirm);
  const hash: Hex = await eth.request({ method: "eth_sendTransaction", params: [{ from, to, data: input, gas: `0x${gas.toString(16)}` }] });
  status(w.waiting);
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error(`reverted ${hash}`);
  return receipt;
}

async function signPermit(token: Address, name: string, owner: Address, spender: Address, value: bigint) {
  // A wallet with code (a smart account, or an EIP-7702 delegation) is checked by the tokens as a contract signer,
  // and an ordinary signature fails there: use the exact-approval path for it instead.
  const code = await pub.getCode({ address: owner });
  if (code && code !== "0x") throw new Error("wallet has code: use approval");
  const nonce = await pub.readContract({ address: token, abi: permitAbi, functionName: "nonces", args: [owner] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const typed = permitTypedData(token, name, owner, spender, value, nonce, deadline);
  const sig: Hex = await eth.request({ method: "eth_signTypedData_v4", params: [owner, JSON.stringify(typed)] });
  const { r, s, v, yParity } = parseSignature(sig);
  return { deadline, r, s, v: Number(v ?? BigInt(27 + (yParity ?? 0))) };
}

const balance = (token: Address, who: Address) => pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

async function approveExact(token: Address, spender: Address, amount: bigint) {
  const owner = await connect();
  const current = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });
  if (current >= amount) return;
  status(w.approve);
  await send(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }));
}

// --------------------------------------------------------------------------- actions
async function borrow(el: HTMLElement) {
  const me = await connect();
  const pesos = BigInt(el.dataset.pesos!);
  const collateral = BigInt(el.dataset.collateral!);
  const days = Number(el.dataset.days);
  const maxRate = BigInt(el.dataset.maxrate!);
  const have = await balance(cfg.usdt, me);
  if (have < collateral) throw new Error(w.lowUsdt(fmtUsd(collateral), fmtUsd(have)));
  let receipt;
  status(w.sign);
  const p = await signPermit(cfg.usdt, "Tether USD", me, cfg.pool, collateral).catch((e) => {
    if (isRejection(e)) throw e;
    return null; // this wallet can't sign a permit: fall back to an exact approval (one more tap)
  });
  if (p) {
    receipt = await send(cfg.pool, encodeFunctionData({ abi: poolAbi, functionName: "borrowWithPermit", args: [collateral, pesos, days, maxRate, p.deadline, p.v, p.r, p.s] }));
  } else {
    await approveExact(cfg.usdt, cfg.pool, collateral);
    receipt = await send(cfg.pool, encodeFunctionData({ abi: poolAbi, functionName: "borrow", args: [collateral, pesos, days, maxRate] }));
  }
  const ev = parseEventLogs({ abi: poolAbi, logs: receipt.logs, eventName: "Borrowed" })[0];
  status(w.done, "ok");
  if (ev) location.href = `/prestamo/${ev.args.loanId}${lang === "en" ? "?lang=en" : ""}`;
}

async function repay(loanId: bigint, pesos: bigint) {
  const me = await connect();
  const have = await balance(cfg.wars, me);
  if (have < pesos) throw new Error(w.lowWars(fmtPesos(pesos), fmtPesos(have)));
  status(w.signPesos);
  const p = await signPermit(cfg.wars, "Peso Argentino", me, cfg.pool, pesos).catch((e) => {
    if (isRejection(e)) throw e;
    return null;
  });
  if (p) {
    await send(cfg.pool, encodeFunctionData({ abi: poolAbi, functionName: "repayWithPermit", args: [loanId, pesos, p.deadline, p.v, p.r, p.s] }));
  } else {
    await approveExact(cfg.wars, cfg.pool, pesos);
    await send(cfg.pool, encodeFunctionData({ abi: poolAbi, functionName: "repay", args: [loanId, pesos] }));
  }
  status(w.done, "ok");
  setTimeout(() => location.reload(), 1200);
}

async function repayAll(el: HTMLElement) {
  const me = await connect();
  const loanId = BigInt(el.dataset.loan!);
  const debt = await pub.readContract({ address: cfg.pool, abi: poolAbi, functionName: "debtOf", args: [loanId] });
  // Interest grows by the second; allow 0.1% more. The pool takes only what is owed.
  const need = debt + debt / 1000n + 1n;
  const have = await balance(cfg.wars, me);
  if (have >= need) return repay(loanId, need);
  // The loan pays out pesos minus the opening fee and owes pesos plus interest, so a borrower who only holds the
  // borrowed pesos is a few pesos short. Cover the gap from the wallet's spare dollars: the pool swaps them for pesos
  // in the same transaction it repays, and sends back any pesos beyond the debt.
  const gap = need - have;
  const rates = await fetch("/api/public/rates").then((x) => x.json());
  const spot = BigInt(rates.pesosPerDollar.spot); // pesos (18 decimals) per 1 USDT
  const usdtIn = (gap * 10n ** 6n * 103n) / (spot * 100n) + 1n; // 3% for price movement and the pool fee
  const usdt = await balance(cfg.usdt, me);
  if (usdt < usdtIn) throw new Error(w.lowWars(fmtPesos(need), fmtPesos(have)) + " " + w.orDollars(fmtUsd(usdtIn)));
  status(w.gap(fmtPesos(gap), fmtUsd(usdtIn)));
  await approveExact(cfg.usdt, cfg.pool, usdtIn);
  await send(cfg.pool, encodeFunctionData({ abi: poolAbi, functionName: "repayWithSwap", args: [loanId, usdtIn, gap] }));
  if (have === 0n) {
    status(w.done, "ok");
    setTimeout(() => location.reload(), 1200);
    return;
  }
  await repay(loanId, have);
}

function loanAmount(): string {
  const v = (document.getElementById("loan-amount") as HTMLInputElement | null)?.value ?? "";
  if (!v.trim()) throw new Error(w.amountAbove);
  return v;
}

async function repayPart(el: HTMLElement) {
  const n = loanAmount().replace(/[^0-9]/g, "");
  if (!n) throw new Error(w.amount);
  await repay(BigInt(el.dataset.loan!), BigInt(n) * 10n ** 18n);
}

async function addCollateral(el: HTMLElement) {
  const v = loanAmount();
  const amount = parseUnits(v.replace(",", ".").replace(/[^0-9.]/g, "") || "0", 6);
  if (amount === 0n) throw new Error(w.amount);
  const me = await connect();
  const have = await balance(cfg.usdt, me);
  if (have < amount) throw new Error(w.lowUsdt(fmtUsd(amount), fmtUsd(have)));
  await approveExact(cfg.usdt, cfg.pool, amount);
  await send(cfg.pool, encodeFunctionData({ abi: poolAbi, functionName: "addCollateral", args: [BigInt(el.dataset.loan!), amount] }));
  status(w.done, "ok");
  setTimeout(() => location.reload(), 1200);
}

function amountInput(): bigint {
  const el = document.getElementById("amount") as HTMLInputElement | null;
  const n = (el?.value ?? "").replace(/[^0-9]/g, "");
  if (!n) throw new Error(w.amount);
  return BigInt(n) * 10n ** 18n;
}

async function deposit() {
  const me = await connect();
  const amount = amountInput();
  const have = await balance(cfg.wars, me);
  if (have < amount) throw new Error(w.lowWars(fmtPesos(amount), fmtPesos(have)));
  await approveExact(cfg.wars, cfg.pool, amount);
  await send(cfg.pool, encodeFunctionData({ abi: poolAbi, functionName: "deposit", args: [amount, me] }));
  status(w.done, "ok");
  await showMine();
}

async function withdraw() {
  const me = await connect();
  const max = await pub.readContract({ address: cfg.pool, abi: poolAbi, functionName: "maxWithdraw", args: [me] });
  if (max === 0n) throw new Error(w.none);
  const el = document.getElementById("amount") as HTMLInputElement | null;
  if (!el?.value) {
    // empty amount: take out everything that can be taken out now
    const shares = await pub.readContract({ address: cfg.pool, abi: poolAbi, functionName: "balanceOf", args: [me] });
    await send(cfg.pool, encodeFunctionData({ abi: poolAbi, functionName: "redeem", args: [shares, me, me] }));
  } else {
    const amount = amountInput();
    await send(cfg.pool, encodeFunctionData({ abi: poolAbi, functionName: "withdraw", args: [amount > max ? max : amount, me, me] }));
  }
  status(w.done, "ok");
  await showMine();
}

async function showMine() {
  const el = document.getElementById("mine");
  if (!el || !account) return;
  const r = await fetch(`/api/me/${account}`).then((x) => x.json());
  el.textContent = w.mine(fmtPesos(BigInt(r.deposit)), fmtPesos(BigInt(r.wars)));
}

// --------------------------------------------------------------------------- the guard
const guardAbi = parseAbi([
  "function setLimits((bool autoRepay,bool rateWatch,uint8 protectOrder,uint64 expiry,uint128 keepWarsBuffer,uint128 maxRepayWarsPerDay,uint128 maxTopUpUsdtPerDay,uint32 maxRateBps) l, bytes32 ruleHash)",
  "function revoke()",
]);
type Parsed = { autoRepay: boolean; rateWatch: boolean; protectOrder: number; expiry: bigint; keepWarsBuffer: bigint; maxRepayWarsPerDay: bigint; maxTopUpUsdtPerDay: bigint; maxRateBps: number };
let pending: { rule?: RuleInput; parsed?: Parsed; revoke?: boolean; words: string; debt: bigint } | null = null;

// The rule in the borrower's own words: the server turns it into limits (or one question); the exact words are hashed.
async function parseWords(el: HTMLElement) {
  const box = document.getElementById("rule-text") as HTMLTextAreaElement | null;
  const words = (box?.value ?? "").trim();
  const q = document.getElementById("rule-question")!;
  q.hidden = true;
  if (!words) return status(el.dataset.lang === "en" ? "Write your rule first." : "Escribí tu regla primero.", "bad");
  const r = await fetch("/api/parse-rule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loanId: el.dataset.loan, text: words, lang: el.dataset.lang }) }).then((x) => x.json());
  const en = el.dataset.lang === "en";
  if (r.kind === "question") {
    q.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = en ? r.question.en : r.question.es;
    q.append(p);
    for (const o of r.question.options) {
      const b = document.createElement("button");
      b.className = "btn ghost";
      b.style.margin = "4px 6px 4px 0";
      b.textContent = o.label;
      b.addEventListener("click", () => {
        box!.value = (box!.value.trim() + o.append).trim();
        void parseWords(el).catch((e) => status(String(e?.message ?? e), "bad"));
      });
      q.append(b);
    }
    q.hidden = false;
    return;
  }
  if (r.kind === "unknown") return status(en ? r.en : r.es, "bad");
  const L = r.kind === "limits" ? r.limits : null;
  pending = {
    words,
    debt: BigInt(el.dataset.debt!),
    revoke: r.kind === "revoke",
    parsed: L ? { ...L, expiry: BigInt(L.expiry), keepWarsBuffer: BigInt(L.keepWarsBuffer), maxRepayWarsPerDay: BigInt(L.maxRepayWarsPerDay), maxTopUpUsdtPerDay: BigInt(L.maxTopUpUsdtPerDay) } : undefined,
  };
  const rb = document.getElementById("readback");
  const pw = document.getElementById("rule-words");
  const pr = document.getElementById("rule-readback");
  if (rb && pw && pr) {
    pw.textContent = `«${words}»`;
    pr.textContent = en ? r.readback.en : r.readback.es;
    pr.hidden = false;
    rb.hidden = false;
    rb.scrollIntoView({ behavior: "smooth" });
  }
}

// Voice: the browser's own Spanish (Argentina) dictation, where the browser has it; the button stays hidden otherwise.
const Speech = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
if (Speech) document.querySelectorAll<HTMLElement>('[data-action="dictate"]').forEach((b) => (b.hidden = false));
async function dictate(el: HTMLElement) {
  const rec = new Speech();
  rec.lang = el.dataset.lang === "en" ? "en-US" : "es-AR";
  rec.interimResults = false;
  rec.onresult = (e: any) => {
    const box = document.getElementById("rule-text") as HTMLTextAreaElement;
    box.value = (box.value + " " + e.results[0][0].transcript).trim();
  };
  rec.onerror = () => status(el.dataset.lang === "en" ? "Could not hear you; type it instead." : "No te escuché; escribila.", "bad");
  rec.start();
  status(el.dataset.lang === "en" ? "Listening…" : "Te escucho…");
}

function showRule(rule: RuleInput, debt: bigint) {
  const words = ruleSentence(rule);
  pending = { rule, words, debt };
  const rr = document.getElementById("rule-readback");
  if (rr) rr.hidden = true;
  const box = document.getElementById("readback");
  const p = document.getElementById("rule-words");
  if (box && p) {
    p.textContent = `«${words}»`;
    box.hidden = false;
    box.scrollIntoView({ behavior: "smooth" });
  }
}

async function preset(el: HTMLElement) {
  const p = PRESETS.find((x) => x.id === el.dataset.preset);
  if (!p) return;
  showRule(p.rule, BigInt(el.dataset.debt!));
}

async function customGuard(el: HTMLElement) {
  const num = (id: string) => Number(((document.getElementById(id) as HTMLInputElement)?.value ?? "0").replace(/\./g, "").replace(",", ".")) || 0;
  const checked = (id: string) => !!(document.getElementById(id) as HTMLInputElement)?.checked;
  showRule({ topUpUsdPerDay: num("g-usd"), repayPesosPerDay: num("g-pesos"), autoRepay: checked("g-auto"), keepPesos: num("g-keep"), rateWatch: checked("g-rate"), days: 90 }, BigInt(el.dataset.debt!));
}

async function signGuard() {
  if (!pending) return;
  const me = await connect();
  if (pending.revoke) return revokeGuard();
  if (pending.parsed) return signParsed(me, pending.parsed, pending.words, pending.debt);
  const { words, debt } = pending;
  const rule = pending.rule!;
  const usdtPerDay = parseUnits(rule.topUpUsdPerDay.toFixed(6), 6);
  const warsPerDay = BigInt(Math.round(rule.repayPesosPerDay)) * 10n ** 18n;
  const block = await pub.getBlock();
  const days = Math.min(Math.max(1, rule.days), 179);
  const limits = {
    autoRepay: rule.autoRepay && warsPerDay > 0n,
    rateWatch: rule.rateWatch,
    protectOrder: usdtPerDay > 0n ? 0 : 1,
    expiry: block.timestamp + BigInt(days) * 86_400n,
    keepWarsBuffer: BigInt(Math.round(rule.keepPesos)) * 10n ** 18n,
    maxRepayWarsPerDay: warsPerDay,
    maxTopUpUsdtPerDay: usdtPerDay,
    maxRateBps: 0,
  };
  // Allowances to the guard: a week of the daily limits, and never more pesos than twice what is owed.
  if (usdtPerDay > 0n) await approveExact(cfg.usdt, cfg.guard, usdtPerDay * 7n);
  if (warsPerDay > 0n) {
    const week = warsPerDay * 7n;
    await approveExact(cfg.wars, cfg.guard, week < debt * 2n ? week : debt * 2n);
  }
  await send(cfg.guard, encodeFunctionData({ abi: guardAbi, functionName: "setLimits", args: [limits, keccak256(toBytes(words))] }));
  await fetch("/api/rule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ borrower: me, text: words }) });
  status(w.done, "ok");
  setTimeout(() => location.reload(), 1200);
}

async function signParsed(me: Address, limits: Parsed, words: string, debt: bigint) {
  // Same allowances as the form: a week of the daily limits, and never more pesos than twice what is owed.
  if (limits.maxTopUpUsdtPerDay > 0n) await approveExact(cfg.usdt, cfg.guard, limits.maxTopUpUsdtPerDay * 7n);
  if (limits.maxRepayWarsPerDay > 0n) {
    const week = limits.maxRepayWarsPerDay * 7n;
    await approveExact(cfg.wars, cfg.guard, week < debt * 2n ? week : debt * 2n);
  }
  await send(cfg.guard, encodeFunctionData({ abi: guardAbi, functionName: "setLimits", args: [limits, keccak256(toBytes(words))] }));
  await fetch("/api/rule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ borrower: me, text: words }) });
  status(w.done, "ok");
  setTimeout(() => location.reload(), 1200);
}

async function revokeGuard() {
  await send(cfg.guard, encodeFunctionData({ abi: guardAbi, functionName: "revoke" }));
  // Take back the allowances too, so nothing is left behind.
  const me = await connect();
  for (const token of [cfg.usdt, cfg.wars]) {
    const a = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [me, cfg.guard] });
    if (a > 0n) await send(token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [cfg.guard, 0n] }));
  }
  status(w.done, "ok");
  setTimeout(() => location.reload(), 1200);
}

function isRejection(e: any) {
  return e?.code === 4001 || /rejected|denied|cancel/i.test(String(e?.message ?? e));
}

// Mi historial: the record is public, so the wallet is only used to know which address to show.
async function myRecord(el: HTMLElement) {
  const me = await connect();
  location.href = `/historial?w=${me}${el.dataset.lang === "en" ? "&lang=en" : ""}`;
}

const ACTIONS: Record<string, (el: HTMLElement) => Promise<void>> = {
  myRecord,
  borrow,
  repayAll,
  repayPart,
  addCollateral,
  deposit: () => deposit(),
  withdraw: () => withdraw(),
  preset,
  customGuard,
  parseWords,
  dictate,
  signGuard: () => signGuard(),
  revokeGuard: () => revokeGuard(),
};

document.addEventListener("click", async (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!el) return;
  const fn = ACTIONS[el.dataset.action!];
  if (!fn) return;
  ev.preventDefault();
  const buttons = document.querySelectorAll<HTMLButtonElement>("button[data-action]");
  buttons.forEach((b) => (b.disabled = true));
  try {
    await fn(el);
  } catch (e: any) {
    status(isRejection(e) ? w.rejected : w.failed + String(e?.shortMessage ?? e?.message ?? e).slice(0, 160), "bad");
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
});

// MiniPay connects on load, without a button.
if (eth?.isMiniPay) {
  if (location.pathname === "/historial" && !new URLSearchParams(location.search).get("w")) {
    connect().then((me) => (location.href = `/historial?w=${me}${location.search.includes("lang=en") ? "&lang=en" : ""}`)).catch(() => {});
  } else connect().then(showMine).catch(() => {});
}
else if (eth) eth.request({ method: "eth_accounts" }).then((a: string[]) => { if (a?.[0]) { account = a[0] as Address; showMine(); } }).catch(() => {});
