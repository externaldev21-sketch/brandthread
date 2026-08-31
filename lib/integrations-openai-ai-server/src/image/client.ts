import fs from "node:fs";
import OpenAI, { toFile } from "openai";
import { Buffer } from "node:buffer";
import path from "node:path";

if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
  throw new Error(
    "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
  );
}

export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export type ImageQuality = "low" | "medium" | "high" | "auto";

export interface ImageGenerationOptions {
  /**
   * Premium output is the default for every customer-facing image operation.
   * Callers may still opt down only for an explicitly non-customer-facing use.
   */
  quality?: ImageQuality;
}

async function detectImageMime(file: string): Promise<{ mime: "image/png" | "image/jpeg" | "image/webp"; name: string }> {
  const handle = await fs.promises.open(file, "r");
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { mime: "image/png", name: `${path.parse(file).name}.png` };
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mime: "image/jpeg", name: `${path.parse(file).name}.jpg` };
    }
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
      return { mime: "image/webp", name: `${path.parse(file).name}.webp` };
    }
    throw new Error("Unsupported image format. Use PNG, JPEG, or WebP.");
  } finally {
    await handle.close();
  }
}

export async function generateImageBuffer(
  prompt: string,
  size: "1024x1024" | "512x512" | "256x256" = "1024x1024",
  options?: ImageGenerationOptions,
): Promise<Buffer> {
  const response = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size,
    quality: options?.quality ?? "high",
  });
  const base64 = response.data?.[0]?.b64_json ?? "";
  return Buffer.from(base64, "base64");
}

export async function editImages(
  imageFiles: string[],
  prompt: string,
  outputPath?: string,
  options?: {
    background?: "transparent" | "opaque" | "auto";
    quality?: ImageQuality;
  }
): Promise<Buffer> {
  const images = await Promise.all(
    imageFiles.map(async (file) => {
      const detected = await detectImageMime(file);
      return toFile(fs.createReadStream(file), detected.name, {
        type: detected.mime,
      });
    })
  );

  const response = await openai.images.edit({
    model: "gpt-image-1",
    image: images,
    prompt,
    quality: options?.quality ?? "high",
    ...(options?.background ? { background: options.background } : {}),
  });

  const imageBase64 = response.data?.[0]?.b64_json ?? "";
  const imageBytes = Buffer.from(imageBase64, "base64");

  if (outputPath) {
    fs.writeFileSync(outputPath, imageBytes);
  }

  return imageBytes;
}
