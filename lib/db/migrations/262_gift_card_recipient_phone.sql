-- 262: A gift card can be sent by text message. The recipient's phone is kept
-- in E.164 ("+15551234567") and is NULL for cards sent by email or bought for
-- oneself.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS recipient_phone TEXT;
