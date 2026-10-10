-- IP takedown workflow (Apple 5.2 / DMCA): seller notification, counter-notice
-- tracking, and a repeat-infringer strike counter. Every statement is safe on retries.

-- Case: who owns the reported listing, what happened to it, and the DMCA-style
-- statements captured by the public notice form.
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS seller_id text;
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'app';
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS good_faith_statement boolean NOT NULL DEFAULT false;
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS accuracy_statement boolean NOT NULL DEFAULT false;
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS takedown_at timestamp with time zone;
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS seller_notified_at timestamp with time zone;
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS strike_applied_at timestamp with time zone;
-- 'none' | 'received' | 'reinstated' | 'upheld'
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS counter_notice_status text NOT NULL DEFAULT 'none';
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS counter_notice_statement text;
ALTER TABLE ip_cases ADD COLUMN IF NOT EXISTS counter_notice_received_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS ip_cases_seller_idx ON ip_cases (seller_id);
CREATE INDEX IF NOT EXISTS ip_cases_counter_notice_idx ON ip_cases (counter_notice_status) WHERE counter_notice_status <> 'none';

-- Seller: strike counter and the repeat-infringer flag moderators act on.
ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_strike_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_repeat_infringer boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_repeat_infringer_flagged_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS users_ip_repeat_infringer_idx ON users (ip_strike_count DESC) WHERE ip_strike_count > 0;
