import { describe, expect, it } from "vitest";

const { legacyRedirectTarget } = require("./legacyRedirects.js") as {
  legacyRedirectTarget: (pathname: string, search?: string) => string | null;
};
const { server } = require("./serve.js") as {
  server: { emit: (event: string, request: unknown, response: unknown) => void };
};

function request(url: string) {
  let status = 0;
  let headers: Record<string, string> = {};
  server.emit(
    "request",
    { url, headers: { host: "brandthread.app", accept: "text/html" } },
    {
      writeHead(next: number, nextHeaders: Record<string, string> = {}) { status = next; headers = nextHeaders; },
      end() {},
    },
  );
  return { status, headers };
}

describe("legacyRedirectTarget", () => {
  it("maps legacy /live/<id> share links to the /live?streamId= route", () => {
    expect(legacyRedirectTarget("/live/abc123")).toBe("/live?streamId=abc123");
    expect(legacyRedirectTarget("/live/abc123/")).toBe("/live?streamId=abc123");
    expect(legacyRedirectTarget("/live/abc", "?hostId=s1")).toBe("/live?hostId=s1&streamId=abc");
    expect(legacyRedirectTarget("/live/a b&c")).toBe("/live?streamId=a+b%26c");
  });

  it("maps /creator-program/join to /creator-program-join keeping the query", () => {
    expect(legacyRedirectTarget("/creator-program/join", "?brand=acme")).toBe("/creator-program-join?brand=acme");
    expect(legacyRedirectTarget("/creator-program/join/")).toBe("/creator-program-join");
  });

  it("leaves every other path alone", () => {
    expect(legacyRedirectTarget("/live")).toBeNull();
    expect(legacyRedirectTarget("/live", "?streamId=x")).toBeNull();
    expect(legacyRedirectTarget("/live/a/b")).toBeNull();
    expect(legacyRedirectTarget("/live-feed")).toBeNull();
    expect(legacyRedirectTarget("/creator-program-join", "?brand=x")).toBeNull();
    expect(legacyRedirectTarget("/u/jane")).toBeNull();
  });
});

describe("serve.js legacy redirects", () => {
  it("301s a legacy live link to the query-form route", () => {
    const res = request("/live/stream_42?hostId=seller_9");
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/live?hostId=seller_9&streamId=stream_42");
  });

  it("301s the creator program join link", () => {
    const res = request("/creator-program/join?brand=acme");
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/creator-program-join?brand=acme");
  });
});
