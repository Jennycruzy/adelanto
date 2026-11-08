// The message a wallet signs (EIP-712, free, no transaction) to receive its agent notices in a Telegram chat. Shared
// by the page script and the server so both build exactly the same typed data.
export const TG_DOMAIN = { name: "ADELANTO", version: "1", chainId: 42220 } as const;
export const TG_TYPES = {
  LinkTelegram: [
    { name: "wallet", type: "address" },
    { name: "statement", type: "string" },
    { name: "nonce", type: "string" },
    { name: "expires", type: "uint256" },
  ],
} as const;
export const TG_STATEMENT = "Send the agent's notices about this wallet to a Telegram chat. This moves no money.";

export function linkTypedData(wallet: `0x${string}`, nonce: string, expires: bigint) {
  return {
    domain: TG_DOMAIN,
    types: TG_TYPES,
    primaryType: "LinkTelegram" as const,
    message: { wallet, statement: TG_STATEMENT, nonce, expires },
  };
}
