import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

it("reconciles column pins into one idempotent, three-pin table model", async () => {
  const fixture = `pin_model_${randomUUID().replaceAll("-", "")}`;
  const rollback = new Error("rollback isolated migration fixture");
  const migration = readFileSync(new URL("../../../../../lib/db/migrations/302_reconcile_post_pins.sql", import.meta.url), "utf8");
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`CREATE SCHEMA "${fixture}"; SET LOCAL search_path TO "${fixture}";
        CREATE TABLE posts (id uuid PRIMARY KEY, user_id text, post_status text, pinned_at timestamp);
        CREATE TABLE post_pins (post_id uuid PRIMARY KEY, user_id text, pinned_at timestamp NOT NULL);
        CREATE INDEX posts_user_pinned_idx ON posts (user_id, pinned_at);
        INSERT INTO posts VALUES
          ('00000000-0000-0000-0000-000000000001','fixture','published','2026-01-01'),
          ('00000000-0000-0000-0000-000000000002','fixture','published','2026-01-02'),
          ('00000000-0000-0000-0000-000000000003','fixture','published','2026-01-03'),
          ('00000000-0000-0000-0000-000000000004','fixture','published',NULL);
        INSERT INTO post_pins VALUES
          ('00000000-0000-0000-0000-000000000003','fixture','2026-01-05'),
          ('00000000-0000-0000-0000-000000000004','fixture','2026-01-04');`));
      await tx.execute(sql.raw(migration));
      await tx.execute(sql.raw(migration));
      const pins = await tx.execute(sql.raw("SELECT post_id, user_id, pinned_at FROM post_pins ORDER BY pinned_at DESC"));
      expect(pins.rows.map((row) => row.post_id)).toEqual([
        "00000000-0000-0000-0000-000000000003",
        "00000000-0000-0000-0000-000000000004",
        "00000000-0000-0000-0000-000000000002",
      ]);
      expect(pins.rows.every((row) => row.user_id === "fixture")).toBe(true);
      expect(new Date(pins.rows[0].pinned_at as string).toISOString()).toBe("2026-01-05T00:00:00.000Z");
      const column = await tx.execute(sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = ${fixture} AND table_name = 'posts' AND column_name = 'pinned_at'`);
      expect(column.rows).toEqual([]);
      const posts = await tx.execute(sql.raw("SELECT count(*)::int AS total FROM posts"));
      expect(posts.rows[0].total).toBe(4);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});
