#!/usr/bin/env -S tsx
/**
 * Imports REAL factories (that Dev has recruited) from a CSV and turns each
 * one into an invite: a join link and, optionally, an invite email. It never
 * creates live directory listings: each factory signs up itself in the
 * Manufacturer Portal, accepts the Manufacturer Terms and is listed once
 * verified. No fake or sample data.
 *
 * CSV columns (header row required; see src/lib/manufacturerImport.ts):
 *   company_name*, contact_email*, country*, contact_name, specialty, city,
 *   website, phone, source, notes
 *
 * Modes:
 *   (default)        DRY RUN: validate the file, flag factories already on
 *                    Brandthread (by contact email), print the plan. Writes nothing.
 *   --apply          Create the invites:
 *                      with --seller <clerkId>: a private invite token per row
 *                        bound to that seller (their own factories);
 *                      without --seller: the public join link (no DB rows).
 *   --send-emails    With --apply: email each invite through the Brandthread
 *                    email provider (RESEND_API_KEY or the Resend connector).
 *                    Without an email key it prints the links instead.
 *   --out <file>     Also write company,email,link rows to a CSV.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx scripts/importManufacturers.ts factories.csv
 *   pnpm --filter @workspace/api-server exec tsx scripts/importManufacturers.ts factories.csv --apply --send-emails
 *   pnpm --filter @workspace/api-server exec tsx scripts/importManufacturers.ts mine.csv --seller user_123 --apply
 *
 * Needs DATABASE_URL for the duplicate check and for --seller invites.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { inviteEmailCopy, parseManufacturerLeads } from "../src/lib/manufacturerImport";
import { getWebOrigin } from "../src/lib/webOrigin";

type Args = { file: string; apply: boolean; sendEmails: boolean; seller: string | null; out: string | null };

function parseArgs(argv: string[]): Args {
  const args: Args = { file: "", apply: false, sendEmails: false, seller: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--apply") args.apply = true;
    else if (value === "--send-emails") args.sendEmails = true;
    else if (value === "--seller") args.seller = argv[++i] ?? null;
    else if (value === "--out") args.out = argv[++i] ?? null;
    else if (value === "--dry-run") args.apply = false;
    else if (!value.startsWith("--")) args.file = value;
  }
  return args;
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error("Usage: importManufacturers.ts <file.csv> [--apply] [--send-emails] [--seller <clerkId>] [--out links.csv]");
    process.exit(2);
  }
  if (args.sendEmails && !args.apply) {
    console.error("--send-emails needs --apply (dry runs never email anyone).");
    process.exit(2);
  }
  const { leads, problems } = parseManufacturerLeads(fs.readFileSync(args.file, "utf8"));
  for (const problem of problems) console.warn(`line ${problem.line}: ${problem.problem}`);
  if (leads.length === 0) { console.error("No valid rows."); process.exit(1); }

  const hasDb = !!process.env.DATABASE_URL;
  if (!hasDb && args.seller) { console.error("--seller invites need DATABASE_URL."); process.exit(2); }
  const dbModule = hasDb ? await import("@workspace/db") : null;

  // Factories already on Brandthread (same contact email) are skipped.
  const existing = new Set<string>();
  if (dbModule) {
    const { db, manufacturers } = dbModule;
    const rows = await db.select({ email: sql<string>`lower(${manufacturers.contactEmail})` }).from(manufacturers)
      .where(inArray(sql`lower(${manufacturers.contactEmail})`, leads.map((lead) => lead.contact_email)));
    rows.forEach((row) => existing.add(row.email));
  } else {
    console.warn("DATABASE_URL not set: skipping the 'already on Brandthread' check.");
  }

  let sellerName: string | null = null;
  if (args.seller && dbModule) {
    const { db, users } = dbModule;
    const [seller] = await db.select({ brandName: users.brandName, displayName: users.displayName, name: users.name })
      .from(users).where(eq(users.clerkId, args.seller)).limit(1);
    if (!seller) { console.error(`Seller ${args.seller} not found.`); process.exit(2); }
    sellerName = seller.brandName?.trim() || seller.displayName?.trim() || seller.name?.trim() || null;
  }

  const origin = getWebOrigin();
  const output: Array<{ company: string; email: string; link: string; status: string }> = [];
  const email = args.sendEmails ? await import("../src/lib/brandthreadEmail") : null;
  if (email && !(await email.isBrandthreadEmailConfigured())) {
    console.warn("Email is not configured (RESEND_API_KEY / Resend connector): links will be printed, not emailed.");
  }

  for (const lead of leads) {
    if (existing.has(lead.contact_email)) {
      output.push({ company: lead.company_name, email: lead.contact_email, link: "", status: "skipped: already on Brandthread" });
      continue;
    }
    let link = `${origin}/manufacturers/join`;
    let status = args.apply ? "public join link" : "dry run";
    if (args.seller && dbModule) {
      const { db, manufacturerInviteTokens } = dbModule;
      const [open] = await db.select({ token: manufacturerInviteTokens.token }).from(manufacturerInviteTokens).where(and(
        eq(manufacturerInviteTokens.sellerId, args.seller),
        eq(manufacturerInviteTokens.contactEmail, lead.contact_email),
        isNull(manufacturerInviteTokens.usedAt),
      )).limit(1);
      if (open) {
        link = `${origin}/manufacturers/join?invite=${encodeURIComponent(open.token)}`;
        status = "existing private invite";
      } else if (args.apply) {
        const token = crypto.randomBytes(24).toString("hex");
        await db.insert(manufacturerInviteTokens).values({
          sellerId: args.seller, token, companyName: lead.company_name, contactName: lead.contact_name || null,
          contactEmail: lead.contact_email, notes: [lead.source && `Source: ${lead.source}`, lead.notes].filter(Boolean).join("\n") || null,
        });
        link = `${origin}/manufacturers/join?invite=${encodeURIComponent(token)}`;
        status = "private invite created";
      } else {
        link = "(private invite link created on --apply)";
      }
    }
    if (email && args.apply && !link.startsWith("(")) {
      const copy = inviteEmailCopy({ contactName: lead.contact_name, companyName: lead.company_name, joinUrl: link, sellerName });
      const html = email.renderBrandthreadEmail({
        preheader: copy.paragraphs[1],
        eyebrow: "Manufacturer invite",
        title: copy.subject,
        bodyHtml: copy.paragraphs.map((p) => `<p>${email.escapeHtml(p)}</p>`).join(""),
        cta: { label: "Create your manufacturer profile", url: link },
      });
      const sent = await email.sendBrandthreadEmail({
        to: lead.contact_email, subject: copy.subject, html,
        idempotencyKey: `manufacturer-import/${crypto.createHash("sha256").update(`${args.seller ?? "public"}:${lead.contact_email}`).digest("hex").slice(0, 32)}`,
      });
      status += sent ? ", emailed" : ", email not sent";
    }
    output.push({ company: lead.company_name, email: lead.contact_email, link, status });
  }

  console.table(output);
  const counts = output.reduce<Record<string, number>>((acc, row) => { acc[row.status] = (acc[row.status] ?? 0) + 1; return acc; }, {});
  console.log(`${args.apply ? "Applied" : "Dry run"}: ${leads.length} valid row(s), ${problems.length} problem(s).`, counts);
  if (args.out) {
    fs.writeFileSync(args.out, ["company,email,link,status", ...output.map((row) =>
      [row.company, row.email, row.link, row.status].map(csvCell).join(","))].join("\n") + "\n");
    console.log(`Wrote ${args.out}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
