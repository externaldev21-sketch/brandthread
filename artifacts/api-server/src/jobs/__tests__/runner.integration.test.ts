import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { createJobRunner } from "../runner";

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe("job runner against Postgres advisory locks", () => {
  it("two instances on separate connections never run the same job at once", async () => {
    // Each runner opens its own dedicated lock connection, like two replicas.
    const a = createJobRunner({ log: log() });
    const b = createJobRunner({ log: log() });
    const name = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const started = vi.fn();

    const first = a.runOnce(name, async () => { started(); await gate; });
    await vi.waitFor(() => expect(started).toHaveBeenCalledTimes(1));

    const lockRows = await db.execute(sql`
      SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = (hashtext(${`job:${name}`}) & x'ffffffff'::bigint)::oid
    `);
    expect((lockRows as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);

    const second = vi.fn();
    expect(await b.runOnce(name, second)).toBe("skipped_locked");
    expect(second).not.toHaveBeenCalled();

    release();
    expect(await first).toBe("ran");
    expect(await b.runOnce(name, second)).toBe("ran");
    expect(second).toHaveBeenCalledTimes(1);

    await a.close();
    await b.close();
  });
});
