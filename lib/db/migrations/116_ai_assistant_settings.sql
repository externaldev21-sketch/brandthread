-- ─── Migration 116: AI assistant settings (per-account) ──────────────────────
-- Server-side source of truth for the toggles on the seller's AI Settings
-- screen (artifacts/mobile/app/ai-settings.tsx): assistant on/off, dashboard
-- suggestions, session + brand memory, confirm-before-action rules, and the
-- per-area data sources the assistant may read. Stored per account so the
-- choice follows the seller across devices, and read by
-- artifacts/api-server/src/routes/ai.ts on every assistant request so a
-- disabled data source is excluded server-side (not just hidden in the UI).
-- One row per user; `settings` is normalized by the API before it is written
-- (see artifacts/api-server/src/lib/aiSettings.ts). Idempotent.

CREATE TABLE IF NOT EXISTS ai_assistant_settings (
  user_id TEXT PRIMARY KEY,
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
