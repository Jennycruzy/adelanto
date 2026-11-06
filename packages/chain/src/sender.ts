// The agent's only way to send a transaction. Order of steps, each of which can stop the send:
//   1. tag the calldata with the attribution code (and check it is there);
//   2. simulate the call against the latest state (a revert here sends nothing);
//   3. prepare and sign locally;
//   4. hand the signed bytes and hash to `record` (the caller saves them) BEFORE broadcasting;
//   5. broadcast, wait for the receipt, check status and the tag on the landed transaction.
// A crash after step 4 leaves a saved, signed transaction: `resume` re-broadcasts those exact bytes (same nonce),
// so the same action can never land twice.
import { toDataSuffix } from "@celo/attribution-tags";
import {
  concatHex,
  createWalletClient,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { celo } from "viem/chains";
import { accountFromKeyFile, carriesCode, celoTransport } from "./index.ts";

export type Signed = { hash: Hex; raw: Hex; nonce: number; to: Address; data: Hex; from: Address };

export type SendResult = { hash: Hex; receipt: TransactionReceipt };

export class TaggedSender {
  readonly address: Address;
  private readonly wallet;
  private readonly account;
  private readonly pub: PublicClient;
  private readonly code: string;

  constructor(keyFile: string, pub: PublicClient, code: string, env: NodeJS.ProcessEnv = process.env) {
    this.pub = pub;
    this.code = code;
    this.account = accountFromKeyFile(keyFile);
    this.address = this.account.address;
    // A plain wallet client: the tag is added below and checked, so nothing depends on a client extension.
    this.wallet = createWalletClient({ account: this.account, chain: celo, transport: celoTransport(env) });
  }

  tag(data: Hex): Hex {
    const tagged = carriesCode(data, this.code) ? data : concatHex([data, toDataSuffix(this.code) as Hex]);
    if (!carriesCode(tagged, this.code)) throw new Error("attribution tag missing after tagging");
    return tagged;
  }

  /** Steps 1–3. Throws (and sends nothing) if the call would revert. */
  async prepare(to: Address, data: Hex): Promise<Signed> {
    const tagged = this.tag(data);
    await this.pub.call({ account: this.address, to, data: tagged }); // simulation: throws with the revert reason
    const request = await this.wallet.prepareTransactionRequest({ account: this.account, to, data: tagged, chain: celo });
    const raw = await this.wallet.signTransaction(request as any);
    return { hash: keccak256(raw), raw, nonce: request.nonce as number, to, data: tagged, from: this.address };
  }

  /** Step 5 for a transaction already recorded. Safe to call again with the same bytes. */
  async broadcast(signed: Signed, timeoutMs = 120_000): Promise<SendResult> {
    try {
      await this.pub.sendRawTransaction({ serializedTransaction: signed.raw });
    } catch (e: any) {
      const msg = String(e?.details ?? e?.shortMessage ?? e);
      // Already known or already mined (e.g. re-broadcast after a restart): fall through to the receipt.
      if (!/already known|nonce too low|already exists|known transaction/i.test(msg)) throw e;
    }
    const receipt = await this.pub.waitForTransactionReceipt({ hash: signed.hash, timeout: timeoutMs });
    if (receipt.status !== "success") throw new Error(`reverted on chain: ${signed.hash}`);
    const tx = await this.pub.getTransaction({ hash: signed.hash });
    if (!carriesCode(tx.input, this.code)) throw new Error(`landed without the attribution tag: ${signed.hash}`);
    return { hash: signed.hash, receipt };
  }

  /** Full send: prepare, let the caller record, then broadcast. */
  async send(to: Address, data: Hex, record: (s: Signed) => void): Promise<SendResult> {
    const signed = await this.prepare(to, data);
    record(signed);
    return this.broadcast(signed);
  }
}
