-- Migration 040: foreign-key lookup indexes
-- PostgreSQL does not automatically index referencing columns. These indexes
-- cover every foreign key not already covered by a primary, unique, or
-- leading composite index.

CREATE INDEX IF NOT EXISTS products_drop_id_idx ON products (drop_id);
CREATE INDEX IF NOT EXISTS product_variants_product_id_idx ON product_variants (product_id);
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_drop_id_idx ON orders (drop_id);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_variant_id_idx ON order_items (variant_id);
CREATE INDEX IF NOT EXISTS interactions_post_id_idx ON interactions (post_id);
CREATE INDEX IF NOT EXISTS reviews_order_id_idx ON reviews (order_id);
CREATE INDEX IF NOT EXISTS bundle_items_bundle_id_idx ON bundle_items (bundle_id);
CREATE INDEX IF NOT EXISTS bundle_items_product_id_idx ON bundle_items (product_id);
CREATE INDEX IF NOT EXISTS bundle_items_variant_id_idx ON bundle_items (variant_id);
CREATE INDEX IF NOT EXISTS storefront_versions_storefront_id_idx ON storefront_versions (storefront_id);
CREATE INDEX IF NOT EXISTS storefront_custom_domains_storefront_id_idx ON storefront_custom_domains (storefront_id);
CREATE INDEX IF NOT EXISTS team_activity_logs_member_id_idx ON team_activity_logs (member_id);
CREATE INDEX IF NOT EXISTS manufacturer_payments_manufacturer_id_idx ON manufacturer_payments (manufacturer_id);
CREATE INDEX IF NOT EXISTS manufacturer_invite_tokens_manufacturer_id_idx ON manufacturer_invite_tokens (manufacturer_id);
CREATE INDEX IF NOT EXISTS manufacturer_threads_manufacturer_id_idx ON manufacturer_threads (manufacturer_id);
CREATE INDEX IF NOT EXISTS manufacturer_messages_thread_id_idx ON manufacturer_messages (thread_id);
CREATE INDEX IF NOT EXISTS manufacturer_orders_manufacturer_id_idx ON manufacturer_orders (manufacturer_id);
CREATE INDEX IF NOT EXISTS sample_orders_wallet_id_idx ON sample_orders (wallet_id);
CREATE INDEX IF NOT EXISTS dwt_sample_order_id_idx ON drop_wallet_transactions (sample_order_id);
CREATE INDEX IF NOT EXISTS sample_image_upload_grants_sample_order_id_idx ON sample_image_upload_grants (sample_order_id);