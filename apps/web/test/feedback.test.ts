import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress, zeroHash } from "viem";
import { AGENT_ID, FEEDBACK_TAG, feedbackCall, reputationAbi } from "../client/feedback.ts";
import { rateCard, repLine } from "../src/views.ts";

const site = "https://adelanto.space";
const loan = (o: any) => ({ id: 4n, borrower: getAddress("0x0cff67325Ba688921C36bDf0ff59E351100e2A3d"), open: false, liquidated: false, ...o });

describe("rating the agent on ERC-8004", () => {
  it("encodes one rating per closed loan, with the loan page as evidence", () => {
    const d = decodeFunctionData({ abi: reputationAbi, data: feedbackCall(site, 4n, 5) });
    expect(d.functionName).toBe("giveFeedback");
    expect(d.args).toEqual([AGENT_ID, 100n, 0, FEEDBACK_TAG, "4", site, `${site}/prestamo/4`, zeroHash]);
    expect(() => feedbackCall(site, 4n, 0)).toThrow();
    expect(() => feedbackCall(site, 4n, 6)).toThrow();
  });

  it("asks only the borrower of a closed loan that is not ours, and shows a rating once given", () => {
    expect(String(rateCard("es", loan({}) as any, null))).toContain('data-action="rateAgent"');
    expect(rateCard("es", loan({ open: true }) as any, null)).toBe("");
    expect(rateCard("es", loan({ borrower: getAddress("0xB93A6B8f3bF182780e0366bE0eC6bD027c4CB2d1") }) as any, null)).toBe("");
    expect(rateCard("es", loan({}) as any, undefined)).toBe(""); // registry unreadable: no prompt
    expect(String(rateCard("en", loan({}) as any, 4))).toContain("★★★★☆");
  });

  it("shows the average only when there are ratings", () => {
    expect(repLine("es", null)).toBe("");
    expect(String(repLine("es", { count: 2, avg: 4.5 }))).toContain("<b>4,5</b> / 5 · 2 calificaciones en ERC-8004");
  });
});
