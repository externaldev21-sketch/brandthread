import { describe, expect, it } from "vitest";

const { server } = require("./serve.js") as {
  server: {
    emit: (event: string, request: unknown, response: unknown) => void;
  };
};

function request(url: string, headers: Record<string, string>) {
  let status = 0;
  let responseHeaders: Record<string, string> = {};
  let body = "";

  server.emit(
    "request",
    { url, headers },
    {
      writeHead(nextStatus: number, nextHeaders: Record<string, string> = {}) {
        status = nextStatus;
        responseHeaders = nextHeaders;
      },
      end(chunk?: string) {
        body = chunk ?? "";
      },
    },
  );

  return { status, headers: responseHeaders, body };
}

describe("Brandthread canonical-host redirect", () => {
  it("permanently redirects the generated hostname and preserves path and query", () => {
    const response = request("/orders/123?from=email&tab=tracking", {
      host: "Brandthread.replit.app",
      accept: "text/html",
    });

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe(
      "https://brandthread.app/orders/123?from=email&tab=tracking",
    );
  });

  it("uses the public forwarded host when the proxy provides one", () => {
    const response = request("/seller/store?preview=1", {
      host: "internal-service",
      "x-forwarded-host": "brandthread.replit.app, internal-service",
    });

    expect(response.status).toBe(301);
    expect(response.headers.location).toBe(
      "https://brandthread.app/seller/store?preview=1",
    );
  });

  it("does not redirect the canonical domain or local health checks", () => {
    const branded = request("/status", { host: "brandthread.app" });
    const local = request("/status", { host: "localhost:3000" });

    expect(branded.status).toBe(200);
    expect(local.status).toBe(200);
  });
});

describe("API routing trap — /api-shaped paths never get the SPA shell", () => {
  // This server only ever serves the exported browser app; real /api/*
  // traffic goes to api-server, a separate origin. But a browser
  // navigation (Accept: text/html) to an unmatched path otherwise falls
  // through to the SPA shell with a 200 — this must never happen for a
  // path that LOOKS like an API call (a proxy misconfiguration, or a
  // typo'd /api-server/* that didn't get routed to the real API), or a
  // broken API request would silently look like a successful page load.

  it("returns a JSON 404 for an unknown /api/* path, not the SPA shell", () => {
    const response = request("/api/nonexistent", { host: "brandthread.app", accept: "text/html" });

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    const parsed = JSON.parse(response.body);
    expect(parsed.code).toBe("NOT_FOUND");
  });

  it("returns a JSON 404 for /api-server/* even though it doesn't share the /api/ prefix exactly", () => {
    const response = request("/api-server/whatever", { host: "brandthread.app", accept: "text/html" });

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("returns a JSON 404 for bare /api with no trailing path", () => {
    const response = request("/api", { host: "brandthread.app", accept: "text/html" });

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("does not false-positive on a real route that merely starts with the letters 'api'", () => {
    // e.g. a hypothetical /apiary or /apikeys screen must never be treated
    // as an API path — this server's index.html isn't built in this test
    // environment, so it can't assert a 200 SPA shell here, but it must
    // NOT get the JSON 404 the /api guard above returns.
    const response = request("/apiary", { host: "brandthread.app", accept: "text/html" });

    expect(response.headers["content-type"]).not.toContain("application/json");
  });

  it("an ordinary unmatched route is never mistaken for an API path", () => {
    const response = request("/some-app-route", { host: "brandthread.app", accept: "text/html" });

    expect(response.headers["content-type"]).not.toContain("application/json");
  });
});