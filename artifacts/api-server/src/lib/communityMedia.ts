/**
 * Storage for community photos. The ONLY writer is the moderated
 * `POST /api/communities/upload-photo` route, which is why message and group
 * image attachments must point at a `community/` object we wrote: a client
 * can't deliver an un-checked image by pasting its own URL.
 */
import { randomUUID } from "node:crypto";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function communityImageExtension(mimeType: string): string | null {
  return EXTENSIONS[mimeType.toLowerCase()] ?? null;
}

function bucketId(): string {
  return (process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID ?? "").trim();
}

export function communityMediaPrefix(): string | null {
  const id = bucketId();
  return id ? `https://storage.googleapis.com/${id}/community/` : null;
}

/** True when `url` is an image this server stored through the moderated upload route. */
export function isModeratedCommunityImageUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const prefix = communityMediaPrefix();
  return !!prefix && url.startsWith(prefix) && !url.includes("..");
}

export class StorageNotConfiguredError extends Error {}

export type CommunityImageStore = (input: { buffer: Buffer; mimeType: string; userId: string }) => Promise<string>;

const gcsStore: CommunityImageStore = async ({ buffer, mimeType, userId }) => {
  const id = bucketId();
  if (!id) throw new StorageNotConfiguredError("Object storage not configured");
  const ext = communityImageExtension(mimeType);
  const filename = `community/${userId}/${randomUUID()}.${ext}`;
  const { objectStorageClient } = await import("./objectStorage");
  const file = objectStorageClient.bucket(id).file(filename);
  await file.save(buffer, { contentType: mimeType, resumable: false });
  await file.makePublic();
  return `https://storage.googleapis.com/${id}/${filename}`;
};

let store: CommunityImageStore = gcsStore;

/** Test seam. Pass nothing to restore the default store. */
export function setCommunityImageStore(next?: CommunityImageStore): void {
  store = next ?? gcsStore;
}

export function storeCommunityImage(input: { buffer: Buffer; mimeType: string; userId: string }): Promise<string> {
  return store(input);
}
