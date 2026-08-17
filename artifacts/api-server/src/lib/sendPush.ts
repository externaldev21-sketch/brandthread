/**
 * Expo Push Notification sender.
 * Calls https://exp.host/--/api/v2/push/send in chunks of 100.
 * Does not throw — push delivery is best-effort.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

export interface PushMessage {
  to: string;            // Expo push token, e.g. "ExponentPushToken[...]"
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;    // Android
}

export async function sendPushNotifications(
  messages: PushMessage[]
): Promise<{ sent: number; errors: number }> {
  let sent = 0;
  let errors = 0;

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(chunk),
      });
      if (res.ok) {
        const json = await res.json() as { data?: { status: string }[] };
        // Each item in data[] has a status of 'ok' or 'error'
        const data: { status: string }[] = json?.data ?? [];
        sent   += data.filter((d) => d.status === "ok").length;
        errors += data.filter((d) => d.status !== "ok").length;
      } else {
        errors += chunk.length;
      }
    } catch {
      errors += chunk.length;
    }
  }

  return { sent, errors };
}
