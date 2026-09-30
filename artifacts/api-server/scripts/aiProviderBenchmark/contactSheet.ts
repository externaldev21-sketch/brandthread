import fs from "node:fs";
import path from "node:path";
import type { BenchmarkRunResult } from "../../src/lib/aiImageProviders/types";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function tile(r: BenchmarkRunResult): string {
  const mockBadge = r.mock ? `<span class="badge mock">MOCK</span>` : "";
  const img = r.ok && r.outputPath
    ? `<img src="${escapeHtml(r.outputPath)}" alt="${escapeHtml(r.case.id)}" />`
    : `<div class="err">FAILED<br/>${escapeHtml(r.error || "unknown error")}</div>`;
  return `
    <div class="tile ${r.ok ? "" : "tile-error"}">
      ${img}
      <div class="meta">
        <div class="row"><strong>${escapeHtml(r.case.garment)}</strong> · ${escapeHtml(r.case.referenceStyle)}</div>
        <div class="row">${escapeHtml(r.pipeline)} — ${escapeHtml(r.providers.join(" + "))} ${mockBadge}</div>
        <div class="row">$${r.costUsd.toFixed(3)} · ${r.latencyMs}ms</div>
      </div>
    </div>`;
}

export function writeContactSheet(results: BenchmarkRunResult[], outDir: string): string {
  const byPipeline = {
    "single-stage": results.filter((r) => r.pipeline === "single-stage"),
    "two-stage": results.filter((r) => r.pipeline === "two-stage"),
  };
  const anyMock = results.some((r) => r.mock);

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>AI provider benchmark — contact sheet</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; background: #0b0b0b; color: #f2f2f2; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 32px 0 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.04em; }
  p.note { opacity: 0.65; font-size: 13px; max-width: 720px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
  .tile { background: #161616; border-radius: 10px; overflow: hidden; border: 1px solid #2a2a2a; }
  .tile-error { border-color: #5a1f1f; }
  .tile img { width: 100%; aspect-ratio: 3/4; object-fit: cover; display: block; background: #222; }
  .tile .err { aspect-ratio: 3/4; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; color: #ff8a8a; padding: 8px; }
  .meta { padding: 8px 10px 10px; font-size: 12px; line-height: 1.5; }
  .row { opacity: 0.85; }
  .badge { display: inline-block; background: #8a5a00; color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 4px; margin-left: 4px; }
</style>
</head>
<body>
  <h1>AI image-provider benchmark — contact sheet</h1>
  <p class="note">
    5 garments × 3 reference styles, pipeline A (single-stage) vs pipeline B
    (two-stage: creative scene → garment-locked composite). Generated ${new Date().toISOString()}.
    ${anyMock ? "<strong>This run used --mock placeholder data (badged MOCK below) to verify the pipeline and this contact sheet render correctly — it is not a real quality benchmark.</strong>" : ""}
  </p>
  <h2>Pipeline A — single-stage</h2>
  <div class="grid">${byPipeline["single-stage"].map(tile).join("")}</div>
  <h2>Pipeline B — two-stage</h2>
  <div class="grid">${byPipeline["two-stage"].map(tile).join("")}</div>
</body>
</html>`;

  const outPath = path.join(outDir, "contact-sheet.html");
  fs.writeFileSync(outPath, html);
  return outPath;
}
