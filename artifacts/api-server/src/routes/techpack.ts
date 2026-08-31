import { Router } from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
import { requireAuth } from "../middlewares/requireAuth";
import { generateText } from "@workspace/integrations-openai-ai-server/text";

const router = Router();
router.use(requireAuth);

// Tech pack generation is heavier (text + PDF render); keep the limit tighter.
const MAX_PHOTOS = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per photo
const MAX_TOTAL_BYTES = 30 * 1024 * 1024; // 30MB across all photos
const MAX_TEXT_FIELD = 1000;

const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;

function decodeDataUrl(input: string): { buffer: Buffer; mime: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/]+=*)$/.exec(input);
  if (!match) return null;
  const [, mime, base64] = match;
  if (!base64 || !BASE64_RE.test(base64)) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    return buffer.length > 0 ? { buffer, mime } : null;
  } catch {
    return null;
  }
}

function sanitizeText(value: unknown, maxLen = MAX_TEXT_FIELD): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

interface SizeRow {
  point: string;
  values: Record<string, string>;
}

function sanitizeSizeChart(input: unknown): { sizes: string[]; rows: SizeRow[] } {
  if (!input || typeof input !== "object") return { sizes: [], rows: [] };
  const obj = input as any;
  const rawSizes: string[] = Array.isArray(obj.sizes)
    ? obj.sizes
        .filter((s: unknown) => typeof s === "string")
        .map((s: string) => s.trim().slice(0, 20))
        .filter((s: string) => s.length > 0)
    : [];
  // De-dupe while preserving order, then cap the column count.
  const sizes = [...new Set(rawSizes)].slice(0, 10);

  const rawRows: SizeRow[] = Array.isArray(obj.rows)
    ? obj.rows
        .map((r: any) => {
          const values: Record<string, string> = {};
          if (r && typeof r.values === "object") {
            for (const size of sizes) {
              const v = r.values[size];
              values[size] = typeof v === "string" ? v.trim().slice(0, 20) : "";
            }
          }
          return { point: sanitizeText(r?.point, 60), values };
        })
        .filter((r: SizeRow) => r.point.length > 0)
    : [];
  const rows = rawRows.slice(0, 20);
  return { sizes, rows };
}

interface TechPackContent {
  overview: string;
  construction: string;
  materialsAndTrims: string;
  printPlacement: string;
  careInstructions: string;
  packaging: string;
}

async function generateTechPackContent(input: {
  productName: string;
  brandName: string;
  category: string;
  season: string;
  description: string;
  colorways: string[];
  materialsNotes: string;
  printPlacementNotes: string;
  careNotes: string;
}): Promise<TechPackContent> {
  const systemPrompt =
    "You are a senior fashion technical designer who writes professional tech pack documentation sent from clothing brand owners to their manufacturers/factories. Given raw notes from a brand owner (which may be sparse or informal), produce polished, precise, manufacturer-ready copy for each tech pack section. Be specific and technical where possible (stitch types, seam allowances, standard care symbols, standard packaging conventions) while staying faithful to what the brand owner actually specified. Do not invent contradictory details. If a section has no input, write reasonable, industry-standard defaults for the given category, clearly generic. Respond with strict JSON only, matching this shape: { \"overview\": string, \"construction\": string, \"materialsAndTrims\": string, \"printPlacement\": string, \"careInstructions\": string, \"packaging\": string }. Each field should be 2-6 sentences or a short bullet-style list joined with newlines, appropriate for a formal manufacturer document.";

  const userPrompt = JSON.stringify(input);

  const raw = await generateText(systemPrompt, userPrompt, { responseFormatJson: true });
  let parsed: Partial<TechPackContent> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  return {
    overview: sanitizeText(parsed.overview, 2000) || "No overview provided.",
    construction: sanitizeText(parsed.construction, 2000) || "Standard construction per category norms.",
    materialsAndTrims: sanitizeText(parsed.materialsAndTrims, 2000) || "Materials and trims as specified by brand.",
    printPlacement: sanitizeText(parsed.printPlacement, 2000) || "No print or embroidery specified.",
    careInstructions: sanitizeText(parsed.careInstructions, 2000) || "Follow standard care for garment fabric type.",
    packaging: sanitizeText(parsed.packaging, 2000) || "Individually poly-bagged with hang tag attached.",
  };
}

function buildPdf(opts: {
  brandName: string;
  productName: string;
  category: string;
  season: string;
  styleNumber: string;
  colorways: string[];
  sizeChart: { sizes: string[]; rows: SizeRow[] };
  content: TechPackContent;
  photoFiles: string[];
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

    // Cover / header
    doc.fontSize(22).fillColor("#111").text(opts.brandName || "Brand", { continued: false });
    doc.moveDown(0.2);
    doc.fontSize(16).fillColor("#444").text("Technical Design Pack");
    doc.moveDown(0.6);
    doc.fontSize(10).fillColor("#666");
    doc.text(`Style: ${opts.productName || "Untitled Style"}`);
    doc.text(`Style #: ${opts.styleNumber || "TBD"}`);
    doc.text(`Category: ${opts.category || "N/A"}`);
    doc.text(`Season: ${opts.season || "N/A"}`);
    doc.text(`Date: ${today}`);
    doc.moveDown(1);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#ddd").stroke();
    doc.moveDown(1);

    function sectionTitle(title: string) {
      doc.fontSize(13).fillColor("#111").text(title);
      doc.moveDown(0.3);
    }

    function sectionBody(text: string) {
      doc.fontSize(10).fillColor("#333").text(text, { align: "left" });
      doc.moveDown(1);
    }

    sectionTitle("1. Product Overview");
    sectionBody(opts.content.overview);

    sectionTitle("2. Construction Details");
    sectionBody(opts.content.construction);

    sectionTitle("3. Materials & Trims");
    sectionBody(opts.content.materialsAndTrims);

    sectionTitle("4. Print / Embroidery Placement");
    sectionBody(opts.content.printPlacement);

    if (opts.colorways.length > 0) {
      sectionTitle("5. Colorways");
      sectionBody(opts.colorways.join(", "));
    }

    if (opts.sizeChart.sizes.length > 0 && opts.sizeChart.rows.length > 0) {
      sectionTitle("6. Size Chart (inches)");
      const colWidth = 460 / (opts.sizeChart.sizes.length + 1);
      const cellPadding = 4;
      const startX = 48;
      const pageBottom = doc.page.height - doc.page.margins.bottom;

      function rowHeight(cells: string[], fontSize: number): number {
        doc.fontSize(fontSize);
        let max = 0;
        for (const cell of cells) {
          const h = doc.heightOfString(cell || "-", { width: colWidth - cellPadding });
          if (h > max) max = h;
        }
        return Math.max(max, fontSize + 4) + cellPadding * 2;
      }

      const headerCells = ["Measurement", ...opts.sizeChart.sizes];

      function drawHeader() {
        const height = rowHeight(headerCells, 9);
        const y = doc.y;
        doc.fontSize(9).fillColor("#111");
        headerCells.forEach((cell, i) => {
          doc.text(cell || "-", startX + colWidth * i, y, { width: colWidth - cellPadding });
        });
        doc.y = y + height;
        doc.moveTo(startX, doc.y).lineTo(startX + colWidth * (opts.sizeChart.sizes.length + 1), doc.y).strokeColor("#ddd").stroke();
        doc.moveDown(0.3);
      }

      function ensureSpace(height: number) {
        if (doc.y + height > pageBottom) {
          doc.addPage();
          drawHeader();
        }
      }

      function drawRow(cells: string[], opts2: { bold?: boolean; fontSize: number; color: string }) {
        const height = rowHeight(cells, opts2.fontSize);
        ensureSpace(height);
        const y = doc.y;
        doc.fontSize(opts2.fontSize).fillColor(opts2.color);
        cells.forEach((cell, i) => {
          doc.text(cell || "-", startX + colWidth * i, y, { width: colWidth - cellPadding });
        });
        doc.y = y + height;
      }

      drawHeader();

      for (const row of opts.sizeChart.rows) {
        const cells = [row.point, ...opts.sizeChart.sizes.map((size) => row.values[size] || "-")];
        drawRow(cells, { fontSize: 9, color: "#333" });
      }
      doc.moveDown(1);
    }

    const hasSizeChart = opts.sizeChart.sizes.length > 0 && opts.sizeChart.rows.length > 0;
    sectionTitle(`${hasSizeChart ? "7" : "6"}. Care Instructions`);
    sectionBody(opts.content.careInstructions);

    sectionTitle(`${hasSizeChart ? "8" : "7"}. Packaging`);
    sectionBody(opts.content.packaging);

    // Reference photos, one per page for clarity.
    for (const file of opts.photoFiles) {
      doc.addPage();
      doc.fontSize(12).fillColor("#111").text("Reference Photo / Mockup");
      doc.moveDown(0.5);
      try {
        doc.image(file, { fit: [500, 650], align: "center" });
      } catch {
        doc.fontSize(10).fillColor("#900").text("(Image could not be rendered)");
      }
    }

    doc.end();
  });
}

// POST /api/techpack/generate
router.post("/generate", async (req, res) => {
  const body = req.body ?? {};
  const productName = sanitizeText(body.productName, 100);
  const brandName = sanitizeText(body.brandName, 100);
  const category = sanitizeText(body.category, 60);
  const season = sanitizeText(body.season, 60);
  const styleNumber = sanitizeText(body.styleNumber, 40);
  const description = sanitizeText(body.description, MAX_TEXT_FIELD);
  const materialsNotes = sanitizeText(body.materialsNotes, MAX_TEXT_FIELD);
  const printPlacementNotes = sanitizeText(body.printPlacementNotes, MAX_TEXT_FIELD);
  const careNotes = sanitizeText(body.careNotes, MAX_TEXT_FIELD);
  const colorways: string[] = Array.isArray(body.colorways)
    ? body.colorways.filter((c: unknown) => typeof c === "string").slice(0, 10).map((c: string) => c.slice(0, 40))
    : [];
  const sizeChart = sanitizeSizeChart(body.sizeChart);
  const photos: unknown[] = Array.isArray(body.photos) ? body.photos : [];

  if (!productName) {
    res.status(400).json({ error: "A product name is required." });
    return;
  }
  if (photos.length === 0) {
    res.status(400).json({ error: "At least one product photo or mockup is required." });
    return;
  }
  if (photos.length > MAX_PHOTOS) {
    res.status(400).json({ error: `Please upload at most ${MAX_PHOTOS} photos.` });
    return;
  }

  const decodedPhotos: Buffer[] = [];
  let totalBytes = 0;
  for (const photo of photos) {
    if (typeof photo !== "string") {
      res.status(400).json({ error: "Each photo must be a base64-encoded image." });
      return;
    }
    const decoded = decodeDataUrl(photo);
    if (!decoded) {
      res.status(400).json({ error: "One or more photos are not valid images. Please re-upload." });
      return;
    }
    if (decoded.buffer.length > MAX_IMAGE_BYTES) {
      res.status(400).json({ error: "Each photo must be under 8MB." });
      return;
    }
    totalBytes += decoded.buffer.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      res.status(400).json({ error: "Total photo size is too large. Please upload smaller or fewer photos." });
      return;
    }
    decodedPhotos.push(decoded.buffer);
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "techpack-"));
  const tmpFiles: string[] = [];

  try {
    for (const buffer of decodedPhotos) {
      const filePath = path.join(tmpDir, `${randomUUID()}.png`);
      await fs.writeFile(filePath, buffer);
      tmpFiles.push(filePath);
    }

    const content = await generateTechPackContent({
      productName,
      brandName,
      category,
      season,
      description,
      colorways,
      materialsNotes,
      printPlacementNotes,
      careNotes,
    });

    const pdfBuffer = await buildPdf({
      brandName,
      productName,
      category,
      season,
      styleNumber,
      colorways,
      sizeChart,
      content,
      photoFiles: tmpFiles,
    });

    res.json({ pdf_base64: pdfBuffer.toString("base64"), filename: `${productName.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "tech-pack"}.pdf` });
  } catch (_err) {
    // Do not leak upstream provider or rendering error details to the client.
    res.status(502).json({ error: "Tech pack generation failed. Please try again." });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
