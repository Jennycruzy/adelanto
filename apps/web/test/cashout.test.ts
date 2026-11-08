import { describe, expect, it } from "vitest";
import { cashOut, ripioOffRamp } from "../src/views.ts";

const W = 10n ** 18n;
const borrowed = { name: "Borrowed", args: { pesos: (1000n * W).toString(), fee: (25n * W / 10n).toString() } };

describe("cash-out through Ripio", () => {
  it("links Ripio's off-ramp on Celo with what the loan paid out", () => {
    expect(ripioOffRamp(997n)).toBe("https://ramp.ripio.com/off-ramp?country=AR&chain=42220&token=WARS&amount=997");
    const out = String(cashOut("es", [{ name: "Repaid", args: {} }, borrowed]));
    expect(out).toContain("amount=997");
    expect(out).toContain("Pasá $ 997 a tu cuenta con Ripio"); // 997.5 paid out: never offer more than whole pesos held
  });
  it("shows nothing without a borrow event", () => {
    expect(cashOut("en", [])).toBe("");
  });
});
