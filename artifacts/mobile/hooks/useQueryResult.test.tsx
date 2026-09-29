import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it } from "vitest";

import { useQueryResult, type QueryResult } from "./useQueryResult";

type HookResult = QueryResult<number[]>;

function HookConsumer({
  fetcher,
  onUpdate,
}: {
  fetcher: () => Promise<number[]>;
  onUpdate: (result: HookResult) => void;
}) {
  onUpdate(useQueryResult(fetcher, [fetcher]));
  return null;
}

async function renderConsumer(
  fetcher: () => Promise<number[]>,
  onUpdate: (result: HookResult) => void,
) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<HookConsumer fetcher={fetcher} onUpdate={onUpdate} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}

describe("useQueryResult", () => {
  let renderers: ReactTestRenderer[] = [];

  afterEach(async () => {
    await act(async () => {
      renderers.forEach((renderer) => renderer.unmount());
      renderers = [];
    });
  });

  it("resolves to 'loaded' on a successful non-empty fetch — never collapses to zero on success", async () => {
    let latest!: HookResult;
    renderers.push(
      await renderConsumer(
        () => Promise.resolve([1, 2, 3]),
        (r) => { latest = r; },
      ),
    );
    expect(latest.status).toBe("loaded");
    if (latest.status === "loaded") expect(latest.data).toEqual([1, 2, 3]);
  });

  it("resolves to 'empty' (not 'unavailable') when the fetch succeeds with nothing", async () => {
    let latest!: HookResult;
    renderers.push(
      await renderConsumer(
        () => Promise.resolve([]),
        (r) => { latest = r; },
      ),
    );
    expect(latest.status).toBe("empty");
  });

  it("resolves to 'unavailable' — never 'empty' or a fabricated zero — when the fetch rejects", async () => {
    let latest!: HookResult;
    renderers.push(
      await renderConsumer(
        () => Promise.reject(new Error("network down")),
        (r) => { latest = r; },
      ),
    );
    expect(latest.status).toBe("unavailable");
    expect(latest.status === "unavailable" && latest.data).toBeUndefined();
  });

  it("retry() re-runs the fetcher and can recover from 'unavailable' to 'loaded'", async () => {
    let shouldFail = true;
    const fetcher = () =>
      shouldFail ? Promise.reject(new Error("down")) : Promise.resolve([9]);
    let latest!: HookResult;
    renderers.push(
      await renderConsumer(fetcher, (r) => { latest = r; }),
    );
    expect(latest.status).toBe("unavailable");

    shouldFail = false;
    await act(async () => {
      latest.retry();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.status).toBe("loaded");
  });
});
