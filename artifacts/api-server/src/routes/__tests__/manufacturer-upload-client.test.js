import { afterEach, describe, expect, it, vi } from "vitest";
import { File } from "node:buffer";
import { uploadManufacturerThreadAttachment } from "../../../../../lib/api-client-react/src/generated/api.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generated manufacturer attachment upload", () => {
  for (const mediaType of ["image/jpeg", "image/png", "application/pdf"]) {
    it(`sends the concrete ${mediaType} Blob type`, async () => {
      const body = new File([new Uint8Array([1, 2, 3])], "attachment", { type: mediaType });
      const fetchMock = vi.fn(async (_input, init) => {
        expect(init?.body).toBe(body);
        expect(new Headers(init?.headers).get("content-type")).toBe(mediaType);
        return new Response(JSON.stringify({ objectPath: "/objects/uploads/test" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      await uploadManufacturerThreadAttachment("thread-id", body);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  }
});