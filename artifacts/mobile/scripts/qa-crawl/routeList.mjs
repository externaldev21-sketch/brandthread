#!/usr/bin/env node
/**
 * Enumerates every statically-known Expo Router route file under app/ and
 * turns it into a route path, substituting real seeded IDs for dynamic
 * segments ([id], [productId], etc.) so the crawler visits pages that
 * actually render content instead of an empty/not-found state.
 *
 * Expo Router conventions handled:
 *   - Route groups in parens, e.g. (buyer)/index.tsx -> /(buyer) and also a
 *     "de-grouped" alias without the group segment for roles where the group
 *     is the active navigator root (Expo Router's actual runtime behavior is
 *     that a route group does NOT appear in the URL at all -- (buyer)/cart.tsx
 *     is served at /cart, not /(buyer)/cart. We therefore emit BOTH forms
 *     defensively; the crawler will just get a redirect/no-op for whichever
 *     one Expo Router doesn't recognize.)
 *   - index.tsx -> parent directory path (or / for app/index.tsx)
 *   - Dynamic segments [param].tsx -> substituted from --ids JSON
 *   - Skips: _layout.tsx, +not-found.tsx, +html.tsx, *.test.ts(x)
 *
 * Usage:
 *   node routeList.mjs --ids ids.json > routes.json
 *
 * ids.json shape (all optional, sensible fallbacks used when absent):
 *   {
 *     "productId": "...", "collectionId": "...", "dropId": "...",
 *     "username": "...", "id": "...", "orderId": "..."
 *   }
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "../../app");

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { ids: {} };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ids") {
      const raw = fs.readFileSync(args[++i], "utf8");
      opts.ids = JSON.parse(raw);
    }
  }
  return opts;
}

const SKIP_RE = /^\+|^_layout\.tsx?$|\.test\.tsx?$|\.web\.tsx?$|\.native\.tsx?$/;

function walk(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...walk(path.join(dir, entry.name), `${base}/${entry.name}`));
    } else if (/\.tsx?$/.test(entry.name) && !SKIP_RE.test(entry.name)) {
      out.push(`${base}/${entry.name}`);
    }
  }
  return out;
}

function fileToRoutePaths(relFile, ids) {
  // relFile like /(buyer)/cart.tsx or /store/product/[productId].tsx or /index.tsx
  let p = relFile.replace(/\.tsx?$/, "");
  const segments = p.split("/").filter(Boolean);
  const built = []; // array of arrays (alternatives per segment when a group)
  for (const seg of segments) {
    if (seg === "index") continue; // handled below
    if (/^\(.*\)$/.test(seg)) {
      // route group -- does not appear in the URL, but we ALSO keep the
      // grouped form as a defensive alternate since some Expo Router
      // versions/configs do resolve it.
      built.push({ group: seg });
    } else if (/^\[\.\.\..*\]$/.test(seg)) {
      built.push({ literal: "1" }); // catch-all: at least one dummy segment
    } else if (/^\[.*\]$/.test(seg)) {
      const param = seg.slice(1, -1).replace(/^\.\.\./, "");
      const val = ids[param] || ids.id || ids.productId || "qa-seed";
      built.push({ literal: String(val), param });
    } else {
      built.push({ literal: seg });
    }
  }
  const isIndex = segments[segments.length - 1] === "index";

  const ungroup = built.filter((s) => !s.group).map((s) => s.literal);
  const withgroup = built.map((s) => (s.group ? s.group : s.literal));

  const pathA = "/" + ungroup.join("/");
  const pathB = "/" + withgroup.join("/");

  const results = new Set();
  results.add(pathA === "/" ? "/" : pathA.replace(/\/+$/, "") || "/");
  results.add(pathB === "/" ? "/" : pathB.replace(/\/+$/, "") || "/");
  if (isIndex) {
    // Also add without trailing nothing (already handled since index segment
    // dropped above), nothing more to do.
  }
  return [...results].filter(Boolean);
}

function main() {
  const opts = parseArgs();
  const files = walk(APP_DIR);
  const routes = new Map(); // route -> source file
  for (const f of files) {
    for (const r of fileToRoutePaths(f, opts.ids)) {
      if (!routes.has(r)) routes.set(r, f);
    }
  }
  const out = [...routes.entries()]
    .map(([route, file]) => ({ route, file }))
    .sort((a, b) => a.file.localeCompare(b.file));
  process.stdout.write(JSON.stringify(out, null, 2));
}

main();
