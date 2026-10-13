-- 533: Kill switches for Live, Payments and AI (api-server lib/killSwitches.ts).
-- Rows in the existing feature_flags table, ON by default. An admin sets one to
-- false from Admin → Kill switches to pause that area for everyone.
INSERT INTO feature_flags (key, enabled, description)
VALUES
  ('liveEnabled', true, 'Kill switch: going live, joining a live and live tips'),
  ('paymentsEnabled', true, 'Kill switch: new checkouts and gift card purchases (webhooks, refunds and payouts keep working)'),
  ('aiEnabled', true, 'Kill switch: every AI generation and chat endpoint')
ON CONFLICT (key) DO NOTHING;
