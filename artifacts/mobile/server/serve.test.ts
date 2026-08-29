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