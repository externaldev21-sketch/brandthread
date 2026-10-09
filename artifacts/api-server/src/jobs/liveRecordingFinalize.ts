import { pollStoppingRecordings } from "../lib/liveReplay";
import { scheduleJob } from "./runner";

/**
 * Agora Cloud Recording finishes uploading to the storage bucket some time
 * after /stop returns (usually seconds, occasionally longer for a long
 * stream). This polls Agora's /query endpoint for streams stuck in
 * recording_status='stopping' and finalizes the replay post once a file is
 * confirmed uploaded — see lib/liveReplay.ts for the finalize logic and the
 * timeout/failure handling.
 *
 * No-ops entirely (fast, cheap check) when Agora Cloud Recording env vars
 * aren't configured.
 */
const INTERVAL_MS = 20_000;

export function startLiveRecordingFinalizeJob(): void {
  scheduleJob("liveRecordingFinalize", () => pollStoppingRecordings(), { intervalMs: INTERVAL_MS, initialDelayMs: 10_000 });
}
