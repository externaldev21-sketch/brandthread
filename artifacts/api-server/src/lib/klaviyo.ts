/**
 * Minimal client for the Klaviyo REST API, used to validate a seller's
 * Private API Key and pull their existing email/SMS subscriber counts.
 * Docs: https://developers.klaviyo.com/en/reference/api_overview
 */

const KLAVIYO_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

export class KlaviyoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function authHeaders(apiKey: string) {
  return {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: KLAVIYO_REVISION,
    Accept: "application/json",
  };
}

/** Validates the API key and returns basic account info. Throws KlaviyoError if invalid. */
export async function fetchKlaviyoAccount(apiKey: string): Promise<{ accountId: string; companyName: string | null }> {
  const res = await fetch(`${KLAVIYO_BASE}/accounts/`, { headers: authHeaders(apiKey) });
  if (res.status === 401 || res.status === 403) {
    throw new KlaviyoError("Invalid Klaviyo API key", 401);
  }
  if (!res.ok) {
    throw new KlaviyoError(`Klaviyo API error (${res.status})`, res.status);
  }
  const body = await res.json();
  const account = body?.data?.[0];
  return {
    accountId: account?.id ?? "",
    companyName: account?.attributes?.contact_information?.organization_name ?? null,
  };
}

/**
 * Fetches the seller's lists with profile counts, then aggregates a rough
 * email vs. SMS subscriber count by checking marketing consent on profiles
 * within those lists (subscriber counts on the list resource itself
 * represent all channel subscribers combined in Klaviyo's model).
 */
export async function fetchKlaviyoSubscriberSummary(apiKey: string): Promise<{
  listCount: number;
  emailSubscriberCount: number;
  smsSubscriberCount: number;
}> {
  const listsRes = await fetch(
    `${KLAVIYO_BASE}/lists/?additional-fields[list]=profile_count`,
    { headers: authHeaders(apiKey) },
  );
  if (!listsRes.ok) {
    throw new KlaviyoError(`Failed to fetch Klaviyo lists (${listsRes.status})`, listsRes.status);
  }
  const listsBody = await listsRes.json();
  const lists: any[] = listsBody?.data ?? [];
  const listCount = lists.length;

  // Klaviyo doesn't split list profile_count by channel, so pull real
  // subscribed counts via the marketing-consent segments Klaviyo maintains
  // automatically for every account.
  const [emailCount, smsCount] = await Promise.all([
    fetchConsentedProfileCount(apiKey, "email"),
    fetchConsentedProfileCount(apiKey, "sms"),
  ]);

  return { listCount, emailSubscriberCount: emailCount, smsSubscriberCount: smsCount };
}

async function fetchConsentedProfileCount(apiKey: string, channel: "email" | "sms"): Promise<number> {
  const filter =
    channel === "email"
      ? `equals(subscriptions.email.marketing.consent,'SUBSCRIBED')`
      : `equals(subscriptions.sms.marketing.consent,'SUBSCRIBED')`;
  // Klaviyo's cursor pagination has no total-count field, so we walk pages
  // at the max page size (100) and sum them. Capped at 500 pages (~50k
  // profiles) so one seller's huge list can't stall a connect/sync request.
  let url: string | null =
    `${KLAVIYO_BASE}/profiles/?filter=${encodeURIComponent(filter)}&page[size]=100`;
  let count = 0;
  let guard = 0;
  while (url && guard < 500) {
    const res: Response = await fetch(url, { headers: authHeaders(apiKey) });
    if (!res.ok) break;
    const body = await res.json();
    count += Array.isArray(body?.data) ? body.data.length : 0;
    url = body?.links?.next ?? null;
    guard += 1;
  }
  return count;
}
