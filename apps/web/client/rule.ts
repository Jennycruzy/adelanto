// A borrower's rule: the limits LoanGuard enforces, and the plain Spanish sentence that says exactly those limits.
// The sentence is what gets hashed into setLimits(limits, ruleHash), so anyone can check the words against the chain.
export type RuleInput = {
  topUpUsdPerDay: number; // 0 = never add dollars
  repayPesosPerDay: number; // 0 = never repay with pesos when at risk (and no auto-repay)
  autoRepay: boolean;
  keepPesos: number;
  rateWatch: boolean;
  days: number; // how long the permission lasts, at most 180
};

const usd = (n: number) => `US$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ars = (n: number) => `$ ${Math.round(n).toLocaleString("es-AR")}`;

export function ruleSentence(r: RuleInput): string {
  const parts: string[] = [];
  if (r.topUpUsdPerDay > 0) parts.push(`si mi préstamo llega a riesgo, agregá hasta ${usd(r.topUpUsdPerDay)} por día de mis dólares`);
  if (r.repayPesosPerDay > 0) parts.push(`${parts.length ? "y si no alcanza, " : "si mi préstamo llega a riesgo, "}pagá hasta ${ars(r.repayPesosPerDay)} por día con mis pesos`);
  if (r.autoRepay && r.repayPesosPerDay > 0) parts.push(`cuando me entren pesos, pagá el préstamo`);
  if (r.keepPesos > 0) parts.push(`dejame siempre ${ars(r.keepPesos)}`);
  if (r.rateWatch) parts.push(`avisame si aparece una tasa más barata`);
  const body = parts.length ? parts.join("; ") : "no muevas nada; sólo avisame";
  return `${body[0].toUpperCase()}${body.slice(1)}. Vale por ${r.days} días.`;
}

export const PRESETS: { id: string; es: string; en: string; rule: RuleInput }[] = [
  { id: "cuidalo", es: "Cuidalo con hasta US$ 10 por semana", en: "Protect it with up to US$10 a week", rule: { topUpUsdPerDay: 1.43, repayPesosPerDay: 0, autoRepay: false, keepPesos: 0, rateWatch: true, days: 90 } },
  { id: "pesos", es: "Pagá sólo cuando entren pesos", en: "Repay only when pesos arrive", rule: { topUpUsdPerDay: 0, repayPesosPerDay: 1_000_000, autoRepay: true, keepPesos: 0, rateWatch: true, days: 90 } },
  { id: "avisame", es: "No hagas nada sin preguntarme", en: "Do nothing without asking me", rule: { topUpUsdPerDay: 0, repayPesosPerDay: 0, autoRepay: false, keepPesos: 0, rateWatch: true, days: 90 } },
];
