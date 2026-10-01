// Builds dist-loadtest/index.mjs: the real API with Clerk swapped for a header-based stub.
// Usage: node loadtest/build.mjs   (run from artifacts/api-server)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { rm } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "dist-loadtest");
await rm(out, { recursive: true, force: true });

await build({
  entryPoints: [path.join(root, "src/index.ts")],
  platform: "node", bundle: true, format: "esm", outdir: out,
  outExtension: { ".js": ".mjs" }, logLevel: "warning",
  alias: { "@clerk/express": path.join(root, "loadtest/clerk-stub.ts") },
  external: ["*.node", "sharp", "pdfkit", "fontkit", "brotli", "@sentry/node", "@google-cloud/*", "@aws-sdk/*",
    "@opentelemetry/*", "@clerk/backend", "pg-native", "@replit/*", "pino-pretty", "thread-stream", "pino", "pino-http"],
  banner: { js: `import { createRequire as __r } from 'node:module';
import __p from 'node:path'; import __u from 'node:url';
globalThis.require = __r(import.meta.url);
globalThis.__filename = __u.fileURLToPath(import.meta.url);
globalThis.__dirname = __p.dirname(globalThis.__filename);` },
});
console.log("built", out);
