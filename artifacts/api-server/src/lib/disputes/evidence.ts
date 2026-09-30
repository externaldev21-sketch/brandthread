/**
 * Dispute evidence: which Stripe evidence field each upload maps to, upload
 * validation, and the merge of text + file evidence into one Stripe payload.
 * Pure functions only, so the rules are unit-testable without Stripe.
 */

/** Stripe's Files API caps dispute evidence files at 5 MB. */
export const MAX_EVIDENCE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_EVIDENCE_FILES_PER_DISPUTE = 10;

export const EVIDENCE_FILE_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"] as const;
export type EvidenceFileMime = (typeof EVIDENCE_FILE_MIME_TYPES)[number];

/**
 * The evidence type IS the Stripe evidence field the file is sent under, so the
 * mapping cannot drift. Stripe holds one file per field.
 */
export const EVIDENCE_FILE_TYPES = [
  "receipt",
  "shipping_documentation",
  "customer_communication",
  "customer_signature",
  "refund_policy",
  "uncategorized_file",
] as const;
export type EvidenceFileType = (typeof EVIDENCE_FILE_TYPES)[number];

export function isEvidenceFileType(value: unknown): value is EvidenceFileType {
  return typeof value === "string" && (EVIDENCE_FILE_TYPES as readonly string[]).includes(value);
}

export function evidenceFileStripeField(type: EvidenceFileType): EvidenceFileType {
  return type;
}

/** Map our UI text-evidence type to Stripe evidence fields. */
export function buildStripeEvidence(
  type: string,
  description: string,
  trackingNumber?: string,
): Record<string, string> {
  switch (type) {
    case "tracking":
      return {
        shipping_tracking_number: trackingNumber ?? "",
        shipping_documentation: description,
        customer_communication: description,
      };
    case "photo":
      return { product_description: description };
    case "policy":
      return { refund_policy: description, refund_policy_disclosure: description };
    case "written_response":
      return { customer_communication: description, uncategorized_text: description };
    default:
      return { uncategorized_text: description };
  }
}

type TextEvidence = { type: string; description: string };

/** Merge every text item (latest wins per field). */
export function mergeTextEvidence(items: TextEvidence[]): Record<string, string> {
  const tracking = items.find((e) => e.type === "tracking")?.description;
  return items.reduce<Record<string, string>>(
    (acc, ev) => ({ ...acc, ...buildStripeEvidence(ev.type, ev.description, tracking) }),
    {},
  );
}

/**
 * Text evidence plus uploaded files. A file's Stripe field holds a file id; the
 * text variants of the same field are strings and Stripe accepts only one, so
 * an uploaded file takes precedence over text for the same field.
 */
export function buildEvidencePayload(
  items: TextEvidence[],
  files: Array<{ evidenceType: string; stripeFileId: string | null }>,
): Record<string, string> {
  const payload = mergeTextEvidence(items);
  for (const file of files) {
    if (!file.stripeFileId || !isEvidenceFileType(file.evidenceType)) continue;
    payload[evidenceFileStripeField(file.evidenceType)] = file.stripeFileId;
  }
  return payload;
}

export type UploadValidation =
  | { ok: true; contentType: EvidenceFileMime; evidenceType: EvidenceFileType; fileName: string }
  | { ok: false; status: number; error: string };

function hasSignature(contentType: EvidenceFileMime, bytes: Buffer): boolean {
  switch (contentType) {
    case "image/jpeg":
      return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes.length > 8
        && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "application/pdf":
      return bytes.length > 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
  }
}

export function safeFileName(raw: unknown, fallback: string): string {
  const base = typeof raw === "string" ? raw.split(/[\\/]/).pop() ?? "" : "";
  const cleaned = base.replace(/[^\w.\- ]+/g, "").trim().slice(0, 80);
  return cleaned || fallback;
}

export function validateEvidenceUpload(input: {
  contentType: string | undefined;
  bytes: unknown;
  evidenceType: unknown;
  fileName?: unknown;
  existingFileCount: number;
  replacesExistingType: boolean;
}): UploadValidation {
  if (!isEvidenceFileType(input.evidenceType)) {
    return { ok: false, status: 400, error: `type must be one of: ${EVIDENCE_FILE_TYPES.join(", ")}` };
  }
  const contentType = String(input.contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!(EVIDENCE_FILE_MIME_TYPES as readonly string[]).includes(contentType)) {
    return { ok: false, status: 415, error: "Evidence files must be JPEG, PNG or PDF" };
  }
  const mime = contentType as EvidenceFileMime;
  const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.alloc(0);
  if (bytes.length === 0) return { ok: false, status: 400, error: "Empty file" };
  if (bytes.length > MAX_EVIDENCE_FILE_BYTES) {
    return { ok: false, status: 413, error: `File exceeds ${MAX_EVIDENCE_FILE_BYTES / 1024 / 1024} MB limit` };
  }
  if (!hasSignature(mime, bytes)) {
    return { ok: false, status: 400, error: "File content does not match its type" };
  }
  if (!input.replacesExistingType && input.existingFileCount >= MAX_EVIDENCE_FILES_PER_DISPUTE) {
    return { ok: false, status: 400, error: "Too many evidence files" };
  }
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
  return {
    ok: true,
    contentType: mime,
    evidenceType: input.evidenceType,
    fileName: safeFileName(input.fileName, `${input.evidenceType}.${ext}`),
  };
}

/** Stripe allows one submission; later attempts must be refused. */
export function evidenceAlreadySubmitted(dispute: {
  status: string;
  evidenceSubmittedAt: Date | null;
  stripeEvidenceDetails?: Record<string, unknown> | null;
}): boolean {
  const submissionCount = Number(dispute.stripeEvidenceDetails?.submission_count ?? 0);
  return !!dispute.evidenceSubmittedAt || submissionCount > 0 || dispute.status === "under_review";
}

export function isFinalDisputeStatus(status: string): boolean {
  return status === "won" || status === "lost" || status === "closed";
}
