import { describe, expect, it, vi } from "vitest";
import {
  MAX_EVIDENCE_FILE_BYTES, MAX_EVIDENCE_FILES_PER_DISPUTE, buildEvidencePayload, buildStripeEvidence,
  evidenceAlreadySubmitted, safeFileName, validateEvidenceUpload,
} from "../evidence";
import { processEvidenceUpload, type UploadDeps, type EvidenceFileRow } from "../upload";

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const pdf = Buffer.from("%PDF-1.7\n...");

describe("evidence field mapping", () => {
  it("maps text evidence types to Stripe fields", () => {
    expect(buildStripeEvidence("tracking", "1Z999", "1Z999")).toEqual({
      shipping_tracking_number: "1Z999", shipping_documentation: "1Z999", customer_communication: "1Z999",
    });
    expect(buildStripeEvidence("policy", "No returns")).toEqual({ refund_policy: "No returns", refund_policy_disclosure: "No returns" });
    expect(buildStripeEvidence("other", "x")).toEqual({ uncategorized_text: "x" });
  });

  it("merges text and files; an uploaded file wins for the same field", () => {
    const payload = buildEvidencePayload(
      [{ type: "tracking", description: "1Z999" }, { type: "written_response", description: "Delivered" }],
      [
        { evidenceType: "receipt", stripeFileId: "file_r" },
        { evidenceType: "shipping_documentation", stripeFileId: "file_s" },
        { evidenceType: "customer_signature", stripeFileId: null },
      ],
    );
    expect(payload.receipt).toBe("file_r");
    expect(payload.shipping_documentation).toBe("file_s");
    expect(payload.shipping_tracking_number).toBe("1Z999");
    expect(payload.customer_communication).toBe("Delivered");
    expect(payload.customer_signature).toBeUndefined();
  });
});

describe("upload validation", () => {
  const base = { evidenceType: "receipt", existingFileCount: 0, replacesExistingType: false };

  it("accepts jpeg, png and pdf with matching bytes", () => {
    for (const [contentType, bytes] of [["image/jpeg", jpeg], ["image/png", png], ["application/pdf", pdf]] as const) {
      expect(validateEvidenceUpload({ ...base, contentType, bytes }).ok).toBe(true);
    }
  });

  it("rejects other mime types, mismatched bytes, empty and oversize files", () => {
    expect(validateEvidenceUpload({ ...base, contentType: "image/gif", bytes: jpeg })).toMatchObject({ ok: false, status: 415 });
    expect(validateEvidenceUpload({ ...base, contentType: "image/png", bytes: jpeg })).toMatchObject({ ok: false, status: 400 });
    expect(validateEvidenceUpload({ ...base, contentType: "image/jpeg", bytes: Buffer.alloc(0) })).toMatchObject({ ok: false, status: 400 });
    const big = Buffer.concat([jpeg, Buffer.alloc(MAX_EVIDENCE_FILE_BYTES)]);
    expect(validateEvidenceUpload({ ...base, contentType: "image/jpeg", bytes: big })).toMatchObject({ ok: false, status: 413 });
  });

  it("rejects unknown evidence types and too many files, but allows replacing one", () => {
    expect(validateEvidenceUpload({ ...base, evidenceType: "bank_login", contentType: "image/jpeg", bytes: jpeg })).toMatchObject({ ok: false, status: 400 });
    const full = { ...base, existingFileCount: MAX_EVIDENCE_FILES_PER_DISPUTE, contentType: "image/jpeg", bytes: jpeg };
    expect(validateEvidenceUpload(full)).toMatchObject({ ok: false });
    expect(validateEvidenceUpload({ ...full, replacesExistingType: true }).ok).toBe(true);
  });

  it("sanitises file names", () => {
    expect(safeFileName("../../etc/pass wd<>.pdf", "x.pdf")).toBe("pass wd.pdf");
    expect(safeFileName(undefined, "receipt.jpg")).toBe("receipt.jpg");
  });

  it("detects an already submitted dispute", () => {
    expect(evidenceAlreadySubmitted({ status: "needs_response", evidenceSubmittedAt: null })).toBe(false);
    expect(evidenceAlreadySubmitted({ status: "needs_response", evidenceSubmittedAt: new Date() })).toBe(true);
    expect(evidenceAlreadySubmitted({ status: "needs_response", evidenceSubmittedAt: null, stripeEvidenceDetails: { submission_count: 1 } })).toBe(true);
    expect(evidenceAlreadySubmitted({ status: "under_review", evidenceSubmittedAt: null })).toBe(true);
  });
});

describe("processEvidenceUpload", () => {
  const dispute = {
    id: "d1", sellerId: "seller_1", stripeDisputeId: "dp_1", status: "needs_response",
    evidenceSubmittedAt: null as Date | null, stripeEvidenceDetails: {},
  };

  function makeDeps(overrides: Partial<UploadDeps> = {}) {
    const saved: EvidenceFileRow[] = [];
    const storage = { save: vi.fn(async () => "/objects/uploads/abc"), remove: vi.fn(async () => {}) };
    const stripe = {
      createEvidenceFile: vi.fn(async () => "file_123"),
      attachDraft: vi.fn(async () => {}),
    };
    const deps: UploadDeps = {
      storage, stripe,
      repo: {
        async replaceFile(values) {
          const created = { ...values, id: "f1", createdAt: new Date() } as EvidenceFileRow;
          saved.push(created);
          return { created, replaced: null };
        },
      },
      ...overrides,
    };
    return { deps, storage, stripe, saved };
  }

  const input = (over: Record<string, unknown> = {}) => ({
    dispute, existingFiles: [], contentType: "application/pdf", bytes: pdf, evidenceType: "receipt", fileName: "r.pdf", ...over,
  });

  it("stores the file, uploads to Stripe and attaches it to the draft under the mapped field", async () => {
    const { deps, storage, stripe, saved } = makeDeps();
    const result = await processEvidenceUpload(input(), deps);
    expect(result.ok).toBe(true);
    expect(stripe.createEvidenceFile).toHaveBeenCalledWith(expect.objectContaining({ contentType: "application/pdf", fileName: "r.pdf" }));
    expect(storage.save).toHaveBeenCalledWith(pdf, "application/pdf", "seller_1");
    expect(stripe.attachDraft).toHaveBeenCalledWith("dp_1", "receipt", "file_123");
    expect(saved[0]).toMatchObject({ stripeFileId: "file_123", evidenceType: "receipt", sizeBytes: pdf.length });
  });

  it("refuses after the evidence was submitted and for finalised disputes", async () => {
    const { deps, stripe } = makeDeps();
    expect(await processEvidenceUpload(input({ dispute: { ...dispute, evidenceSubmittedAt: new Date() } }), deps))
      .toMatchObject({ ok: false, status: 409 });
    expect(await processEvidenceUpload(input({ dispute: { ...dispute, status: "lost" } }), deps))
      .toMatchObject({ ok: false, status: 400 });
    expect(stripe.createEvidenceFile).not.toHaveBeenCalled();
  });

  it("does not store anything when Stripe rejects the file, and reports 503 without Stripe", async () => {
    const a = makeDeps();
    a.stripe.createEvidenceFile.mockRejectedValueOnce(new Error("bad file"));
    expect(await processEvidenceUpload(input(), a.deps)).toMatchObject({ ok: false, status: 502 });
    expect(a.storage.save).not.toHaveBeenCalled();
    const b = makeDeps({ stripe: null });
    expect(await processEvidenceUpload(input(), b.deps)).toMatchObject({ ok: false, status: 503 });
  });

  it("removes the stored object if recording it fails, and deletes the replaced object on success", async () => {
    const a = makeDeps();
    a.deps.repo.replaceFile = async () => { throw new Error("db down"); };
    await expect(processEvidenceUpload(input(), a.deps)).rejects.toThrow("db down");
    expect(a.storage.remove).toHaveBeenCalledWith("/objects/uploads/abc");

    const b = makeDeps();
    b.deps.repo.replaceFile = async (values) => ({
      created: { ...values, id: "f2", createdAt: new Date() } as EvidenceFileRow,
      replaced: { ...values, id: "f1", objectKey: "/objects/uploads/old", createdAt: new Date() } as EvidenceFileRow,
    });
    await processEvidenceUpload(input(), b.deps);
    expect(b.storage.remove).toHaveBeenCalledWith("/objects/uploads/old");
  });

  it("still succeeds when attaching to the Stripe draft fails", async () => {
    const { deps, stripe } = makeDeps();
    stripe.attachDraft.mockRejectedValueOnce(new Error("nope"));
    expect((await processEvidenceUpload(input(), deps)).ok).toBe(true);
  });
});
