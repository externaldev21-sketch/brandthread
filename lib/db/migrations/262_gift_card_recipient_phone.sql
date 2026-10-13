-- 262: A gift card can be sent by text message. The recipient's phone is kept
-- in E.164 ("+15551234567") and is NULL for cards sent by email or bought for
-- oneself.
-- delivery_channel records how the code reached the recipient once delivered_at
-- is set: 'email', 'sms' (we texted it) or 'buyer' (the buyer was given the
-- code to send from Messages because we didn't text it).
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS delivery_channel TEXT;
