// Redirect: /orders → the Orders tab
// This file exists for backward compatibility; the full Orders UI lives at (tabs)/orders.tsx
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function OrdersRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/(tabs)/orders' as never); }, []);
  return null;
}
