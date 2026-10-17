-- 280: Structured seller DMCA counter-notice (17 U.S.C. § 512(g)(3)).
-- The plain-text counter_notice_statement (migration 231) keeps the full
-- rendered notice for the moderation queue; this column keeps each legally
-- required element (name, address, phone, identification of the removed
-- material, penalty-of-perjury and jurisdiction statements, signature, signed
-- time) so it can be forwarded to the claimant verbatim. Additive only.
ALTER TABLE ip_cases
  ADD COLUMN IF NOT EXISTS counter_notice_details JSONB;
