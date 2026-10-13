-- 270: Seller's time zone for discount code and sale active dates.
-- The start/end instants stay in starts_at / expires_at / ends_at (UTC). This
-- column records the IANA zone the seller picked the wall-clock date and time
-- in, so the edit form shows the same "Oct 20, 9:00 AM" they entered.
-- NULL = saved before date + time pickers existed (date-only values, stored as
-- UTC midnight of the typed date); the app shows those as 12:00 AM on that date.
ALTER TABLE discount_codes
  ADD COLUMN IF NOT EXISTS schedule_time_zone TEXT;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS schedule_time_zone TEXT;
