-- 534: "Gift this" at checkout. The buyer marks the order as a gift with an
-- optional To / From / message. Stored on the checkout session, then copied
-- onto every order the session creates (one per seller). A gift order's
-- packing slip prints as a gift receipt with prices hidden.
ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gift_to TEXT,
  ADD COLUMN IF NOT EXISTS gift_from TEXT,
  ADD COLUMN IF NOT EXISTS gift_message TEXT;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gift_to TEXT,
  ADD COLUMN IF NOT EXISTS gift_from TEXT,
  ADD COLUMN IF NOT EXISTS gift_message TEXT;
