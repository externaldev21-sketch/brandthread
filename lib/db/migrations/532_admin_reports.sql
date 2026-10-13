-- 532: Internal owner reports (Monday numbers email, inactive-seller digest).
-- admin_report_runs: one row per report per period, claimed before sending so
-- the email goes out exactly once across replicas and restarts.
-- seller_inactivity_alerts: one row per seller per quiet streak (keyed by the
-- last-activity time that started it), so a seller is reported once per streak.
CREATE TABLE IF NOT EXISTS admin_report_runs (
  kind        TEXT NOT NULL,
  period_key  TEXT NOT NULL,
  claimed_at  TIMESTAMP NOT NULL DEFAULT now(),
  sent_at     TIMESTAMP,
  recipients  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, period_key)
);
CREATE TABLE IF NOT EXISTS seller_inactivity_alerts (
  seller_id       TEXT NOT NULL,
  inactive_since  TIMESTAMP NOT NULL,
  alerted_at      TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (seller_id, inactive_since)
);
