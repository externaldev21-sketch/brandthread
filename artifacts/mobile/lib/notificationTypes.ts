/**
 * Notification types shown in Settings → Notifications → Email & in-app.
 * Keys match the api-server preference keys (routes/notification-prefs.ts);
 * the push switches for the same keys live on the existing settings screens.
 */
export interface NotificationTypeRow {
  key: string;
  label: string;
  description: string;
}

export const BUYER_NOTIFICATION_TYPES: NotificationTypeRow[] = [
  { key: 'order_updates',   label: 'Order updates',         description: 'Shipped, delivered, refunds' },
  { key: 'return_updates',  label: 'Returns',               description: 'Return and refund requests' },
  { key: 'messages',        label: 'Messages',              description: 'Direct and group chats' },
  { key: 'friend_activity', label: 'Social',                description: 'Follows, likes, and comments' },
  { key: 'new_drops',       label: 'Drops and live',        description: 'Drops and live from brands' },
  { key: 'price_alerts',    label: 'Price and stock',       description: 'Price drops and restocks' },
  { key: 'cart_reminders',  label: 'Cart reminders',        description: 'Items left in your cart' },
];

export const SELLER_NOTIFICATION_TYPES: NotificationTypeRow[] = [
  { key: 'new_orders',            label: 'New orders',            description: 'A customer places an order' },
  { key: 'production_milestones', label: 'Production milestones', description: 'Sampling and production' },
  { key: 'payout_confirmations',  label: 'Payouts',               description: 'Payout sent or delayed' },
  { key: 'customer_messages',     label: 'Customer messages',     description: 'Messages from customers' },
  { key: 'disputes',              label: 'Disputes',              description: 'Disputes and case updates' },
  { key: 'inventory_alerts',      label: 'Inventory alerts',      description: 'Low and out of stock' },
  { key: 'subscription_trial',    label: 'Trial reminders',       description: 'Before your trial converts' },
];
