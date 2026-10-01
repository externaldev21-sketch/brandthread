/** Renders a campaign into table-based, inline-styled HTML (black/white) plus a plain-text part. */
import type { CampaignBody } from "./validation";

export type RenderProduct = { id: string; name: string; imageUrl: string | null; priceCents: number | null };

export type RenderInput = {
  storeName: string;
  subject: string;
  preheader: string;
  body: CampaignBody;
  products: RenderProduct[];
  storeUrl: string | null;
  postalAddress: string | null;
  /** null for test sends, which have no subscriber to unsubscribe. */
  unsubscribeUrl: string | null;
  isTest?: boolean;
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function money(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

const FONT = "Inter,-apple-system,Segoe UI,Helvetica,Arial,sans-serif";

export function renderCampaign(input: RenderInput): { html: string; text: string } {
  const { body, products } = input;
  const parts: string[] = [];

  if (body.imageUrl) {
    parts.push(`<tr><td style="padding:0 0 24px;"><img src="${escapeHtml(body.imageUrl)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;"></td></tr>`);
  }
  if (body.headline) {
    parts.push(`<tr><td style="padding:0 0 16px;font:700 28px/1.15 ${FONT};color:#000000;">${escapeHtml(body.headline)}</td></tr>`);
  }
  if (body.text) {
    const paras = body.text.split(/\n{2,}/).map((p) =>
      `<p style="margin:0 0 14px;font:400 16px/1.6 ${FONT};color:#111111;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
    parts.push(`<tr><td style="padding:0 0 10px;">${paras}</td></tr>`);
  }
  if (products.length > 0) {
    const cells = products.map((p) => {
      const img = p.imageUrl && /^https:\/\//i.test(p.imageUrl)
        ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" width="170" style="display:block;width:100%;height:auto;border:0;background:#f2f2f2;">`
        : `<div style="height:170px;background:#f2f2f2;"></div>`;
      const href = input.storeUrl ? ` href="${escapeHtml(input.storeUrl)}"` : "";
      return `<td valign="top" width="${Math.floor(100 / products.length)}%" style="padding:0 6px 20px;">
        <a${href} style="text-decoration:none;color:#000000;">${img}
        <div style="padding-top:8px;font:600 14px/1.3 ${FONT};color:#000000;">${escapeHtml(p.name)}</div>
        ${p.priceCents != null ? `<div style="font:400 14px/1.3 ${FONT};color:#555555;">${money(p.priceCents)}</div>` : ""}</a></td>`;
    }).join("");
    parts.push(`<tr><td style="padding:10px 0 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`);
  }
  if (body.cta) {
    parts.push(`<tr><td style="padding:10px 0 28px;"><a href="${escapeHtml(body.cta.url)}" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;font:600 15px/1 ${FONT};padding:14px 28px;">${escapeHtml(body.cta.label)}</a></td></tr>`);
  }

  const footerLines: string[] = [];
  footerLines.push(`You are receiving this because you joined the ${escapeHtml(input.storeName)} email list.`);
  if (input.postalAddress) footerLines.push(escapeHtml(input.postalAddress).replace(/\n/g, "<br>"));
  const unsub = input.unsubscribeUrl
    ? `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#555555;">Unsubscribe</a>`
    : "Unsubscribe link is active in real sends";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
<tr><td style="padding:0 0 24px;font:700 13px/1 ${FONT};letter-spacing:.14em;text-transform:uppercase;color:#000000;">${escapeHtml(input.storeName)}</td></tr>
${input.isTest ? `<tr><td style="padding:0 0 16px;font:600 12px/1 ${FONT};color:#555555;">Test send</td></tr>` : ""}
${parts.join("\n")}
<tr><td style="padding:24px 0 0;border-top:1px solid #e5e5e5;font:400 12px/1.6 ${FONT};color:#555555;">${footerLines.join("<br>")}<br>${unsub}</td></tr>
</table></td></tr></table></body></html>`;

  const textLines: string[] = [];
  if (body.headline) textLines.push(body.headline, "");
  if (body.text) textLines.push(body.text, "");
  for (const p of products) textLines.push(`${p.name}${p.priceCents != null ? ` - ${money(p.priceCents)}` : ""}`);
  if (products.length) textLines.push("");
  if (body.cta) textLines.push(`${body.cta.label}: ${body.cta.url}`, "");
  textLines.push("--", `You are receiving this because you joined the ${input.storeName} email list.`);
  if (input.postalAddress) textLines.push(input.postalAddress);
  if (input.unsubscribeUrl) textLines.push(`Unsubscribe: ${input.unsubscribeUrl}`);
  return { html, text: textLines.join("\n") };
}
