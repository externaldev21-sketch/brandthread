-- Seller two-factor authentication (feature 73): when ON, cashing out and
-- changing the payout schedule require 2FA on the signed-in account. Ships
-- OFF until Clerk multi-factor is enabled for the instance.
INSERT INTO feature_flags (key, enabled, description)
VALUES ('sellerTwoFactorRequired', false, 'Require two-factor authentication for seller payout actions')
ON CONFLICT (key) DO NOTHING;
