import type { Request, Response } from "express";
import { ObjectStorageService } from "../objectStorage";
import { ObjectPermission, setObjectAclPolicy } from "../objectAcl";
import { OFFICIAL_ACCOUNT_CLERK_ID } from "./config";

/** Branding, not creator media. Keep a stable API URL instead of SPA /objects URLs. */
export const OFFICIAL_AVATAR_OBJECT_PATH = "/objects/brand-assets/brandthread-logo.png";
export const OFFICIAL_AVATAR_API_PATH = "/api/public/brandthread/avatar";
const storage = new ObjectStorageService();

export async function storeOfficialAvatar(bytes: Buffer): Promise<void> {
  await storage.createObjectEntityFromBuffer(bytes, "image/png", OFFICIAL_AVATAR_OBJECT_PATH);
  await setObjectAclPolicy(await storage.getObjectEntityFile(OFFICIAL_AVATAR_OBJECT_PATH), {
    owner: OFFICIAL_ACCOUNT_CLERK_ID, visibility: "public",
  });
}

/** The logo is public app branding; account/profile visibility is checked separately. */
export async function serveOfficialAvatar(req: Request, res: Response): Promise<void> {
  try {
    const file = await storage.getObjectEntityFile(OFFICIAL_AVATAR_OBJECT_PATH);
    if (!await storage.canAccessObjectEntity({ objectFile: file, requestedPermission: ObjectPermission.READ })) {
      res.status(404).end();
      return;
    }
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    const stream = file.createReadStream();
    stream.once("error", (err) => {
      req.log.error({ err }, "Official avatar stream failed");
      if (res.headersSent) res.destroy();
      else res.status(503).end();
    });
    stream.pipe(res);
  } catch (err) {
    req.log.error({ err }, "Official avatar unavailable");
    res.status(503).end();
  }
}
