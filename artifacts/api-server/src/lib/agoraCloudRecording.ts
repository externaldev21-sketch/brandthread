/**
 * Agora Cloud Recording client.
 *
 * Records a seller's live stream (mix mode, 9:16 720x1280, HLS + MP4) to a
 * configured S3 bucket, so `live_streams.replay_url` can eventually be set
 * from a *real* uploaded file. See routes/live.ts (acquire/start on stream
 * start, stop on stream end) and jobs/liveRecordingFinalize.ts (polls for
 * upload completion and sets replay_url once a file is confirmed ready).
 *
 * Silently disabled (never throws, never fabricates a replay_url) when its
 * env vars are not fully set — see `isAgoraCloudRecordingConfigured`.
 */
import { logger } from "./logger";
import { withRetry } from "./retry";

const AGORA_API_BASE = "https://api.agora.io/v1";

export interface RecordingEnv {
  appId: string;
  customerId: string;
  customerSecret: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  /**
   * Agora `storageConfig.vendor` code. Defaults to `1` (Amazon S3) per
   * Agora's Cloud Recording REST API docs. Overridable via
   * AGORA_RECORDING_S3_VENDOR in case Agora's enum changes, or Dev wants to
   * point at an S3-compatible bucket registered under a different vendor
   * code (e.g. a non-AWS provider Agora has since added first-class support
   * for) without a code change.
   */
  vendor: number;
  /**
   * Optional CDN/public base URL to serve recordings from instead of the
   * bucket's own virtual-hosted-style URL (e.g. a CloudFront/R2-public
   * domain in front of the bucket).
   */
  publicUrlBase?: string;
}

/** Reads+validates the recording env vars. Returns null if not fully set. */
export function getRecordingEnv(): RecordingEnv | null {
  const appId = process.env.AGORA_APP_ID?.trim();
  const customerId = process.env.AGORA_CUSTOMER_ID?.trim();
  const customerSecret = process.env.AGORA_CUSTOMER_SECRET?.trim();
  const bucket = process.env.AGORA_RECORDING_S3_BUCKET?.trim();
  const region = process.env.AGORA_RECORDING_S3_REGION?.trim();
  const accessKey = process.env.AGORA_RECORDING_S3_ACCESS_KEY?.trim();
  const secretKey = process.env.AGORA_RECORDING_S3_SECRET_KEY?.trim();
  const vendorRaw = process.env.AGORA_RECORDING_S3_VENDOR?.trim();
  const publicUrlBase = process.env.AGORA_RECORDING_PUBLIC_URL_BASE?.trim();

  if (!appId || !customerId || !customerSecret || !bucket || !region || !accessKey || !secretKey) {
    return null;
  }

  const vendor = vendorRaw ? Number(vendorRaw) : 1;
  return {
    appId, customerId, customerSecret, bucket, region, accessKey, secretKey,
    vendor: Number.isFinite(vendor) ? vendor : 1,
    publicUrlBase: publicUrlBase || undefined,
  };
}

export function isAgoraCloudRecordingConfigured(): boolean {
  return getRecordingEnv() !== null;
}

/** Deterministic synthetic uid for the recording bot, distinct from the
 * host/viewer uid ranges (see live.ts `uidFromClerkId`, which stays under
 * 1,000,000), so the recording session never collides with a real join. */
export function recordingUidForChannel(channelName: string): number {
  let h = 0;
  for (let i = 0; i < channelName.length; i++) {
    h = (Math.imul(31, h) + channelName.charCodeAt(i)) | 0;
  }
  return 900_000_000 + (Math.abs(h) % 90_000_000);
}

export class AgoraApiError extends Error {
  constructor(
    public readonly step: string,
    public readonly status: number | undefined,
    public readonly body: string,
  ) {
    super(`Agora Cloud Recording ${step} failed${status ? ` (HTTP ${status})` : ""}: ${body.slice(0, 500)}`);
    this.name = "AgoraApiError";
  }
}

async function agoraFetch(
  env: RecordingEnv,
  path: string,
  body: Record<string, unknown>,
  step: string,
  retryable: boolean,
): Promise<any> {
  const auth = Buffer.from(`${env.customerId}:${env.customerSecret}`).toString("base64");
  const url = `${AGORA_API_BASE}/apps/${env.appId}/cloud_recording${path}`;

  const doFetch = async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (!response.ok) {
      const err = new AgoraApiError(step, response.status, text);
      (err as any).status = response.status;
      throw err;
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new AgoraApiError(step, response.status, text);
    }
  };

  if (!retryable) return doFetch();

  return withRetry(doFetch, {
    attempts: 3,
    label: `agoraCloudRecording.${step}`,
    // Never retry a 4xx (bad request/config won't fix itself); do retry
    // network failures/429/5xx.
    isRetryable: (err) => {
      const status = (err as any)?.status as number | undefined;
      if (status === undefined) return true;
      if (status === 429) return true;
      return status >= 500;
    },
  });
}

/**
 * Step 1 of Agora's documented sequencing: acquire a resourceId before
 * starting. Safe to retry — acquiring an extra unused resourceId has no
 * lasting side effect (it just expires unused).
 */
export async function acquireRecordingResource(
  env: RecordingEnv,
  channelName: string,
  uid: number,
): Promise<string> {
  const data = await agoraFetch(
    env,
    `/acquire`,
    {
      cname: channelName,
      uid: String(uid),
      clientRequest: {
        resourceExpiredHour: 24,
        scene: 0, // 0 = real-time recording
      },
    },
    "acquire",
    true,
  );
  const resourceId = data?.resourceId as string | undefined;
  if (!resourceId) throw new AgoraApiError("acquire", undefined, JSON.stringify(data));
  return resourceId;
}

/**
 * Step 2: start mix-mode recording targeting the configured bucket. NOT
 * retried automatically — a blind retry after an ambiguous failure (e.g. a
 * timeout where Agora actually started) could produce two live recording
 * sessions for one stream. Callers should treat a thrown error here as
 * "recording failed to start" and move on without recording, rather than
 * re-attempting with the same resourceId.
 */
export async function startRecording(
  env: RecordingEnv,
  {
    channelName, uid, resourceId, fileNamePrefix,
  }: { channelName: string; uid: number; resourceId: string; fileNamePrefix: string[] },
): Promise<string> {
  const data = await agoraFetch(
    env,
    `/resourceid/${encodeURIComponent(resourceId)}/mode/mix/start`,
    {
      cname: channelName,
      uid: String(uid),
      clientRequest: {
        recordingConfig: {
          channelType: 1, // live broadcast
          streamTypes: 2, // audio + video
          audioProfile: 1,
          videoStreamType: 0,
          maxIdleTime: 60,
          transcodingConfig: {
            width: 720,
            height: 1280,
            fps: 15,
            bitrate: 1130,
            mixedVideoLayout: 1,
            backgroundColor: "#000000",
          },
        },
        recordingFileConfig: {
          avFileType: ["hls", "mp4"],
        },
        storageConfig: {
          vendor: env.vendor,
          region: regionCode(env.region),
          bucket: env.bucket,
          accessKey: env.accessKey,
          secretKey: env.secretKey,
          fileNamePrefix,
        },
      },
    },
    "start",
    false,
  );
  const sid = data?.sid as string | undefined;
  if (!sid) throw new AgoraApiError("start", undefined, JSON.stringify(data));
  return sid;
}

export interface AgoraRecordedFile {
  fileName: string;
  trackType: string;
  uid?: string;
  mixedAllUser?: boolean;
  isPlayable?: boolean;
  sliceStartTime?: number;
}

/**
 * Step 3: stop. Retried on transient failure — Agora's stop is safe to call
 * again for the same resourceId/sid pair (repeats are documented to no-op
 * once the session is already stopped, returning the same file list), and
 * callers additionally gate this with the `recording_status` DB guard so it
 * is never invoked twice for the same stream from two racing requests.
 */
export async function stopRecording(
  env: RecordingEnv,
  { channelName, uid, resourceId, sid }: { channelName: string; uid: number; resourceId: string; sid: string },
): Promise<AgoraRecordedFile[]> {
  const data = await agoraFetch(
    env,
    `/resourceid/${encodeURIComponent(resourceId)}/sid/${encodeURIComponent(sid)}/mode/mix/stop`,
    {
      cname: channelName,
      uid: String(uid),
      clientRequest: {},
    },
    "stop",
    true,
  );
  return parseFileList(data);
}

/** Step 4 (as needed): poll for upload completion after stop. */
export async function queryRecording(
  env: RecordingEnv,
  { resourceId, sid }: { resourceId: string; sid: string },
): Promise<{ files: AgoraRecordedFile[]; status: number | undefined }> {
  const auth = Buffer.from(`${env.customerId}:${env.customerSecret}`).toString("base64");
  const url = `${AGORA_API_BASE}/apps/${env.appId}/cloud_recording/resourceid/${encodeURIComponent(resourceId)}/sid/${encodeURIComponent(sid)}/mode/mix/query`;
  const data = await withRetry(
    async () => {
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      if (!response.ok) {
        const err = new AgoraApiError("query", response.status, text);
        (err as any).status = response.status;
        throw err;
      }
      return text ? JSON.parse(text) : {};
    },
    { attempts: 3, label: "agoraCloudRecording.query" },
  );
  return { files: parseFileList(data), status: data?.serverResponse?.status };
}

function parseFileList(data: any): AgoraRecordedFile[] {
  const raw = data?.serverResponse?.fileList;
  if (!raw) return [];
  // fileList is either a JSON array (fileCompress=false, our config) or a
  // compressed string — we only ever request the array form.
  if (Array.isArray(raw)) return raw as AgoraRecordedFile[];
  return [];
}

/** Picks the primary playable mp4 recording out of a fileList, if any. */
export function pickReplayFile(files: AgoraRecordedFile[]): AgoraRecordedFile | null {
  const mp4s = files.filter((f) => f.trackType === "mp4" || f.fileName?.endsWith(".mp4"));
  return mp4s.find((f) => f.isPlayable !== false) ?? mp4s[0] ?? null;
}

export function buildReplayUrl(env: RecordingEnv, fileName: string): string {
  if (env.publicUrlBase) {
    return `${env.publicUrlBase.replace(/\/$/, "")}/${fileName.replace(/^\//, "")}`;
  }
  return `https://${env.bucket}.s3.${env.region}.amazonaws.com/${fileName.replace(/^\//, "")}`;
}

/** Agora's storageConfig.region expects its own numeric region codes for
 * S3; most Dev setups use us-east-1, so default unrecognized regions to 0
 * (US EAST) rather than fail the whole recording. */
function regionCode(region: string): number {
  const table: Record<string, number> = {
    "us-east-1": 0,
    "us-east-2": 1,
    "us-west-1": 2,
    "us-west-2": 3,
    "eu-west-1": 4,
    "eu-west-2": 14,
    "eu-west-3": 15,
    "eu-central-1": 5,
    "ap-southeast-1": 6,
    "ap-southeast-2": 7,
    "ap-northeast-1": 8,
    "ap-northeast-2": 18,
    "sa-east-1": 9,
    "ca-central-1": 10,
    "ap-south-1": 11,
  };
  if (region in table) return table[region];
  const asNumber = Number(region);
  if (Number.isFinite(asNumber)) return asNumber;
  logger.warn({ region }, "Unrecognized AGORA_RECORDING_S3_REGION, defaulting to us-east-1 code");
  return 0;
}
