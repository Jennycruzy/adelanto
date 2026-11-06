// One plain sentence per agent action or refusal, in Spanish (rioplatense) and English. Numbers are formatted the
// way Argentines read them: "$ 1.234" for pesos, "US$ 12,50" for dollars.
import type { Decision } from "./guard.ts";
import { USDT_UNIT, WAD } from "./health.ts";

export function pesos(wars: bigint, lang: "es" | "en" = "es"): string {
  const whole = (wars + WAD / 2n) / WAD; // round to the nearest peso
  const n = Number(whole).toLocaleString(lang === "es" ? "es-AR" : "en-US", { maximumFractionDigits: 0 });
  return lang === "es" ? `$ ${n}` : `ARS ${n}`;
}

export function dollars(usdt: bigint, lang: "es" | "en" = "es"): string {
  const cents = (usdt + USDT_UNIT / 200n) / (USDT_UNIT / 100n); // round to the nearest cent
  const n = (Number(cents) / 100).toLocaleString(lang === "es" ? "es-AR" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return lang === "es" ? `US$ ${n}` : `US$${n}`;
}

export function percent(bps: bigint, lang: "es" | "en" = "es"): string {
  const n = (Number(bps) / 100).toLocaleString(lang === "es" ? "es-AR" : "en-US", { maximumFractionDigits: 1 });
  return `${n}%`;
}

/** Pesos per dollar from a PriceModule price (wARS, 18 decimals, per whole USDT). */
export function rate(price: bigint, lang: "es" | "en" = "es"): string {
  return pesos(price, lang);
}

export type Said = { es: string; en: string };

const ruleEs = (rule?: string) => (rule ? `Tu regla: «${rule}». ` : "");
const ruleEn = (rule?: string) => (rule ? `Your rule: "${rule}". ` : "");

/** The sentence logged with an agent action, quoting the rule it acted under. */
export function sayDecision(d: Decision, price: bigint, rule?: string): Said {
  switch (d.kind) {
    case "topUp":
      return {
        es: `${ruleEs(rule)}Agregué ${dollars(d.usdt)} a tu préstamo porque el dólar está a ${rate(price)} y tu préstamo llegó al ${percent(d.ltvBefore)}.${d.partial ? " Es lo máximo que permite tu regla hoy." : ""}`,
        en: `${ruleEn(rule)}I added ${dollars(d.usdt, "en")} to your loan because the dollar is at ${rate(price, "en")} and your loan reached ${percent(d.ltvBefore, "en")}.${d.partial ? " That is the most your rule allows today." : ""}`,
      };
    case "protectRepay":
      return {
        es: `${ruleEs(rule)}Pagué ${pesos(d.wars)} de tu préstamo con tus pesos porque el dólar está a ${rate(price)} y tu préstamo llegó al ${percent(d.ltvBefore)}.${d.partial ? " Es lo máximo que permite tu regla hoy." : ""}`,
        en: `${ruleEn(rule)}I repaid ${pesos(d.wars, "en")} of your loan from your pesos because the dollar is at ${rate(price, "en")} and your loan reached ${percent(d.ltvBefore, "en")}.${d.partial ? " That is the most your rule allows today." : ""}`,
      };
    case "autoRepay":
      return {
        es: `${ruleEs(rule)}Te entraron ${pesos(d.arrived)}; pagué ${pesos(d.wars)} de tu préstamo.`,
        en: `${ruleEn(rule)}${pesos(d.arrived, "en")} arrived; I repaid ${pesos(d.wars, "en")} of your loan.`,
      };
    case "liquidate":
      return d.partial
        ? {
            es: `Tu préstamo pasó el ${percent(d.ltvBefore)} con el dólar a ${rate(price)}. Pagué ${pesos(d.wars)} de tu deuda, todo lo que el agente tenía, y tomé esos dólares más 5%. Tu préstamo sigue arriba del 78%: agregá dólares o pagá una parte para que nadie más lo liquide.`,
            en: `Your loan passed ${percent(d.ltvBefore, "en")} with the dollar at ${rate(price, "en")}. I repaid ${pesos(d.wars, "en")} of your debt, all the agent had, and took that much in dollars plus 5%. Your loan is still above 78%: add dollars or repay part so nobody else liquidates it.`,
          }
        : {
            es: `Tu préstamo pasó el ${percent(d.ltvBefore)} con el dólar a ${rate(price)}. Pagué ${pesos(d.wars)} de tu deuda y tomé esos dólares más 5%, lo mínimo para volver al 78%. El resto de tus dólares sigue siendo tuyo.`,
            en: `Your loan passed ${percent(d.ltvBefore, "en")} with the dollar at ${rate(price, "en")}. I repaid ${pesos(d.wars, "en")} of your debt and took that much in dollars plus 5%, the least needed to get back to 78%. The rest of your dollars are still yours.`,
          };
    case "none":
      return sayRefusal(d, price);
  }
}

function sayRefusal(d: Extract<Decision, { kind: "none" }>, price: bigint): Said {
  const det = d.detail ?? {};
  switch (d.reason) {
    case "GUARD_LIMIT":
      return {
        es: "Tu límite diario para el agente ya se usó hoy. Te avisamos para que decidas.",
        en: "The agent's daily limit for your loan is used up today. We are telling you so you can decide.",
      };
    case "WALLET_LOW": {
      const need = typeof det.usdtNeeded === "bigint" ? det.usdtNeeded : 0n;
      return {
        es: `No tenés ${dollars(need)} en la billetera para cuidar el préstamo. Agregá dólares o pagá una parte.`,
        en: `You don't have ${dollars(need, "en")} in your wallet to protect the loan. Add dollars or repay part of it.`,
      };
    }
    case "GUARD_EXPIRED":
      return {
        es: "Los permisos del agente vencieron. Renovalos para que siga cuidando el préstamo.",
        en: "The agent's permissions have expired. Renew them so it keeps looking after the loan.",
      };
    case "PRICE_REFUSED":
      return {
        es: `El precio del dólar no está claro ahora (${rate(price)} en la pileta); no tocamos nada. Pagar y retirar funcionan igual.`,
        en: `The dollar price isn't clear right now (${rate(price, "en")} in the pool); we did nothing. Repaying and withdrawing still work.`,
      };
    case "KEEPER_LOW":
      return {
        es: "Tu préstamo pasó el 80% y el agente no tiene pesos para la liquidación suave; cualquiera puede liquidarlo. Agregá dólares o pagá una parte ya.",
        en: "Your loan passed 80% and the agent has no pesos for a gentle liquidation; anyone can liquidate it. Add dollars or repay part now.",
      };
    case "BUFFER":
      return {
        es: "Te entraron pesos, pero quedarías con menos de lo que pediste guardar; no pagué nada.",
        en: "Pesos arrived, but paying would leave less than you asked to keep; I paid nothing.",
      };
    default:
      return { es: "", en: "" }; // quiet outcomes (not at risk, no guard, nothing arrived) are not shown to people
  }
}
