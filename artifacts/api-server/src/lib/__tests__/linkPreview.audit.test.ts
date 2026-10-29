import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { pinnedLookup } from "../linkPreview";

describe("pinnedLookup", () => {
  it("connects a real http.request to the pinned address (Node calls lookup with { all: true })", async () => {
    const server = http.createServer((_req, res) => res.end("pinned-ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          `http://preview-host.invalid:${port}/`,
          { lookup: pinnedLookup({ address: "127.0.0.1", family: 4 }) } as http.RequestOptions,
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => { text += chunk; });
            res.on("end", () => resolve(text));
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(body).toBe("pinned-ok");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("answers single-address lookups too", () => {
    const calls: unknown[][] = [];
    pinnedLookup({ address: "1.2.3.4", family: 4 })("h", {}, (...args) => { calls.push(args); });
    pinnedLookup({ address: "1.2.3.4", family: 4 })("h", { all: true }, (...args) => { calls.push(args); });
    expect(calls).toEqual([[null, "1.2.3.4", 4], [null, [{ address: "1.2.3.4", family: 4 }]]]);
  });
});
