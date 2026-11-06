// A6 Keep people informed: term reminders, health changes and low pool liquidity, in Spanish and English.
// Each notice has a stable key, so it is written once however many ticks see the same condition.
import { type Address, type PublicClient } from "viem";
import { poolAbi } from "@adelanto/chain";
import { MIN_LOAN, band, ltvBps, pesos, priceAtLtv, rate, type Band, type LoanState } from "@adelanto/core";
import { getMeta, setMeta, type Db } from "./db.ts";

export type Notice = { key: string; kind: string; said: { es: string; en: string } };

const DAY = 86_400n;
const GRACE = 7n * DAY; // PesoPool.GRACE

function date(sec: bigint, lang: "es" | "en") {
  return new Date(Number(sec) * 1000).toLocaleDateString(lang === "es" ? "es-AR" : "en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "numeric",
    month: "long",
  });
}

const BAND_WORDS: Record<Band, { es: string; en: string }> = {
  tranquilo: { es: "Tranquilo", en: "Calm" },
  atencion: { es: "Atención", en: "Watch" },
  riesgo: { es: "Riesgo", en: "At risk" },
  liquidable: { es: "Se puede liquidar", en: "Can be liquidated" },
};
const ORDER: Band[] = ["tranquilo", "atencion", "riesgo", "liquidable"];

export function loanNotices(loan: LoanState, price: bigint, now: bigint, db: Db): Notice[] {
  const out: Notice[] = [];
  const id = loan.id;
  if (loan.dueAt > now && loan.dueAt - now <= 3n * DAY) {
    out.push({
      key: `${id}:due_soon`,
      kind: "due_soon",
      said: {
        es: `Tu préstamo vence el ${date(loan.dueAt, "es")}. Debés ${pesos(loan.debt)}. Después de esa fecha la tasa sube 5 puntos.`,
        en: `Your loan is due on ${date(loan.dueAt, "en")}. You owe ${pesos(loan.debt, "en")}. After that the rate rises 5 points.`,
      },
    });
  }
  if (now >= loan.dueAt && now < loan.dueAt + GRACE) {
    out.push({
      key: `${id}:due`,
      kind: "due",
      said: {
        es: `Tu préstamo venció hoy; ahora paga 5 puntos más. Si lo pagás antes del ${date(loan.dueAt + GRACE, "es")} sigue contando como pago a tiempo.`,
        en: `Your loan is due today and now pays 5 points more. Repay before ${date(loan.dueAt + GRACE, "en")} and it still counts as on time.`,
      },
    });
  }
  if (now >= loan.dueAt + GRACE) {
    out.push({
      key: `${id}:late`,
      kind: "late",
      said: {
        es: `Tu préstamo está atrasado. Debés ${pesos(loan.debt)}; queda registrado como pago tarde en tu historial.`,
        en: `Your loan is late. You owe ${pesos(loan.debt, "en")}; it will show as a late repayment in your record.`,
      },
    });
  }
  // Health: tell people when it gets worse (and once when it is calm again).
  const now_ = band(ltvBps(loan.debt, loan.collateral, price));
  const prev = (getMeta(db, `band:${id}`) as Band | undefined) ?? "tranquilo";
  if (now_ !== prev) {
    setMeta(db, `band:${id}`, now_);
    const worse = ORDER.indexOf(now_) > ORDER.indexOf(prev);
    const riskAt = priceAtLtv(loan.debt, loan.collateral, 7_000n);
    const words = BAND_WORDS[now_];
    out.push({
      key: `${id}:band:${now_}:${now}`,
      kind: "health",
      said: worse
        ? {
            es: `Tu préstamo pasó a «${words.es}»: el dólar está a ${rate(price)}. Llega a riesgo con el dólar a ${rate(riskAt)}.`,
            en: `Your loan moved to "${words.en}": the dollar is at ${rate(price, "en")}. It reaches risk with the dollar at ${rate(riskAt, "en")}.`,
          }
        : {
            es: `Tu préstamo volvió a «${words.es}» con el dólar a ${rate(price)}.`,
            en: `Your loan is back to "${words.en}" with the dollar at ${rate(price, "en")}.`,
          },
    });
  }
  return out;
}

export async function poolNotices(pub: PublicClient, a: { pool: Address }, db: Db): Promise<Notice[]> {
  const cash = await pub.readContract({ address: a.pool, abi: poolAbi, functionName: "cash" });
  const low = cash < 2n * MIN_LOAN;
  const was = getMeta(db, "poolLow") === "1";
  if (low === was) return [];
  setMeta(db, "poolLow", low ? "1" : "0");
  const day = new Date().toISOString().slice(0, 10);
  return [
    low
      ? {
          key: `pool_low:${day}`,
          kind: "pool_low",
          said: {
            es: `El fondo tiene ${pesos(cash)} libres. Se pueden pedir préstamos hasta eso; los pagos liberan más.`,
            en: `The pool has ${pesos(cash, "en")} free. Loans up to that are possible; repayments free up more.`,
          },
        }
      : {
          key: `pool_ok:${day}`,
          kind: "pool_ok",
          said: { es: `El fondo vuelve a tener ${pesos(cash)} libres.`, en: `The pool has ${pesos(cash, "en")} free again.` },
        },
  ];
}
