import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts"), path.resolve(artifactDir, "src/worker.ts"), path.resolve(artifactDir, "src/bgRemovalWorker.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      // native runtime for the self-hosted background-removal model (lib/bgRemoval)
      "onnxruntime-node",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      // Resolved from node_modules at runtime so its OpenTelemetry dependencies
      // (also external above) load from its own pnpm directory.
      "@sentry/node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
      // pdfkit's font handling (fontkit -> brotli) does dynamic requires
      // (e.g. @swc/helpers) that esbuild's bundling breaks at runtime.
      "pdfkit",
      "fontkit",
      "brotli",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

// Downloads the background-removal model next to the build so the first
// request after a deploy doesn't wait on it. Non-fatal: the server falls back
// to downloading it on first use (lib/bgRemoval/segmenter.ts).
async function prefetchBgRemovalModel() {
  if (process.env.BG_REMOVAL_SKIP_PREFETCH === "1") return;
  try {
    const { ensureBgModel, bgModelName } = await import("./dist/bgRemovalWorker.mjs");
    const started = Date.now();
    const file = await ensureBgModel();
    process.stdout.write(`${JSON.stringify({ level: "info", msg: "Background-removal model ready", model: bgModelName(), file, ms: Date.now() - started })}\n`);
  } catch (err) {
    process.stderr.write(`${JSON.stringify({ level: "warn", msg: "Background-removal model prefetch failed; it will download on first use", err: String(err) })}\n`);
  }
}

buildAll().then(prefetchBgRemovalModel).catch((err) => {
  const error = err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : { message: "Unknown build failure" };
  process.stderr.write(`${JSON.stringify({ level: "error", msg: "API build failed", err: error })}\n`);
  process.exit(1);
});
