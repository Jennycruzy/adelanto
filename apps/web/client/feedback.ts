// ERC-8004 feedback for the agent from a closed loan (ReputationRegistry v1 on Celo). Shared by the page script and
// the server so both encode and read the same thing. One rating per closed loan: tag1 "closed-loan", tag2 the loan id,
// the evidence URI the public loan page. Value 20-100 (1 to 5 stars), no decimals.
import { encodeFunctionData, parseAbi, zeroHash, type Hex } from "viem";

export const REPUTATION = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as const;
export const AGENT_ID = 10043n;
export const FEEDBACK_TAG = "closed-loan";

export const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getClients(uint256 agentId) view returns (address[])",
  "function readAllFeedback(uint256 agentId, address[] clientAddresses, string tag1, string tag2, bool includeRevoked) view returns (address[] clients, uint64[] feedbackIndexes, int128[] values, uint8[] valueDecimals, string[] tag1s, string[] tag2s, bool[] revokedStatuses)",
]);

export function feedbackCall(site: string, loanId: bigint, stars: number): Hex {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error("stars must be 1 to 5");
  return encodeFunctionData({
    abi: reputationAbi,
    functionName: "giveFeedback",
    args: [AGENT_ID, BigInt(stars * 20), 0, FEEDBACK_TAG, loanId.toString(), site, `${site}/prestamo/${loanId}`, zeroHash],
  });
}
