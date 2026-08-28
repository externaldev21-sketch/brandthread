import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  classifyNetworkError,
  dismissNetworkNotice,
  getNetworkNotice,
  reportNetworkError,
} from "../../../../mobile/lib/networkNotice.ts";

beforeEach(() => {
  dismissNetworkNotice();
});

describe("mobile API errors", () => {
  it("extracts the standardized API envelope", () => {
    const error = new ApiError(403, JSON.stringify({
      error: {
        code: "ROLE_REQUIRED",
        message: "Owner access is required.",
        details: { requiredRole: "owner" },
      },
      requestId: "request-42",
    }));

    expect(error.message).toBe("API 403: Owner access is required.");
    expect(error.code).toBe("ROLE_REQUIRED");
    expect(error.details).toEqual({ requiredRole: "owner" });
    expect(error.requestId).toBe("request-42");
    expect(classifyNetworkError(error)).toBeNull();
  });

  it("keeps non-JSON proxy failures readable and classifies server errors", () => {
    const error = new ApiError(502, "<html>Bad gateway</html>");
    expect(error.message).toBe("API 502: <html>Bad gateway</html>");
    expect(error.code).toBeUndefined();
    expect(classifyNetworkError(error)).toBe("server");
  });

  it("classifies rejected fetches as offline and preserves GET retry actions", () => {
    const retry = vi.fn();
    reportNetworkError(new TypeError("Network request failed"), retry);

    expect(getNetworkNotice()).toMatchObject({
      kind: "offline",
      retry,
      retrying: false,
    });
  });
});