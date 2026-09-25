import {
  CLERK_ID_REFERENCE_COLUMNS,
  MANUFACTURER_NAME_PATTERNS,
  NON_DELETABLE_TABLES,
  PRODUCTION_EMAIL_EXCLUSION_PATTERN,
  TEST_EMAIL_TLD_PATTERN,
} from "./signatures";

/** Minimal query surface this engine needs — satisfied by pg.Pool, pg.Client
 * and pg.PoolClient alike, and easy to fake in unit tests. */
export interface QueryRunner {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface PurgeTableResult {
  table: string;
  matched: number;
}

export interface PurgeResult {
  tables: PurgeTableResult[];
  totalMatched: number;
}

interface ColumnInfo {
  table: string;
  column: string;
  dataType: string;
}

const TEXTUAL_TYPES = new Set(["text", "character varying", "character", "citext"]);
function isTextual(col: ColumnInfo): boolean {
  return TEXTUAL_TYPES.has(col.dataType);
}

interface FkEdge {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
}

async function introspectColumns(db: QueryRunner): Promise<Map<string, ColumnInfo[]>> {
  const { rows } = await db.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const byTable = new Map<string, ColumnInfo[]>();
  for (const row of rows) {
    const table = row.table_name as string;
    const list = byTable.get(table) ?? [];
    list.push({ table, column: row.column_name as string, dataType: row.data_type as string });
    byTable.set(table, list);
  }
  return byTable;
}

async function introspectForeignKeys(db: QueryRunner): Promise<FkEdge[]> {
  const { rows } = await db.query(`
    SELECT
      tc.table_name AS child_table,
      kcu.column_name AS child_column,
      ccu.table_name AS parent_table,
      ccu.column_name AS parent_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);
  return rows
    .map((row) => ({
      childTable: row.child_table as string,
      childColumn: row.child_column as string,
      parentTable: row.parent_table as string,
      parentColumn: row.parent_column as string,
    }))
    .filter((edge) => edge.parentColumn === "id" && edge.childTable !== edge.parentTable);
}

function addAll(set: Set<string>, values: Iterable<string>): boolean {
  let changed = false;
  for (const value of values) {
    if (!set.has(value)) {
      set.add(value);
      changed = true;
    }
  }
  return changed;
}

function topoSortChildFirst(tables: string[], fkEdges: FkEdge[]): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const edge of fkEdges) {
    const list = childrenOf.get(edge.parentTable) ?? [];
    list.push(edge.childTable);
    childrenOf.set(edge.parentTable, list);
  }
  const tableSet = new Set(tables);
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  function visit(table: string) {
    if (!tableSet.has(table) || visited.has(table) || visiting.has(table)) return;
    visiting.add(table);
    for (const child of childrenOf.get(table) ?? []) visit(child);
    visiting.delete(table);
    visited.add(table);
    order.push(table);
  }
  for (const table of tables) visit(table);
  return order;
}

/**
 * Finds every row fabricated by the api-server test suite by:
 *  1. anchoring on `users` rows whose email uses a test-reserved TLD (or a
 *     moneyHarness clerkId prefix), and `manufacturers` rows whose name
 *     matches the harness's naming convention;
 *  2. expanding that set to a fixed point through (a) text columns that are
 *     logically a foreign key to `users.clerk_id` (owner_id, buyer_id, ...)
 *     and (b) real Postgres foreign keys, discovered via information_schema
 *     rather than hardcoded, so new tables are covered automatically;
 *  3. deleting (or, in dry-run mode, counting) the matched rows in a
 *     dependents-first order so real FK constraints never block a delete.
 *
 * Every step only ever matches on these explicit, test-only signatures —
 * nothing here inspects "does this look fake", so real users/products can
 * never be swept up by accident.
 */
export async function purgeTestData(db: QueryRunner, opts: { dryRun: boolean }): Promise<PurgeResult> {
  const columnsByTable = await introspectColumns(db);
  const fkEdges = await introspectForeignKeys(db);
  const hasId = (table: string) => (columnsByTable.get(table) ?? []).some((c) => c.column === "id");
  const hasColumn = (table: string, column: string) =>
    (columnsByTable.get(table) ?? []).some((c) => c.column === column);

  const matchedClerkIds = new Set<string>();
  const doomed = new Map<string, Set<string>>();

  // ── Anchors ──────────────────────────────────────────────────────────────
  if (columnsByTable.has("users") && hasColumn("users", "email") && hasColumn("users", "clerk_id")) {
    const { rows } = await db.query(
      `SELECT id, clerk_id FROM "users" WHERE email ~* $1 AND email !~* $2`,
      [TEST_EMAIL_TLD_PATTERN, PRODUCTION_EMAIL_EXCLUSION_PATTERN],
    );
    doomed.set("users", new Set(rows.map((r) => r.id as string)));
    addAll(matchedClerkIds, rows.map((r) => r.clerk_id as string).filter(Boolean));
  }

  if (columnsByTable.has("manufacturers") && hasColumn("manufacturers", "business_name") && hasId("manufacturers")) {
    const { rows } = await db.query(
      `SELECT id FROM "manufacturers" WHERE business_name ~ $1 OR business_name ~ $2`,
      MANUFACTURER_NAME_PATTERNS,
    );
    const set = doomed.get("manufacturers") ?? new Set<string>();
    addAll(set, rows.map((r) => r.id as string));
    doomed.set("manufacturers", set);
  }

  for (const [table, cols] of columnsByTable) {
    if (table === "users" || !hasId(table)) continue;
    for (const col of cols) {
      if (!col.column.includes("email") || !isTextual(col)) continue;
      const { rows } = await db.query(`SELECT id FROM "${table}" WHERE "${col.column}" ~* $1`, [
        TEST_EMAIL_TLD_PATTERN,
      ]);
      if (!rows.length) continue;
      const set = doomed.get(table) ?? new Set<string>();
      addAll(set, rows.map((r) => r.id as string));
      doomed.set(table, set);
    }
  }

  // ── Fixed-point expansion ───────────────────────────────────────────────
  let changed = true;
  while (changed) {
    changed = false;

    if (matchedClerkIds.size) {
      for (const [table, cols] of columnsByTable) {
        if (!hasId(table)) continue;
        for (const col of cols) {
          if (!CLERK_ID_REFERENCE_COLUMNS.includes(col.column)) continue;
          const { rows } = await db.query(`SELECT id FROM "${table}" WHERE "${col.column}" = ANY($1)`, [
            [...matchedClerkIds],
          ]);
          if (!rows.length) continue;
          const set = doomed.get(table) ?? new Set<string>();
          if (addAll(set, rows.map((r) => r.id as string))) changed = true;
          doomed.set(table, set);
        }
      }
    }

    for (const edge of fkEdges) {
      const parentIds = doomed.get(edge.parentTable);
      if (!parentIds?.size || !hasId(edge.childTable)) continue;
      const { rows } = await db.query(
        `SELECT id FROM "${edge.childTable}" WHERE "${edge.childColumn}"::text = ANY($1::text[])`,
        [[...parentIds]],
      );
      if (!rows.length) continue;
      const set = doomed.get(edge.childTable) ?? new Set<string>();
      if (addAll(set, rows.map((r) => r.id as string))) changed = true;
      doomed.set(edge.childTable, set);
    }
  }

  // ── Build one match predicate per table (covers id-less join tables too) ─
  const predicates = new Map<string, { where: string; params: unknown[] }>();
  for (const [table, cols] of columnsByTable) {
    if (NON_DELETABLE_TABLES.includes(table)) continue;
    const parts: string[] = [];
    const params: unknown[] = [];

    const doomedIds = doomed.get(table);
    if (hasId(table) && doomedIds?.size) {
      params.push([...doomedIds]);
      parts.push(`"id"::text = ANY($${params.length}::text[])`);
    }
    if (matchedClerkIds.size) {
      for (const col of cols) {
        if (!CLERK_ID_REFERENCE_COLUMNS.includes(col.column)) continue;
        params.push([...matchedClerkIds]);
        parts.push(`"${col.column}" = ANY($${params.length})`);
      }
    }
    for (const edge of fkEdges) {
      if (edge.childTable !== table) continue;
      const parentIds = doomed.get(edge.parentTable);
      if (!parentIds?.size) continue;
      params.push([...parentIds]);
      parts.push(`"${edge.childColumn}"::text = ANY($${params.length}::text[])`);
    }
    if (table === "manufacturers") {
      params.push(...MANUFACTURER_NAME_PATTERNS);
      parts.push(`(business_name ~ $${params.length - 1} OR business_name ~ $${params.length})`);
    } else if (table === "users") {
      params.push(TEST_EMAIL_TLD_PATTERN, PRODUCTION_EMAIL_EXCLUSION_PATTERN);
      parts.push(`(email ~* $${params.length - 1} AND email !~* $${params.length})`);
    } else {
      for (const col of cols) {
        if (!col.column.includes("email") || !isTextual(col)) continue;
        params.push(TEST_EMAIL_TLD_PATTERN);
        parts.push(`"${col.column}" ~* $${params.length}`);
      }
    }

    if (parts.length) predicates.set(table, { where: parts.join(" OR "), params });
  }

  const order = topoSortChildFirst([...predicates.keys()], fkEdges);
  const results: PurgeTableResult[] = [];
  for (const table of order) {
    const predicate = predicates.get(table)!;
    if (opts.dryRun) {
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${predicate.where}`, predicate.params);
      results.push({ table, matched: Number(rows[0]?.n ?? 0) });
    } else {
      const { rowCount } = await db.query(`DELETE FROM "${table}" WHERE ${predicate.where}`, predicate.params);
      results.push({ table, matched: rowCount ?? 0 });
    }
  }

  const nonEmpty = results.filter((r) => r.matched > 0);
  return { tables: nonEmpty, totalMatched: nonEmpty.reduce((sum, r) => sum + r.matched, 0) };
}
