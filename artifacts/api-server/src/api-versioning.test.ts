import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "./app";

describe("API versioning", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("serves the current API under /api/v1", async () => {
    const response = await fetch(`${baseUrl}/api/v1/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-brandthread-api-version")).toBe("1");
    expect(response.headers.get("deprecation")).toBeNull();
  });

  it("keeps the legacy /api route available with migration headers", async () => {
    const response = await fetch(`${baseUrl}/api/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-brandthread-api-version")).toBe("1");
    expect(response.headers.get("deprecation")).toBe("true");
    expect(response.headers.get("link")).toContain("/api/v1/healthz");
  });
});