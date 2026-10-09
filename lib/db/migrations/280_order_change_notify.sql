-- 280: Realtime order changes.
-- Every order insert and every status / tracking-status change publishes a
-- small NOTIFY on channel 'order_changed'. The API server LISTENs and forwards
-- it over the per-user messages socket (api-server lib/orderChangeListener.ts)
-- so the seller's Orders and the buyer's order page update live no matter
-- which route, webhook or job made the change. The payload carries ids and
-- statuses only (NOTIFY payloads are limited to 8000 bytes).
CREATE OR REPLACE FUNCTION bt_notify_order_changed() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'order_changed',
    json_build_object(
      'op', lower(TG_OP),
      'id', NEW.id,
      'ownerId', NEW.owner_id,
      'buyerId', NEW.buyer_id,
      'status', NEW.status,
      'trackingStatus', NEW.tracking_status
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_notify_insert ON orders;
CREATE TRIGGER orders_notify_insert
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION bt_notify_order_changed();

DROP TRIGGER IF EXISTS orders_notify_status ON orders;
CREATE TRIGGER orders_notify_status
  AFTER UPDATE OF status, tracking_status ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.tracking_status IS DISTINCT FROM NEW.tracking_status)
  EXECUTE FUNCTION bt_notify_order_changed();
