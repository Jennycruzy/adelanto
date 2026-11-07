// The borrower's rule in their own words, turned into LoanGuard limits. Rule-based, no model: every number in the
// limits is one the person wrote (or a bound derived from their loan, never a guess), anything missing becomes one
// question with buttons, and the output is clamped to hard bounds the contract also checks.
import { dollars, pesos } from "./sentences.ts";
import type { Limits } from "./guard.ts";

const WAD = 10n ** 18n;
const USDT = 1_000_000n;
const DAY = 86_400n;
export const MAX_RULE_DAYS = 180n;

export type RuleLoan = {
  debt: bigint; // wARS, 18 decimals
  collateral: bigint; // USDT, 6 decimals
  dueAt: bigint; // unix seconds
  maxRateBps: number; // the borrower's accepted rate ceiling
};

export type Question = { id: string; es: string; en: string; options: { label: string; append: string }[] };

export type Parsed =
  | { kind: "limits"; limits: Limits; readback: { es: string; en: string }; notes: string[] }
  | { kind: "question"; question: Question }
  | { kind: "revoke"; readback: { es: string; en: string } }
  | { kind: "unknown"; es: string; en: string };

/** Lower case, no accents, "u$s"/"usd"/"us$" → "usd", thousand dots removed, decimal comma → point. */
export function normalize(text: string): string {
  let s = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[¿¡!?«»"“”]/g, " ");
  s = s.replace(/\bu\s?\$\s?s\b|\bus\s?\$|\busd\b|\busdt\b|\bdolares?\b|\bdolar\b|\bverdes?\b/g, " usd ");
  s = s.replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2").replace(/(\d)\.(\d{3})(?!\d)/g, "$1$2"); // 1.000.000 → 1000000
  s = s.replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2"); // 2,50 → 2.50
  s = s.replace(/\$/g, " $ ");
  s = " " + s.replace(/\s+/g, " ").trim() + " ";
  return english(s);
}

// English rules: the same parser, by rewriting English phrasing into the forms it reads. Only the parse sees this;
// the person's own words are what is hashed on chain and quoted back.
const EN_NUM: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20", "twenty five": "25", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100", "a hundred": "100", "one hundred": "100",
  "two hundred": "200", "three hundred": "300", "five hundred": "500", thousand: "1000", "a thousand": "1000", "one thousand": "1000",
};
const EN: [RegExp, string][] = [
  [/(\d),(\d{3})(?!\d)/g, "$1$2"], // 1,000 → 1000 (English thousands; a Spanish decimal comma has 1–2 digits)
  [/(\d),(\d{3})(?!\d)/g, "$1$2"],
  [/\b(a hundred|one hundred|two hundred|three hundred|five hundred|a thousand|one thousand|twenty five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b(?= (usd|\$|pesos?|ars|dollars?|bucks|days?|weeks?|months?|thousand|a |per |each |every |daily|weekly|monthly))/g, "<n>"],
  [/(\d+(?:\.\d+)?) thousand\b/g, "$1 mil"],
  [/\b(bucks?|dollars?)\b/g, " usd "],
  [/\bars\b/g, " pesos "],
  [/\$ (\d+(?:\.\d+)?)(?!\d| ?(pesos?|mil)\b)/g, " usd $1 "], // in English, $10 is ten dollars unless pesos follow
  // stop and ask first
  [/\b(stop|cancel|turn off|switch off|remove|revoke|delete|disable)\b.{0,25}\b(rule|everything|permission|agent|guard)\b/g, " cancela regla "],
  [/^\s*(stop|cancel)\s*$/g, " para "],
  [/\b(do nothing without asking( me)?|ask me (first|before)|ask (first|before)|check with me( first)?|just (tell|notify|warn) me|only (tell|notify|warn) me|tell me before|warn me before|notify me before)\b/g, " preguntame antes "],
  // periods and durations
  [/\b(per|a|each|every) day\b|\bdaily\b/g, " por dia "],
  [/\b(per|a|each|every) week\b|\bweekly\b/g, " por semana "],
  [/\b(per|a|each|every) month\b|\bmonthly\b/g, " por mes "],
  [/\b(for|during) (the next |the coming )?(\d+(?:\.\d+)?) (days?|weeks?|months?)\b/g, " por $3 $4 "],
  [/\b(until|till|through) (the )?end of (the )?month\b|\ball month\b/g, " hasta fin de mes "],
  [/\bdays?\b/g, " dias "],
  [/\bweeks?\b/g, " semanas "],
  [/\bmonths?\b/g, " meses "],
  // never use the dollars
  [/\b(never|don'?t|do not|dont)( ever)? (sell|touch|use|take|spend|move)( any of)?( my)? usd\b/g, " nunca vendas usd "],
  [/\b(without|with no) (touching|using|selling|spending)( my)? usd\b/g, " sin tocar usd "],
  [/\b(leave|keep) my usd (alone|untouched|out of it)\b/g, " nunca toques usd "],
  [/\bnot (with )?(my )?usd\b/g, " nunca uses usd "],
  // pay with incoming pesos
  [/\bif (the )?(peso|price) (drops|falls|goes down|crashes)\b|\bif (the )?usd (goes up|rises|jumps)\b/g, " si baja el peso "],
  [/\b(use|with|using) (the |my )?sales( money| income)?\b/g, " con las ventas "],
  [/\buse (the |my )?(incoming |new )?(pesos|money)( that (come in|arrive|arrives))?\b/g, " con los pesos que me entren "],
  [/\b(when|whenever|as soon as|every time|each time)\b/g, " cuando "],
  [/\bif\b/g, " si "],
  [/\b(come|comes|coming|came) in\b|\bget in\b/g, " entran "],
  [/\b(arrive|arrives|arriving|arrived|land|lands|show up|shows up|hit my wallet|hits my wallet)\b/g, " llegan "],
  [/\b(get paid|i'?m paid|i am paid|paid me|pays me|pay me|receive|received|receives|get money|i earn|earn)\b/g, " cobro "],
  [/\b(make a sale|sell something|sell anything|sell stuff)\b/g, " venda "],
  [/\b(my|from|the|from my|from the) sales\b|\bsales income\b/g, " ventas "],
  [/\b(with|using|from) (the |my )?(incoming |new )?(pesos|income|money)( that (come in|arrive))?\b/g, " con los pesos que me entren "],
  [/\bincome\b/g, " ingresos "],
  [/\b(deposit|deposits|deposited)\b/g, " deposit "],
  [/\b(pay|repay|pay off|pay down|pay back)( it| the loan| my loan| the debt)?\b/g, " paga "],
  // protect, top up, keep, rate
  [/\b(protect|look after|guard|take care of|keep (it )?safe|watch over|look out for)\b/g, " cuida "],
  [/\b(never|don'?t|do not) let (it|the loan|my loan) (get |be )?(liquidated|reach risk|hit risk|go under)\b|\bavoid liquidation\b|\bno liquidation\b|\bliquidat\w*/g, " no liquid "],
  [/\bat risk\b|\brisk\b/g, " riesgo "],
  [/\b(add|top up|top it up with|put in|put|throw in|use)\b/g, " agrega "],
  [/\bup to\b|\bat most\b|\bmax(imum)?\b|\bno more than\b/g, " hasta "],
  [/\bmore\b/g, " mas "],
  [/\b(always leave me|leave me|always keep|keep at least|keep me|leave at least|at least|minimum of|reserve)\b/g, " dejame "],
  [/\b(rate|interest|cheaper|better price|lower rate|better deal)\b/g, " tasa "],
  [/\beverything\b|\ball of it\b|\bthe whole thing\b/g, " todo "],
];
function english(s: string): string {
  if (!/\b(the|my|it|when|whenever|pay|repay|never|dollars?|bucks|loan|arrive|arrives|protect|add|up to|per|stop|ask|with|if|keep|sales|do|nothing|tell|just|asking|first|cancel|look|leave|put|don'?t|dont|money|get|turn|everything|remove|agent|rule|someone|wallet)\b/.test(s)) return s;
  let out = s.replace(EN[2][0], (m) => EN_NUM[m] ?? m);
  for (let i = 0; i < EN.length; i++) if (i !== 2) out = out.replace(EN[i][0], EN[i][1]);
  return " " + out.replace(/\s+/g, " ").trim() + " ";
}

const WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300,
  quinientos: 500, mil: 1000, media: 0.5, medio: 0.5,
};

/** Numbers as people write them: 20, 2.5, 50 mil, 50 lucas, 50k, veinte, mil. Returns [value, index, length]. */
function numbers(s: string): { v: number; at: number; end: number; thousands: boolean }[] {
  const out: { v: number; at: number; end: number; thousands: boolean }[] = [];
  const re = /(\d+(?:\.\d+)?)(\s?(?:mil|lucas?|k)\b)?|\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|quinientos|mil)\b(\s(?:mil|lucas?)\b)?/g;
  for (let m; (m = re.exec(s)); ) {
    let v = m[1] !== undefined ? Number(m[1]) : WORDS[m[3]];
    const mult = (m[2] ?? m[4] ?? "").trim();
    if (mult && !(m[3] === "mil" && !m[4])) v *= 1000;
    // "un"/"una" alone is an article, not a number, unless a unit or "mil" follows
    if (m[3] && (m[3] === "un" || m[3] === "una" || m[3] === "uno") && !mult && !/^\s?(usd|\$|peso|dia|semana|mes)/.test(s.slice(m.index + m[0].length))) continue;
    out.push({ v, at: m.index, end: m.index + m[0].length, thousands: mult !== "" || m[3] === "mil" });
  }
  return out;
}

type Period = "day" | "week" | "month";
function periodAfter(s: string, from: number): Period | null {
  const tail = s.slice(from, from + 40).replace(/^(\s?(usd|\$|pesos?))?\s(mas|extra)\b/, "$1");
  if (/^\s?(usd|\$|pesos?)?\s?(por|al|a la|cada|x)\s(dia|diarios?)/.test(tail) || /^\s?(usd|\$|pesos?)?\s?diarios?/.test(tail)) return "day";
  if (/^\s?(usd|\$|pesos?)?\s?(por|a la|cada|x)\s(semana)/.test(tail) || /^\s?(usd|\$|pesos?)?\s?semanal/.test(tail)) return "week";
  if (/^\s?(usd|\$|pesos?)?\s?(por|al|cada|x)\s(mes)/.test(tail) || /^\s?(usd|\$|pesos?)?\s?mensual/.test(tail)) return "month";
  return null;
}
const perDay = (v: number, p: Period | null) => (p === "week" ? v / 7 : p === "month" ? v / 30 : v);

/** Which currency a number belongs to, from the words right around it. */
function currencyOf(s: string, n: { at: number; end: number; thousands: boolean }): "usd" | "ars" | null {
  const before = s.slice(Math.max(0, n.at - 6), n.at);
  const after = s.slice(n.end, n.end + 10);
  if (/usd\s?$/.test(before) || /^\s?usd/.test(after)) return "usd";
  if (/\$\s?$/.test(before) || /^\s?(pesos?|mangos?|\$)/.test(after) || n.thousands) return "ars"; // "20 mil", "30 lucas": pesos
  return null;
}

const toUsdt = (v: number) => BigInt(Math.round(v * 100)) * (USDT / 100n);
const toWars = (v: number) => BigInt(Math.round(v)) * WAD;
const has = (s: string, re: RegExp) => re.test(s);

const STOP = /\b(para|frena|cancela|cancelar|anula|borra|saca|sacale|quita|quitale|desactiva|apaga)\b.{0,25}\b(regla|todo|permiso|agente|guardia)\b|^\s*(para|pare|stop|basta|frena)\s*$/;
const ASK_FIRST = /\b(no hagas nada|nada sin (preguntar|avisar)|preguntame antes|consultame|solo avisa|solo avisame|solamente avisa|nada mas avisa|avisame antes|avisa antes|preguntame primero|consultame primero)/;
const AUTO_REPAY = /\b(cuando|si|apenas|ni bien|cada vez que)\b.{0,30}\b(entr|lleg|cobr|deposit|ingres|paguen|transfier|caiga|vend|venta)|\bcon (las|mis|lo de las|la plata de las) ventas\b|\bcon lo que (me )?(entre|llegue|cobre|ingrese|venda)|\bpaga(lo|melo)? (solo )?con (mis|los) pesos( que (me )?(entren|lleguen))?/;
const NO_DOLLARS = /\bnunca\b.{0,20}\b(vendas|toques|uses|agarres|saques|pongas)\b.{0,15}\busd\b|\bno (me )?(vendas|toques|uses)\b.{0,15}\busd\b|\bsin (tocar|usar|vender) (mis )?usd\b|\bque no me (vendan|toquen|usen)\b.{0,10}\busd\b/;
const PROTECT = /\b(cuida|cuidalo|cuidame|protege|protegelo|que no (llegue|caiga|pase)|nunca llegue a riesgo|no (me )?liquid|que no me (vendan|liquiden)|riesgo|si (baja|se cae|cae) el (peso|precio|dolar|usd))/;
const TOPUP_VERB = /\b(agrega|agregale|pone|ponele|suma|sumale|usa|usale|mete|metele|tira|tirale)\b.{0,25}\busd\b|\busd\b.{0,20}\bmas\b|\bhasta\b.{0,12}\busd\b|\busd\b.{0,6}\d/;
const RATE = /\b(tasa|interes|mas barat|mas economic|mejor precio|mas conveniente)/;
const KEEP = /\b(deja(me|le)?|que me (quede|queden)|no me dejes con menos de|guarda(me)?|reserva(me)?|siempre (tene|deja)|minimo)\b/;

export function parseRule(text: string, loan: RuleLoan, nowSec: bigint, lang: "es" | "en" = "es"): Parsed {
  const s = normalize(text);
  if (s.trim().length === 0) return { kind: "unknown", es: "Escribí qué querés que haga el agente.", en: "Write what you want the agent to do." };
  if (STOP.test(s)) return { kind: "revoke", readback: { es: "Voy a quitarle el permiso al agente: deja de actuar en tu préstamo. ¿Firmo?", en: "I will take the agent's permission away: it stops acting on your loan. Sign?" } };

  const nums = numbers(s);
  const notes: string[] = [];
  const askFirst = ASK_FIRST.test(s);
  const autoRepay = !askFirst && AUTO_REPAY.test(s);
  const noDollars = NO_DOLLARS.test(s);
  const wantsProtect = !askFirst && (PROTECT.test(s) || noDollars);
  const rateWatch = RATE.test(s) || askFirst;

  // classify each number
  let topUpPerDay: number | null = null;
  let repayPerDay: number | null = null;
  let keep: number | null = null;
  let days: number | null = null;
  for (const n of nums) {
    const after = s.slice(n.end, n.end + 14);
    if (/^\s?(dias?|semanas?|mes(es)?)\b/.test(after) && /\b(por|durante|los proximos|en|hasta dentro de)\s?$/.test(s.slice(Math.max(0, n.at - 22), n.at))) {
      const unit = /^\s?dia/.test(after) ? 1 : /^\s?semana/.test(after) ? 7 : 30;
      days = n.v * unit;
      continue;
    }
    if (/^\s?(dias?|semanas?|mes(es)?|%|por ciento)\b/.test(after)) continue;
    const cur = currencyOf(s, n);
    const before = s.slice(Math.max(0, n.at - 40), n.at);
    if (KEEP.test(before) && cur !== "usd") {
      keep = n.v;
      continue;
    }
    const p = periodAfter(s, n.end);
    if (cur === "usd") topUpPerDay = perDay(n.v, p);
    else if (cur === "ars") repayPerDay = perDay(n.v, p);
    else if (TOPUP_VERB.test(s) && !noDollars) topUpPerDay = perDay(n.v, p);
    // an amount with no currency in a rule that repays with incoming pesos, and never adds dollars, is pesos
    else if (autoRepay) repayPerDay = perDay(n.v, p);
  }
  if (/\b(hasta (el )?fin de mes|todo el mes)\b/.test(s)) {
    const d = new Date(Number(nowSec) * 1000);
    const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
    days = Math.ceil((end - Number(nowSec)) / 86400);
  }

  const mentionsDollarsUse = !noDollars && (TOPUP_VERB.test(s) || topUpPerDay !== null);
  if (askFirst && !mentionsDollarsUse && !autoRepay) {
    const limits = baseLimits(loan, nowSec, days);
    limits.rateWatch = true;
    return { kind: "limits", limits, readback: readback(limits, loan, true), notes: ["ask_first"] };
  }
  if (!autoRepay && !wantsProtect && !mentionsDollarsUse && !rateWatch && keep === null)
    return { kind: "unknown", es: "No entendí qué querés que haga. Probá con algo como: «Cuando me entren pesos, pagá el préstamo» o «Cuidalo con hasta US$ 10 por semana».", en: "I did not get what you want it to do. Try something like: \"When pesos arrive, repay the loan\" or \"Protect it with up to US$10 a week\"." };

  // protection: dollars or pesos
  if (wantsProtect && !noDollars && topUpPerDay === null && !autoRepay && repayPerDay === null) {
    return {
      kind: "question",
      question: {
        id: "topup_amount",
        es: "¿Cuántos dólares tuyos puede agregar el agente, como máximo por semana, si el préstamo llega a riesgo?",
        en: "How many of your dollars may the agent add at most per week if the loan reaches risk?",
        options: [
          { label: lang === "es" ? "US$ 5 / semana" : "US$5 / week", append: lang === "es" ? " hasta US$ 5 por semana" : " up to 5 dollars a week" },
          { label: lang === "es" ? "US$ 10 / semana" : "US$10 / week", append: lang === "es" ? " hasta US$ 10 por semana" : " up to 10 dollars a week" },
          { label: lang === "es" ? "US$ 20 / semana" : "US$20 / week", append: lang === "es" ? " hasta US$ 20 por semana" : " up to 20 dollars a week" },
          { label: lang === "es" ? "Con mis pesos, no dólares" : "With my pesos, not dollars", append: lang === "es" ? " pagá con mis pesos, nunca toques mis dólares" : " pay with my pesos, never touch my dollars" },
        ],
      },
    };
  }

  const limits = baseLimits(loan, nowSec, days);
  limits.rateWatch = rateWatch;
  limits.autoRepay = autoRepay;
  if (topUpPerDay !== null && !noDollars) limits.maxTopUpUsdtPerDay = toUsdt(topUpPerDay);
  if (repayPerDay !== null) limits.maxRepayWarsPerDay = toWars(repayPerDay);
  else if (autoRepay || noDollars || (wantsProtect && topUpPerDay === null)) {
    limits.maxRepayWarsPerDay = loan.debt; // bounded by the loan itself, not a guessed number
    notes.push("repay_cap_is_debt");
  }
  if (keep !== null) limits.keepWarsBuffer = toWars(keep);
  limits.protectOrder = noDollars || limits.maxTopUpUsdtPerDay === 0n ? 1 : 0;

  // hard bounds (the contract checks expiry; caps are clamped to the loan)
  if (limits.maxTopUpUsdtPerDay > loan.collateral) {
    limits.maxTopUpUsdtPerDay = loan.collateral;
    notes.push("topup_clamped_to_collateral");
  }
  if (limits.maxRepayWarsPerDay > loan.debt) {
    limits.maxRepayWarsPerDay = loan.debt;
    notes.push("repay_clamped_to_debt");
  }
  const rb = readback(limits, loan, false);
  if (notes.includes("topup_clamped_to_collateral")) {
    rb.es = rb.es.replace("Nunca más", `Lo bajé a ${dollars(limits.maxTopUpUsdtPerDay)} por día porque no puede pasar lo que hoy tenés de garantía. Nunca más`);
    rb.en = rb.en.replace("Never more", `I lowered it to ${dollars(limits.maxTopUpUsdtPerDay, "en")} a day because it cannot exceed your collateral today. Never more`);
  }
  if (notes.includes("repay_clamped_to_debt")) {
    rb.es = rb.es.replace("Nunca más", `Lo bajé a ${pesos(limits.maxRepayWarsPerDay)} por día, lo que debés hoy. Nunca más`);
    rb.en = rb.en.replace("Never more", `I lowered it to ${pesos(limits.maxRepayWarsPerDay, "en")} a day, what you owe today. Never more`);
  }
  return { kind: "limits", limits, readback: rb, notes };
}

function baseLimits(loan: RuleLoan, nowSec: bigint, days: number | null): Limits {
  // default: until the loan's grace period ends (due + 7 days), never past 180 days
  let expiry = days !== null ? nowSec + BigInt(Math.ceil(days)) * DAY : loan.dueAt + 7n * DAY;
  const cap = nowSec + MAX_RULE_DAYS * DAY;
  if (expiry > cap) expiry = cap;
  if (expiry <= nowSec) expiry = nowSec + DAY;
  return { autoRepay: false, rateWatch: false, protectOrder: 0, expiry, keepWarsBuffer: 0n, maxRepayWarsPerDay: 0n, maxTopUpUsdtPerDay: 0n, maxRateBps: loan.maxRateBps };
}

const fmtDate = (sec: bigint, lang: "es" | "en") =>
  new Date(Number(sec) * 1000).toLocaleDateString(lang === "es" ? "es-AR" : "en-GB", { day: "numeric", month: "numeric", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

/** Every number the borrower will sign, in plain words. */
export function readback(l: Limits, loan: RuleLoan, askFirst: boolean): { es: string; en: string } {
  const es: string[] = [];
  const en: string[] = [];
  if (askFirst || (!l.autoRepay && l.maxTopUpUsdtPerDay === 0n && l.maxRepayWarsPerDay === 0n)) {
    es.push("no mover plata: solo avisarte si tu préstamo se acerca al riesgo" + (l.rateWatch ? " o si aparece una tasa más barata" : ""));
    en.push("move no money: only tell you if your loan nears risk" + (l.rateWatch ? " or a cheaper rate appears" : ""));
  } else {
    if (l.maxTopUpUsdtPerDay > 0n) {
      es.push(`si tu préstamo llega al 70%, agregar de tus dólares hasta ${dollars(l.maxTopUpUsdtPerDay)} por día (${dollars(l.maxTopUpUsdtPerDay * 7n)} por semana)`);
      en.push(`if your loan reaches 70%, add up to ${dollars(l.maxTopUpUsdtPerDay, "en")} a day of your dollars (${dollars(l.maxTopUpUsdtPerDay * 7n, "en")} a week)`);
    }
    if (l.autoRepay) {
      es.push(`cuando te entren pesos de otra persona, usarlos para pagar el préstamo, hasta ${pesos(l.maxRepayWarsPerDay)} por día`);
      en.push(`when pesos arrive from someone else, use them to repay the loan, up to ${pesos(l.maxRepayWarsPerDay, "en")} a day`);
    }
    if (l.maxRepayWarsPerDay > 0n && l.protectOrder === 1) {
      es.push("si llega al 70%, pagar con tus pesos antes que tocar tus dólares");
      en.push("if it reaches 70%, repay with your pesos before touching your dollars");
    }
    if (l.maxTopUpUsdtPerDay === 0n) {
      es.push("nunca agregar tus dólares");
      en.push("never add your dollars");
    }
    if (l.keepWarsBuffer > 0n) {
      es.push(`dejarte siempre ${pesos(l.keepWarsBuffer)} en la billetera`);
      en.push(`always leave you ${pesos(l.keepWarsBuffer, "en")} in the wallet`);
    }
    if (l.rateWatch) {
      es.push("avisarte si aparece una tasa más barata");
      en.push("tell you if a cheaper rate appears");
    }
  }
  return {
    es: `Voy a: ${es.join("; ")}. Nunca más que eso, nunca a otra cuenta. Vence el ${fmtDate(l.expiry, "es")}. ¿Firmo?`,
    en: `I will: ${en.join("; ")}. Never more than that, never to another account. Ends ${fmtDate(l.expiry, "en")}. Sign?`,
  };
}
