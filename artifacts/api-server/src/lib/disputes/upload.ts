/**
 * Evidence file upload flow: validate, store privately, send to Stripe's Files
 * API (purpose dispute_evidence), attach to the dispute draft, and record it.
 * Storage, Stripe and persistence are injected so the flow is testable.
 */
import { evidenceAlreadySubmitted, isFinalDisputeStatus, validateEvidenceUpload, type EvidenceFileType } from "./evidence";

export type EvidenceFileRow = {
  id: string;
  disputeId: string;
  sellerId: string;
  evidenceType: string;
  fileName: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  stripeFileId: string | null;
  createdAt: Date;
};

export interface UploadDeps {
  storage: {
    save(bytes: Buffer, contentType: string, ownerId: string): Promise<string>;
    remove(objectKey: string): Promise<void>;
  };
  /** null when Stripe is not configured. */
  stripe: {
    createEvidenceFile(input: { bytes: Buffer; fileName: string; contentType: string }): Promise<string>;
    /** Saves the file on the Stripe dispute without submitting it. */
    attachDraft(stripeDisputeId: string, field: EvidenceFileType, stripeFileId: string): Promise<void>;
  } | null;
  repo: {
    /** Replaces any file of the same type for the dispute; returns the replaced row. */
    replaceFile(row: Omit<EvidenceFileRow, "id" | "createdAt">): Promise<{ created: EvidenceFileRow; replaced: EvidenceFileRow | null }>;
  };
  log?: { warn(obj: object, msg: string): void };
}

export type UploadResult =
  | { ok: true; file: EvidenceFileRow }
  | { ok: false; status: number; error: string };

export async function processEvidenceUpload(input: {
  dispute: {
    id: string; sellerId: string; stripeDisputeId: string | null; status: string;
    evidenceSubmittedAt: Date | null; stripeEvidenceDetails?: Record<string, unknown> | null;
  };
  existingFiles: Array<Pick<EvidenceFileRow, "evidenceType">>;
  contentType: string | undefined;
  bytes: unknown;
  evidenceType: unknown;
  fileName?: unknown;
}, deps: UploadDeps): Promise<UploadResult> {
  const { dispute } = input;
  if (isFinalDisputeStatus(dispute.status)) {
    return { ok: false, status: 400, error: "Cannot add evidence to a finalised dispute" };
  }
  if (evidenceAlreadySubmitted(dispute)) {
    return { ok: false, status: 409, error: "Evidence was already submitted. Stripe allows one submission." };
  }
  const validation = validateEvidenceUpload({
    contentType: input.contentType,
    bytes: input.bytes,
    evidenceType: input.evidenceType,
    fileName: input.fileName,
    existingFileCount: input.existingFiles.length,
    replacesExistingType: input.existingFiles.some((f) => f.evidenceType === input.evidenceType),
  });
  if (!validation.ok) return validation;
  if (!deps.stripe || !dispute.stripeDisputeId) {
    return { ok: false, status: 503, error: "File uploads are unavailable right now" };
  }
  const bytes = input.bytes as Buffer;

  // Stripe first: if it refuses the file nothing is stored on our side.
  let stripeFileId: string;
  try {
    stripeFileId = await deps.stripe.createEvidenceFile({
      bytes, fileName: validation.fileName, contentType: validation.contentType,
    });
  } catch (err) {
    deps.log?.warn({ err, disputeId: dispute.id }, "Stripe rejected the evidence file");
    return { ok: false, status: 502, error: "Stripe could not accept this file" };
  }

  let objectKey: string;
  try {
    objectKey = await deps.storage.save(bytes, validation.contentType, dispute.sellerId);
  } catch (err) {
    deps.log?.warn({ err, disputeId: dispute.id }, "Evidence file could not be stored");
    return { ok: false, status: 500, error: "File could not be saved" };
  }

  let saved: { created: EvidenceFileRow; replaced: EvidenceFileRow | null };
  try {
    saved = await deps.repo.replaceFile({
      disputeId: dispute.id,
      sellerId: dispute.sellerId,
      evidenceType: validation.evidenceType,
      fileName: validation.fileName,
      objectKey,
      contentType: validation.contentType,
      sizeBytes: bytes.length,
      stripeFileId,
    });
  } catch (err) {
    await deps.storage.remove(objectKey).catch(() => {});
    throw err;
  }
  if (saved.replaced) await deps.storage.remove(saved.replaced.objectKey).catch(() => {});

  // The draft on Stripe is a convenience; submit re-sends everything anyway.
  try {
    await deps.stripe.attachDraft(dispute.stripeDisputeId, validation.evidenceType, stripeFileId);
  } catch (err) {
    deps.log?.warn({ err, disputeId: dispute.id }, "Could not attach evidence file to the Stripe draft");
  }
  return { ok: true, file: saved.created };
}
