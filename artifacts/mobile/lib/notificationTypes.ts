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
  { key: 'order_updates',   label: 'Order updates',         description: 'Confirmed, shipped, delivered, and refunded' },
  { key: 'return_updates',  label: 'Returns',               description: 'Updates on your return and refund requests' },
  { key: 'messages',        label: 'Messages',              description: 'Direct messages and group chats' },
  { key: 'friend_activity', label: 'Social',                description: 'Followers, likes, comments, and mentions' },
  { key: 'new_drops',       label: 'Drops and live',        description: 'Drops and live shows from brands you follow' },
  { key: 'price_alerts',    label: 'Price and stock',       description: 'Price drops and restocks on saved items' },
  { key: 'cart_reminders',  label: 'Cart reminders',        description: 'Items you left in your cart' },
];

export const SELLER_NOTIFICATION_TYPES: NotificationTypeRow[] = [
  { key: 'new_orders',            label: 'New orders',            description: 'When a customer places an order' },
  { key: 'production_milestones', label: 'Production milestones', description: 'Sampling, production, and fulfillment progress' },
  { key: 'payout_confirmations',  label: 'Payouts',               description: 'Payout sent, completed, or delayed' },
  { key: 'customer_messages',     label: 'Customer messages',     description: 'Messages and replies from customers' },
  { key: 'disputes',              label: 'Disputes',              description: 'New disputes and case updates' },
  { key: 'inventory_alerts',      label: 'Inventory alerts',      description: 'Low stock and out-of-stock' },
  { key: 'subscription_trial',    label: 'Trial reminders',       description: 'Before your free trial converts to paid' },
];
