/**
 * Live video (Go Live, live shopping) runs on Agora. Without both
 * AGORA_APP_ID and AGORA_APP_CERTIFICATE the server cannot mint stream
 * tokens, so the app hides every Go Live entry point instead of showing a
 * button that fails (App Store Guideline 2.1). Exposed publicly at
 * GET /api/config/live (routes/config-live.ts).
 */
export function isLiveAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AGORA_APP_ID?.trim() && env.AGORA_APP_CERTIFICATE?.trim());
}

export function liveConfigPayload(env: NodeJS.ProcessEnv = process.env) {
  return { liveAvailable: isLiveAvailable(env) };
}
