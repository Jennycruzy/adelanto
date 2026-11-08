import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { linkTypedData } from "../client/tglink.ts";

// A throwaway web database and a recording stand-in for Telegram's API.
process.env.WEB_DB_PATH = join(mkdtempSync(join(tmpdir(), "tg-")), "web.sqlite");
process.env.TELEGRAM_BOT_TOKEN = "1:test";
const sent: { chat: number; text: string; buttons?: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    const b = JSON.parse(init.body);
    if (String(url).endsWith("/sendMessage")) sent.push({ chat: b.chat_id, text: b.text, buttons: b.reply_markup?.inline_keyboard });
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }
  return realFetch(url, init);
}) as typeof fetch;

const tg = await import("../src/telegram.ts");
// anvil's first well-known key: a throwaway signer, never funded
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const sign = async (nonce: string, expires: bigint) => account.signTypedData(linkTypedData(account.address, nonce, expires));
const msg = (chat: number, text: string, lang = "es") => ({ message: { chat: { id: chat, type: "private" }, from: { language_code: lang }, text } });

beforeAll(async () => {
  // startBot is not run in tests; hand the module its token the way startBot does.
  (tg as any).botToken();
});

describe("linking a wallet to a Telegram chat", () => {
  it("gives a one-time code only for the wallet's own signature, once", async () => {
    const expires = BigInt(Math.floor(Date.now() / 1000) + 600);
    const signature = await sign("n1", expires);
    const r = await tg.linkCode({ wallet: account.address, nonce: "n1", expires: expires.toString(), signature });
    expect("code" in r && /^[0-9a-f]{24}$/.test(r.code)).toBe(true);
    expect(await tg.linkCode({ wallet: account.address, nonce: "n1", expires: expires.toString(), signature })).toEqual({ error: "already used" });
  });

  it("refuses an expired or malformed request", async () => {
    const past = BigInt(Math.floor(Date.now() / 1000) - 1);
    expect(await tg.linkCode({ wallet: account.address, nonce: "n2", expires: past.toString(), signature: await sign("n2", past) })).toEqual({ error: "expired" });
    expect(await tg.linkCode({ wallet: "nope", nonce: "n3", expires: "1", signature: "0x00" })).toEqual({ error: "bad request" });
  });
});

describe("the bot", () => {
  it("links a chat with the code, says so, and the code works once", async () => {
    const expires = BigInt(Math.floor(Date.now() / 1000) + 600);
    const r = (await tg.linkCode({ wallet: account.address, nonce: "n4", expires: expires.toString(), signature: await sign("n4", expires) })) as { code: string };
    sent.length = 0;
    await tg.handle(msg(77, `/start ${r.code}`));
    expect(sent[0].chat).toBe(77);
    expect(sent[0].text).toContain(`este chat recibe los avisos de la billetera ${account.address.slice(0, 6)}`);
    sent.length = 0;
    await tg.handle(msg(78, `/start ${r.code}`));
    expect(sent[0].text).toContain("Ese link ya no sirve");
  });

  it("tells an unlinked chat how to link, in its language", async () => {
    sent.length = 0;
    await tg.handle(msg(90, "cuando me entren pesos pagá el préstamo"));
    expect(sent[0].text).toContain("Avisarme por Telegram");
    await tg.handle(msg(91, "hello", "en"));
    expect(sent[1].text).toContain("Notify me on Telegram");
  });

  it("does not pretend to read voice notes, and unlinks on request", async () => {
    sent.length = 0;
    await tg.handle({ message: { chat: { id: 77, type: "private" }, from: { language_code: "es" }, voice: { file_id: "x" } } });
    expect(sent[0].text).toContain("Las notas de voz todavía no las leo");
    await tg.handle(msg(77, "/desvincular"));
    expect(sent[1].text).toContain("ya no te aviso");
    expect(tg.tgDb().prepare("SELECT COUNT(*) n FROM tg_links WHERE chat_id = 77").get()).toEqual({ n: 0 });
  });

  it("ignores group chats", async () => {
    sent.length = 0;
    await tg.handle({ message: { chat: { id: -5, type: "group" }, from: {}, text: "/start" } });
    expect(sent).toHaveLength(0);
  });
});
