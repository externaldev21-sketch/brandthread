/**
 * Whether 1:1 calling is switched on: both Agora credentials are set. This is
 * the single source the API uses for GET /api/call/availability, for refusing
 * DM call creation (503 CALLING_NOT_CONFIGURED) and for keeping native ringing
 * (lib/voipPush.ts) silent. There is no simulated / preview call path: without
 * credentials nothing rings anywhere.
 */
export function isCallingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AGORA_APP_ID?.trim() && env.AGORA_APP_CERTIFICATE?.trim());
}
