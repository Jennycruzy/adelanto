import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mcpServer } from "../src/mcp.ts";

describe("MCP server", () => {
  it("offers the read tools and the two transaction builders, with input checks", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = mcpServer();
    await server.connect(a);
    const c = new Client({ name: "t", version: "1" });
    await c.connect(b);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["build_borrow", "build_repay", "credit_record", "loan_status", "price_history", "quote", "rates"]);
    const borrow = tools.find((t) => t.name === "build_borrow")!;
    expect(borrow.inputSchema.required).toEqual(expect.arrayContaining(["wallet", "pesos"]));
    const bad: any = await c.callTool({ name: "credit_record", arguments: { wallet: "not-an-address" } });
    expect(bad.isError).toBe(true);
    await c.close();
  });
});
