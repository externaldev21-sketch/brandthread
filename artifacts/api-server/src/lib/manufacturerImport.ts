/**
 * CSV parsing + validation for scripts/importManufacturers.ts (real factories
 * Dev recruits). Kept in src/ so it is unit tested.
 *
 * Columns (header row required, order free, case-insensitive):
 *   company_name   required  Registered business name
 *   contact_email  required  Where the invite goes
 *   country        required  Country of the factory
 *   contact_name   optional  Greeting name
 *   specialty      optional  e.g. Knitwear, Denim, Cut & Sew
 *   city           optional
 *   website        optional  For Dev's records only; never published by the import
 *   phone          optional  For Dev's records only
 *   source         optional  Where the lead came from (trade show, referral…)
 *   notes          optional  Private note
 */

export const IMPORT_COLUMNS = [
  "company_name", "contact_email", "country", "contact_name", "specialty", "city", "website", "phone", "source", "notes",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export const REQUIRED_IMPORT_COLUMNS: ImportColumn[] = ["company_name", "contact_email", "country"];

export type ManufacturerLead = Record<ImportColumn, string>;
export type LeadProblem = { line: number; problem: string };

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseManufacturerLeads(text: string): { leads: Array<ManufacturerLead & { line: number }>; problems: LeadProblem[] } {
  const rows = parseCsv(text);
  const problems: LeadProblem[] = [];
  if (rows.length === 0) return { leads: [], problems: [{ line: 1, problem: "The file is empty." }] };
  const header = rows[0].map((name) => name.trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = REQUIRED_IMPORT_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length) return { leads: [], problems: [{ line: 1, problem: `Missing column(s): ${missing.join(", ")}` }] };
  const unknown = header.filter((name) => name && !(IMPORT_COLUMNS as readonly string[]).includes(name));
  if (unknown.length) problems.push({ line: 1, problem: `Ignored unknown column(s): ${unknown.join(", ")}` });

  const leads: Array<ManufacturerLead & { line: number }> = [];
  const seenEmails = new Set<string>();
  rows.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const lead = Object.fromEntries(IMPORT_COLUMNS.map((column) => {
      const at = header.indexOf(column);
      return [column, at >= 0 ? (cells[at] ?? "").trim() : ""];
    })) as ManufacturerLead;
    lead.contact_email = lead.contact_email.toLowerCase();
    const missingValues = REQUIRED_IMPORT_COLUMNS.filter((column) => !lead[column]);
    if (missingValues.length) { problems.push({ line, problem: `Missing ${missingValues.join(", ")}` }); return; }
    if (!EMAIL_RE.test(lead.contact_email)) { problems.push({ line, problem: `Invalid email "${lead.contact_email}"` }); return; }
    if (seenEmails.has(lead.contact_email)) { problems.push({ line, problem: `Duplicate email ${lead.contact_email} in this file` }); return; }
    if (lead.company_name.length > 200) { problems.push({ line, problem: "company_name is over 200 characters" }); return; }
    seenEmails.add(lead.contact_email);
    leads.push({ ...lead, line });
  });
  return { leads, problems };
}

export function inviteEmailCopy(input: { contactName?: string; companyName: string; joinUrl: string; sellerName?: string | null }) {
  const greeting = input.contactName ? `Hi ${input.contactName},` : "Hi,";
  const intro = input.sellerName
    ? `${input.sellerName} wants to make their collection with ${input.companyName} and invited you to Brandthread.`
    : `Independent fashion brands on Brandthread are looking for factories like ${input.companyName}.`;
  return {
    subject: input.sellerName ? `${input.sellerName} invited ${input.companyName} to Brandthread` : `List ${input.companyName} on Brandthread`,
    paragraphs: [
      greeting,
      intro,
      "Brandthread is where brands send you their designs, you price samples and bulk orders as cards in the chat, update production as you go, and get paid to your bank through Stripe.",
      "Free to join. 5% + processing on paid orders. No listing fee.",
    ],
    joinUrl: input.joinUrl,
  };
}
