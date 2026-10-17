/**
 * Whether Live streaming and Live replays (Agora Cloud Recording) are set up
 * on this server. Both are env-gated: nothing here is a secret, only booleans
 * and stable codes the client maps to human copy.
 *
 * Live streaming needs AGORA_APP_ID (AGORA_APP_CERTIFICATE is strongly
 * recommended — without it tokens are empty and the Agora project must run in
 * "App ID only" mode). Replays need the 7 recording vars in
 * REPLAY_RECORDING_ENV_VARS (see lib/agoraCloudRecording.ts getRecordingEnv).
 */
import { isAgoraCloudRecordingConfigured } from "./agoraCloudRecording";

export const LIVE_NOT_CONFIGURED_CODE = "LIVE_NOT_CONFIGURED";
export const REPLAYS_NOT_CONFIGURED_CODE = "REPLAYS_NOT_CONFIGURED";

export const LIVE_NOT_CONFIGURED_MESSAGE =
  "Live streaming isn't set up yet. You'll be able to go live once it's turned on for Brandthread.";

/** The 7 env vars Agora Cloud Recording needs before any replay can be saved. */
export const REPLAY_RECORDING_ENV_VARS = [
  "AGORA_APP_ID",
  "AGORA_CUSTOMER_ID",
  "AGORA_CUSTOMER_SECRET",
  "AGORA_RECORDING_S3_BUCKET",
  "AGORA_RECORDING_S3_REGION",
  "AGORA_RECORDING_S3_ACCESS_KEY",
  "AGORA_RECORDING_S3_SECRET_KEY",
] as const;

/** `.env.example` ships `replace_me`; treat it (and blanks) as unset. */
function isSet(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return !!trimmed && trimmed.toLowerCase() !== "replace_me";
}

export function isLiveStreamingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return isSet(env.AGORA_APP_ID);
}

export function missingReplayRecordingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return REPLAY_RECORDING_ENV_VARS.filter((name) => !isSet(env[name]));
}

export function isReplayRecordingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  if (missingReplayRecordingEnv(env).length > 0) return false;
  // The recorder reads process.env itself; only trust it for the live env.
  return env === process.env ? isAgoraCloudRecordingConfigured() : true;
}

export interface LiveAvailability {
  streaming: { available: boolean; code: string | null };
  replays: { available: boolean; code: string | null };
}

export function liveAvailability(env: NodeJS.ProcessEnv = process.env): LiveAvailability {
  const streaming = isLiveStreamingConfigured(env);
  const replays = streaming && isReplayRecordingConfigured(env);
  return {
    streaming: { available: streaming, code: streaming ? null : LIVE_NOT_CONFIGURED_CODE },
    replays: { available: replays, code: replays ? null : REPLAYS_NOT_CONFIGURED_CODE },
  };
}
