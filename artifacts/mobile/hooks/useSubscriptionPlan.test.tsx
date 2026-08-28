import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const { statusMock, api } = vi.hoisted(() => {
  const status = vi.fn();
  return {
    statusMock: status,
    api: {
      seller: {
        subscription: {
          status,
        },
      },
    },
  };
});

vi.mock("@/lib/api", () => ({
  useApi: () => api,
}));

import {
  invalidatePlanCache,
  useSubscriptionPlan,
  type PlanId,
} from "./useSubscriptionPlan";

type HookResult = ReturnType<typeof useSubscriptionPlan>;

function HookConsumer({
  onUpdate,
}: {
  onUpdate: (result: HookResult) => void;
}) {
  onUpdate(useSubscriptionPlan());
  return null;
}

function resolvedStatus(plan: PlanId) {
  return Promise.resolve({ plan });
}

async function renderConsumer(onUpdate: (result: HookResult) => void) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<HookConsumer onUpdate={onUpdate} />);
    await Promise.resolve();
  });
  return renderer;
}

describe("useSubscriptionPlan invalidation", () => {
  let renderers: ReactTestRenderer[] = [];

  beforeEach(() => {
    statusMock.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      renderers.forEach((renderer) => renderer.unmount());
      renderers = [];
    });
    invalidatePlanCache();
  });

  it("registers a listener on mount and re-fetches after invalidation", async () => {
    statusMock.mockReturnValueOnce(resolvedStatus("starter"));
    let latest!: HookResult;

    renderers.push(
      await renderConsumer((result) => {
        latest = result;
      }),
    );
    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(latest.plan).toBe("starter");
    expect(latest.hasPlan("growth")).toBe(false);

    statusMock.mockReturnValueOnce(resolvedStatus("growth"));
    await act(async () => {
      invalidatePlanCache();
      await Promise.resolve();
    });

    expect(statusMock).toHaveBeenCalledTimes(2);
    expect(latest.plan).toBe("growth");
    expect(latest.hasPlan("growth")).toBe(true);
  });

  it("deregisters its listener on unmount", async () => {
    statusMock.mockReturnValueOnce(resolvedStatus("starter"));
    const renderer = await renderConsumer(() => {});
    renderers.push(renderer);
    expect(statusMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer.unmount();
    });
    renderers = [];

    statusMock.mockReturnValueOnce(resolvedStatus("growth"));
    await act(async () => {
      invalidatePlanCache();
      await Promise.resolve();
    });

    expect(statusMock).toHaveBeenCalledTimes(1);
  });

  it("resets the module cache and updates every active consumer", async () => {
    statusMock.mockReturnValueOnce(resolvedStatus("starter"));
    let first!: HookResult;
    let second!: HookResult;

    renderers.push(
      await renderConsumer((result) => {
        first = result;
      }),
    );
    renderers.push(
      await renderConsumer((result) => {
        second = result;
      }),
    );
    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(first.plan).toBe("starter");
    expect(second.plan).toBe("starter");

    statusMock.mockReturnValueOnce(resolvedStatus("pro"));
    await act(async () => {
      invalidatePlanCache();
      await Promise.resolve();
    });

    expect(statusMock).toHaveBeenCalledTimes(2);
    expect(first.plan).toBe("pro");
    expect(second.plan).toBe("pro");
    expect(first.hasPlan("growth")).toBe(true);
    expect(second.hasPlan("pro")).toBe(true);
  });
});
