---
name: DB package project references
description: Why new exports from lib/db aren't visible to api-server TypeScript until you rebuild.
---

## The problem
`lib/db` uses TypeScript project references (`composite: true`, `emitDeclarationOnly: true`, `outDir: dist`). When you add a new export to `lib/db/src/schema/index.ts`, the api-server TypeScript checker reads the compiled declaration files in `lib/db/dist/`, not the source. Until you rebuild, new exports produce `Module '"@workspace/db"' has no exported member 'X'`.

## Fix
```bash
cd lib/db && npx tsc --build
```
Run this whenever new tables/exports are added to lib/db before running `tsc --noEmit` on api-server.

## Runtime is fine
At runtime, api-server uses `tsx` which compiles on the fly from source — so the server runs correctly even without the explicit build step. The TypeScript check is the only thing that needs the build output.

**Why:** The `exports` field in `lib/db/package.json` points to `./src/index.ts` for runtime, but the TypeScript project reference resolution uses the declared output directory (`dist`).
