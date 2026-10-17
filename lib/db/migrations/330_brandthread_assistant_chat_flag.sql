-- Brandthread assistant (the pinned "Brandthread" AI chat in every inbox).
-- Additive only. Seeded ON because the agent chat already ships; turning it
-- off makes the assistant reply with its "offline right now" message instead
-- of calling the LLM (the welcome thread and history stay visible).
INSERT INTO feature_flags (key, enabled, description)
VALUES ('brandthreadAssistantChat', true, 'Brandthread assistant: live AI replies in the pinned inbox chat')
ON CONFLICT (key) DO NOTHING;
