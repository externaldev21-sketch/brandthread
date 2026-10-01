/** Conservative bot / prefetch detection so link analytics count people. */

const BOT_UA =
  /(bot|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegram|twitterbot|linkedin|slack|discord|embedly|skype|pinterest|applebot|bingpreview|googleother|google-|mediapartners|lighthouse|pingdom|uptime|monitor|headless|phantomjs|preview|curl\/|wget\/|python-requests|python-urllib|aiohttp|go-http-client|node-fetch|axios\/|undici|libwww|java\/|httpclient|okhttp-bot|scrapy|postman|insomnia|httpie)/i;

export type BotCheckInput = {
  method?: string;
  userAgent?: string | null;
  headers?: Record<string, string | string[] | undefined>;
};

function header(h: BotCheckInput["headers"], name: string): string {
  const v = h?.[name];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function isBotRequest(input: BotCheckInput): boolean {
  if (input.method && input.method.toUpperCase() === "HEAD") return true;
  const ua = (input.userAgent ?? "").trim();
  if (ua.length < 8) return true; // empty / absurdly short UA is never a real browser
  if (BOT_UA.test(ua)) return true;
  const purpose = `${header(input.headers, "purpose")} ${header(input.headers, "sec-purpose")} ${header(input.headers, "x-moz")}`.toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender") || purpose.includes("preview")) return true;
  return false;
}
