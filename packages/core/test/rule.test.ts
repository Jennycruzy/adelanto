import { describe, expect, it } from "vitest";
import { parseRule, normalize, type Parsed } from "../src/rule.ts";
import type { Limits } from "../src/guard.ts";

const WAD = 10n ** 18n;
const NOW = 1_794_053_073n;
const loan = { debt: 1_000n * WAD, collateral: 1_300_000n, dueAt: NOW + 7n * 86_400n, maxRateBps: 4000 };
const big = { debt: 500_000n * WAD, collateral: 400_000_000n, dueAt: NOW + 30n * 86_400n, maxRateBps: 4000 };

const lim = (p: Parsed): Limits => {
  if (p.kind !== "limits") throw new Error(`expected limits, got ${p.kind}: ${JSON.stringify(p, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
  return p.limits;
};
const usd = (x: number) => BigInt(Math.round(x * 100)) * 10_000n;

describe("normalize", () => {
  it("unifies dollar words, accents and thousand dots", () => {
    expect(normalize("Pagá U$S 20 y dejame $ 50.000")).toContain("usd 20");
    expect(normalize("dejame $ 50.000")).toContain("50000");
    expect(normalize("US$ 2,50")).toContain("2.50");
  });
});

// [text, expected fields] — the 60 rioplatense phrasings
type Want = Partial<{ autoRepay: boolean; rateWatch: boolean; protectOrder: number; topUp: bigint; repay: bigint; keep: bigint; days: number }>;
const cases: [string, Want, typeof loan?][] = [
  // auto-repay from income
  ["Cuando me entren pesos, pagá el préstamo", { autoRepay: true, topUp: 0n, repay: loan.debt }],
  ["cuando me entren pesos paga el prestamo", { autoRepay: true }],
  ["Uso los pesos para el kiosco. Cuando me entren pesos de ventas, pagá el préstamo con eso. Nunca vendas mis dólares.", { autoRepay: true, topUp: 0n, protectOrder: 1, repay: loan.debt }],
  ["Pagá con mis pesos cuando entren", { autoRepay: true }],
  ["apenas cobre pagá", { autoRepay: true }],
  ["cada vez que me depositen, pagá el préstamo", { autoRepay: true }],
  ["si me llega plata pagá la deuda", { autoRepay: true }],
  ["con las ventas pagá el prestamo", { autoRepay: true }],
  ["con lo que me entre pagalo", { autoRepay: true }],
  ["ni bien me paguen, cancelá lo que puedas del préstamo", { autoRepay: true }],
  ["cuando venda algo usá eso para pagar", { autoRepay: true }],
  ["pagámelo con los pesos que me lleguen", { autoRepay: true }],
  // auto-repay with caps and buffer
  ["Cuando me entren pesos, pagá el préstamo pero dejame siempre $ 50.000", { autoRepay: true, keep: 50_000n * WAD }, big],
  ["cuando entren pesos pagá, pero que me queden 20 mil", { autoRepay: true, keep: 20_000n * WAD }, big],
  ["cuando cobre pagá hasta $ 10.000 por día", { autoRepay: true, repay: 10_000n * WAD }, big],
  ["si me depositan pagá, máximo 30 lucas por semana", { autoRepay: true, repay: 4_286n * WAD }, big],
  ["cuando me entren pesos pagá, no me dejes con menos de 5000 pesos", { autoRepay: true, keep: 5_000n * WAD }, big],
  ["cuando entre plata pagá y guardame $ 100.000", { autoRepay: true, keep: 100_000n * WAD }, big],
  ["cuando me paguen, pagá hasta 200 pesos por día", { autoRepay: true, repay: 200n * WAD }],
  ["cuando entren pesos pagá todo", { autoRepay: true, repay: loan.debt }],
  // protection with dollars
  ["Que mi préstamo nunca llegue a riesgo; usá hasta 20 dólares más por semana.", { topUp: usd(20 / 7), protectOrder: 0 }, big],
  ["Cuidalo con hasta US$ 10 por semana", { topUp: usd(10 / 7) }, big],
  ["cuidalo, agregá hasta u$s 1 por día", { topUp: usd(1) }],
  ["poné hasta 5 dólares por día si se cae el peso", { topUp: usd(5) }, big],
  ["que no me liquiden, metele hasta 30 usd al mes", { topUp: usd(1) }, big],
  ["protegelo con usd 2 diarios", { topUp: usd(2) }, big],
  ["si baja el precio agregá dólares, hasta 15 por semana", { topUp: usd(15 / 7) }, big],
  ["cuidame el préstamo con hasta US$ 3,50 por día", { topUp: usd(3.5) }, big],
  ["usá hasta diez dólares por semana para cuidarlo", { topUp: usd(10 / 7) }, big],
  ["hasta veinte dólares por semana, que no llegue a riesgo", { topUp: usd(20 / 7) }, big],
  ["protegé el préstamo, ponele hasta 1 dólar por día", { topUp: usd(1) }],
  // protection with pesos only
  ["nunca toques mis dólares, si llega a riesgo pagá con mis pesos", { topUp: 0n, protectOrder: 1, repay: loan.debt }],
  ["no uses mis dólares, cuidalo con pesos", { topUp: 0n, protectOrder: 1 }],
  ["que no me vendan los dólares, pagá con pesos", { topUp: 0n, protectOrder: 1 }],
  ["si me entran pesos pagá el préstamo, máximo 500 por día, y nunca vendas mis dólares", { autoRepay: true, repay: 500n * WAD, topUp: 0n, protectOrder: 1 }],
  ["cuando me depositen pagá, hasta 200 por día", { autoRepay: true, repay: 200n * WAD }],
  ["sin tocar mis dólares cuidame el préstamo", { topUp: 0n, protectOrder: 1 }],
  ["nunca vendas mis dólares", { topUp: 0n, protectOrder: 1 }],
  // both
  ["cuidalo con hasta US$ 10 por semana y cuando me entren pesos pagá", { autoRepay: true, topUp: usd(10 / 7) }, big],
  ["agregá hasta 2 usd por día y pagá con las ventas", { autoRepay: true, topUp: usd(2) }, big],
  // rate watch
  ["Avisame si aparece una tasa más barata", { rateWatch: true, autoRepay: false, topUp: 0n, repay: 0n }],
  ["avisame si hay una tasa mas barata", { rateWatch: true }],
  ["cuando me entren pesos pagá y avisame si hay un interés más bajo, más barato", { rateWatch: true, autoRepay: true }],
  // ask first / notice only
  ["No hagas nada sin preguntarme", { autoRepay: false, topUp: 0n, repay: 0n, rateWatch: true }],
  ["solo avisame", { autoRepay: false, topUp: 0n, repay: 0n }],
  ["preguntame antes de mover plata", { autoRepay: false, topUp: 0n, repay: 0n }],
  ["avisame antes de hacer algo", { autoRepay: false, topUp: 0n, repay: 0n }],
  ["consultame todo", { autoRepay: false, topUp: 0n, repay: 0n }],
  // durations
  ["cuando me entren pesos pagá, por 30 días", { autoRepay: true, days: 30 }],
  ["cuidalo con hasta US$ 10 por semana durante 2 semanas", { topUp: usd(10 / 7), days: 14 }, big],
  ["cuando cobre pagá, los próximos 3 meses", { autoRepay: true, days: 90 }],
  ["cuando cobre pagá por 12 meses", { autoRepay: true, days: 180 }], // capped at 180
  // voice-transcript style (no accents, no punctuation, filler)
  ["eh cuando me entren pesos pagale el prestamo dale", { autoRepay: true }],
  ["bueno mira cuidalo con hasta diez dolares por semana", { topUp: usd(10 / 7) }, big],
  ["nunca vendas mis dolares che", { topUp: 0n, protectOrder: 1 }],
  ["avisame si aparece tasa mas barata porfa", { rateWatch: true }],
  ["cuando me depositen pagá dejame 10 mil", { autoRepay: true, keep: 10_000n * WAD }, big],
  ["cuando cobro pagá", { autoRepay: true }],
  ["si me transfieren pagá el prestamo", { autoRepay: true }],
  ["cuando caiga plata pagá", { autoRepay: true }],
  ["con lo que venda pagalo", { autoRepay: true }],
  ["si entran pesos pagá", { autoRepay: true }],
  ["que no llegue a riesgo, hasta 5 usd por semana", { topUp: usd(5 / 7) }, big],
];

describe("parseRule: 63 phrasings", () => {
  it("has 63 cases", () => expect(cases.length).toBe(63));
  for (const [text, want, l] of cases) {
    it(text, () => {
      const L = l ?? loan;
      const got = lim(parseRule(text, L, NOW));
      if (want.autoRepay !== undefined) expect(got.autoRepay).toBe(want.autoRepay);
      if (want.rateWatch !== undefined) expect(got.rateWatch).toBe(want.rateWatch);
      if (want.protectOrder !== undefined) expect(got.protectOrder).toBe(want.protectOrder);
      if (want.topUp !== undefined) expect(got.maxTopUpUsdtPerDay).toBe(want.topUp);
      if (want.repay !== undefined) expect(got.maxRepayWarsPerDay).toBe(want.repay);
      if (want.keep !== undefined) expect(got.keepWarsBuffer).toBe(want.keep);
      if (want.days !== undefined) expect(got.expiry).toBe(NOW + BigInt(want.days) * 86_400n);
      else expect(got.expiry).toBe(L.dueAt + 7n * 86_400n);
    });
  }
});

describe("parseRule: questions, stops and unknowns", () => {
  it("asks how many dollars when protection has no amount", () => {
    const p = parseRule("cuidalo", loan, NOW);
    expect(p.kind).toBe("question");
    if (p.kind === "question") {
      expect(p.question.options.length).toBe(4);
      // every button's words parse to limits
      for (const o of p.question.options) expect(parseRule("cuidalo" + o.append, big, NOW).kind).toBe("limits");
    }
  });
  it("asks for 'que no me liquiden' with no amount", () => expect(parseRule("que no me liquiden", loan, NOW).kind).toBe("question"));
  for (const t of ["pará", "cancelá la regla", "sacale el permiso al agente", "frená todo", "basta"]) it(`stops: ${t}`, () => expect(parseRule(t, loan, NOW).kind).toBe("revoke"));
  for (const t of ["", "hola", "qué lindo día", "cuánto debo"]) it(`unknown: "${t}"`, () => expect(parseRule(t, loan, NOW).kind).toBe("unknown"));
});

describe("parseRule: never a number the person did not say", () => {
  it("no dollar amount appears unless written", () => {
    for (const [text] of cases) {
      const p = parseRule(text, big, NOW);
      if (p.kind !== "limits") continue;
      const wroteNumber = /\d|\b(un|una|uno|dos|tres|cuatro|cinco|diez|quince|veinte|treinta|cien|mil)\b/.test(normalize(text));
      if (!wroteNumber) {
        expect(p.limits.maxTopUpUsdtPerDay).toBe(0n);
        expect(p.limits.keepWarsBuffer).toBe(0n);
        expect([0n, big.debt]).toContain(p.limits.maxRepayWarsPerDay); // the loan's own size, never invented
      }
    }
  });
});

describe("parseRule: hard bounds (fuzz)", () => {
  it("no output exceeds the loan, the collateral or 180 days", () => {
    const words = ["cuidalo", "pagá", "cuando me entren pesos", "hasta", "usd", "$", "por día", "por semana", "dejame", "999999", "5", "mil", "lucas", "por 400 días", "nunca vendas mis dólares", "avisame tasa"];
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(rnd() * 8);
      const text = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(" ");
      const p = parseRule(text, loan, NOW);
      if (p.kind !== "limits") continue;
      expect(p.limits.maxTopUpUsdtPerDay <= loan.collateral).toBe(true);
      expect(p.limits.maxRepayWarsPerDay <= loan.debt).toBe(true);
      expect(p.limits.keepWarsBuffer >= 0n).toBe(true);
      expect(p.limits.expiry > NOW && p.limits.expiry <= NOW + 180n * 86_400n).toBe(true);
    }
  });
  it("clamps a dollar cap above the collateral", () => {
    const l = lim(parseRule("cuidalo con hasta 500 usd por día", loan, NOW));
    expect(l.maxTopUpUsdtPerDay).toBe(loan.collateral);
    const p = parseRule("cuidalo con hasta 500 usd por día", loan, NOW);
    if (p.kind === "limits") expect(p.readback.es).toContain("Lo bajé a US$ 1,30 por día");
  });
});

describe("readback", () => {
  it("states every number", () => {
    const p = parseRule("Cuando me entren pesos, pagá el préstamo pero dejame siempre $ 50.000", big, NOW);
    if (p.kind !== "limits") throw new Error();
    expect(p.readback.es).toContain("$ 50.000");
    expect(p.readback.es).toContain("¿Firmo?");
    expect(p.readback.es).toMatch(/Vence el \d+\/\d+\/\d{4}/);
  });
});

// English: the same parser reads English rules; the person's own words are still what gets hashed and quoted.
const english: [string, Want, typeof loan?][] = [
  ["When pesos from my sales arrive, repay the loan. Never sell my dollars.", { autoRepay: true, topUp: 0n, protectOrder: 1, repay: loan.debt }],
  ["When pesos come in from sales, repay the loan with them. Never sell my dollars.", { autoRepay: true, topUp: 0n, protectOrder: 1 }],
  ["When pesos arrive, repay the loan", { autoRepay: true, repay: loan.debt }],
  ["Repay the loan with my pesos when they arrive", { autoRepay: true }],
  ["Whenever I get paid, pay off the loan", { autoRepay: true }],
  ["As soon as money comes in, pay the loan", { autoRepay: true }],
  ["Use my sales to pay the loan", { autoRepay: true }],
  ["Every time someone pays me, repay my loan", { autoRepay: true }],
  ["If pesos land in my wallet, pay it", { autoRepay: true }],
  ["Never touch my dollars, pay with my pesos", { autoRepay: true, protectOrder: 1, topUp: 0n }],
  ["When pesos arrive, repay up to 500 a day", { autoRepay: true, repay: 500n * WAD }, big],
  ["When pesos arrive repay, at most 10,000 pesos per day", { autoRepay: true, repay: 10_000n * WAD }, big],
  ["When money comes in, repay the loan but always leave me 5,000 pesos", { autoRepay: true, keep: 5_000n * WAD }, big],
  ["When pesos arrive repay, keep at least 20 thousand pesos", { autoRepay: true, keep: 20_000n * WAD }, big],
  ["When I get paid, repay no more than 70,000 pesos a week", { autoRepay: true, repay: 10_000n * WAD }, big],
  ["Protect my loan with up to $10 a week", { topUp: usd(10 / 7), protectOrder: 0 }, big],
  ["Protect it, add up to 1 dollar a day", { topUp: usd(1) }],
  ["Look after my loan with up to US$ 3.50 per day", { topUp: usd(3.5) }, big],
  ["Don't let it get liquidated, put in up to 30 dollars a month", { topUp: usd(1) }, big],
  ["If the peso drops, add up to 2 dollars per day", { topUp: usd(2) }, big],
  ["Keep it safe, use up to ten dollars a week", { topUp: usd(10 / 7) }, big],
  ["Take care of my loan with 5 bucks a day", { topUp: usd(5) }, big],
  ["Protect it for the next 2 weeks with up to five dollars a day", { topUp: usd(5), days: 14 }, big],
  ["When pesos arrive, repay the loan for 30 days", { autoRepay: true, days: 30 }, big],
  ["Do nothing without asking me first", { rateWatch: true, autoRepay: false, topUp: 0n, repay: 0n }],
  ["Just tell me if the rate gets cheaper", { rateWatch: true, autoRepay: false, topUp: 0n }],
  ["When pesos arrive, repay, and tell me if there is a cheaper rate", { autoRepay: true, rateWatch: true }],
  ["When sales come in, repay everything", { autoRepay: true, repay: loan.debt }],
];

describe("parseRule: English", () => {
  for (const [text, want, l] of english) {
    it(text, () => {
      const L = l ?? loan;
      const got = lim(parseRule(text, L, NOW, "en"));
      if (want.autoRepay !== undefined) expect(got.autoRepay).toBe(want.autoRepay);
      if (want.rateWatch !== undefined) expect(got.rateWatch).toBe(want.rateWatch);
      if (want.protectOrder !== undefined) expect(got.protectOrder).toBe(want.protectOrder);
      if (want.topUp !== undefined) expect(got.maxTopUpUsdtPerDay).toBe(want.topUp);
      if (want.repay !== undefined) expect(got.maxRepayWarsPerDay).toBe(want.repay);
      if (want.keep !== undefined) expect(got.keepWarsBuffer).toBe(want.keep);
      if (want.days !== undefined) expect(got.expiry).toBe(NOW + BigInt(want.days) * 86_400n);
    });
  }
  it("asks how many dollars for 'Look after my loan', with English buttons that parse", () => {
    const p = parseRule("Look after my loan", loan, NOW, "en");
    expect(p.kind).toBe("question");
    if (p.kind === "question") {
      expect(p.question.options[0].label).toBe("US$5 / week");
      for (const o of p.question.options) expect(parseRule("Look after my loan" + o.append, big, NOW, "en").kind).toBe("limits");
    }
  });
  for (const t of ["Stop", "Stop the agent", "Cancel the rule", "Remove the agent's permission", "turn off everything"]) it(`stops: ${t}`, () => expect(parseRule(t, loan, NOW, "en").kind).toBe("revoke"));
  for (const t of ["hello", "what a nice day", "how much do I owe"]) it(`unknown: "${t}"`, () => expect(parseRule(t, loan, NOW, "en").kind).toBe("unknown"));
  it("never invents a dollar amount", () => {
    for (const [text] of english) if (!/\$|dollar|bucks|usd/i.test(text)) expect(lim(parseRule(text, big, NOW, "en")).maxTopUpUsdtPerDay).toBe(0n);
  });
});
