// Off-chain price sources and the cross-check that decides when the guardian pauses new borrowing (A4).
// Prices here are plain numbers in pesos per dollar; the chain's price arrives as wARS (18 decimals) per USDT.

export type Quote = { source: "binance" | "dolarapi"; pesosPerDollar: number; fetchedAt: number; raw: unknown };

const TIMEOUT_MS = 8_000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Binance USDT/ARS last trade price. */
export async function binance(): Promise<Quote> {
  const raw = (await getJson("https://api.binance.com/api/v3/ticker/price?symbol=USDTARS")) as { price?: string };
  const v = Number(raw.price);
  if (!Number.isFinite(v) || v <= 0) throw new Error("binance: no price");
  return { source: "binance", pesosPerDollar: v, fetchedAt: Date.now(), raw };
}

/** dolarapi.com crypto dollar: the midpoint of buy and sell. */
export async function dolarapi(): Promise<Quote> {
  const raw = (await getJson("https://dolarapi.com/v1/dolares/cripto")) as { compra?: number; venta?: number };
  const buy = Number(raw.compra);
  const sell = Number(raw.venta);
  if (!(buy > 0) || !(sell > 0)) throw new Error("dolarapi: no price");
  return { source: "dolarapi", pesosPerDollar: (buy + sell) / 2, fetchedAt: Date.now(), raw };
}

/** Fetches both; a failed source is reported, not thrown. */
export async function offChainQuotes(): Promise<{ quotes: Quote[]; failed: { source: string; error: string }[] }> {
  const results = await Promise.allSettled([binance(), dolarapi()]);
  const quotes: Quote[] = [];
  const failed: { source: string; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") quotes.push(r.value);
    else failed.push({ source: i === 0 ? "binance" : "dolarapi", error: String(r.reason?.message ?? r.reason) });
  });
  return { quotes, failed };
}

export const PAUSE_GAP = 0.015; // 1.5%
export const PAUSE_AFTER_MS = 3 * 60_000; // for 3 minutes
export const RESUME_GAP = 0.01; // back within 1%
export const RESUME_AFTER_MS = 10 * 60_000; // for 10 minutes
export const SOURCES_DOWN_PAUSE_MS = 10 * 60_000; // both off-chain sources down for 10 minutes

export type Reading = { at: number; chain: number; quotes: Quote[] };

/** Gap of the chain price from one quote, as a fraction (0.015 = 1.5%). */
export function gap(chain: number, q: Quote): number {
  return Math.abs(chain - q.pesosPerDollar) / q.pesosPerDollar;
}

/**
 * True when the chain price disagrees with every off-chain source that answered, by more than `limit`.
 * Requiring every source keeps one bad feed from pausing anything.
 */
export function disagrees(r: Reading, limit = PAUSE_GAP): boolean {
  return r.quotes.length > 0 && r.quotes.every((q) => gap(r.chain, q) > limit);
}

/** True when the chain price agrees with at least one source within `limit`. */
export function agrees(r: Reading, limit = RESUME_GAP): boolean {
  return r.quotes.some((q) => gap(r.chain, q) <= limit);
}

export type Verdict = { action: "pause" | "resume" | "hold"; why: string };

/**
 * Given readings ordered oldest first and whether borrowing is paused by us, decide. Pause needs disagreement in
 * every reading across the last 3 minutes (or both sources down for 10); resume needs agreement in every reading
 * across the last 10 minutes and only undoes a pause this agent made.
 */
export function verdict(readings: Reading[], now: number, pausedByUs: boolean, pausedByAnyone: boolean): Verdict {
  const since = (ms: number) => readings.filter((r) => r.at >= now - ms);
  const covers = (rs: Reading[], ms: number) => rs.length > 0 && rs[0].at <= now - ms + 90_000; // window is filled

  if (!pausedByAnyone) {
    const recent = since(PAUSE_AFTER_MS);
    if (covers(recent, PAUSE_AFTER_MS) && recent.length >= 3 && recent.every((r) => disagrees(r))) {
      const last = recent[recent.length - 1];
      const gaps = last.quotes.map((q) => `${q.source} ${(gap(last.chain, q) * 100).toFixed(2)}%`).join(", ");
      return { action: "pause", why: `chain ${last.chain.toFixed(2)} vs ${gaps} for 3 minutes` };
    }
    const window = since(SOURCES_DOWN_PAUSE_MS);
    if (covers(window, SOURCES_DOWN_PAUSE_MS) && window.length >= 5 && window.every((r) => r.quotes.length === 0)) {
      return { action: "pause", why: "Binance and dolarapi both unreachable for 10 minutes" };
    }
    return { action: "hold", why: "prices agree" };
  }
  if (pausedByUs) {
    const recent = since(RESUME_AFTER_MS);
    if (covers(recent, RESUME_AFTER_MS) && recent.length >= 5 && recent.every((r) => agrees(r))) {
      return { action: "resume", why: "chain price back within 1% of an outside source for 10 minutes" };
    }
  }
  return { action: "hold", why: pausedByUs ? "still disagreeing" : "paused by someone else; left alone" };
}

/** wARS (18 decimals) per USDT, as a float for comparison with off-chain quotes. */
export function chainToNumber(price: bigint): number {
  return Number(price / 10n ** 12n) / 1e6;
}
