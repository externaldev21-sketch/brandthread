-- 533: Thread Cash weekly quests.
-- Moderator-configurable reward for completing all of a week's quests, kept
-- on the single thread_cash_config row next to the other earn amounts.
-- NULL falls back to the code default (50 cents). Additive and idempotent.
-- Claims are thread_cash_entries rows (source 'weekly_quests', reference_id
-- = ISO week key) guarded by the existing unique idempotency_key index, so
-- no new table is needed.
ALTER TABLE thread_cash_config ADD COLUMN IF NOT EXISTS weekly_quest_reward_cents INTEGER DEFAULT 50;

-- Week-streak lookups read a buyer's weekly_quests entries.
CREATE INDEX IF NOT EXISTS thread_cash_entries_weekly_quests_idx
  ON thread_cash_entries (buyer_id, reference_id) WHERE source = 'weekly_quests';
