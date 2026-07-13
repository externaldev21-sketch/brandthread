import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { orders } from '@/mock';
import { useTheme } from '@/context/ThemeContext';

export default function SellerOrders() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Orders</Title>
      {orders.map(order => (
        <Card key={order.id}>
          <Text style={{ color: theme.text, fontWeight: '900', fontSize: 17 }}>{order.id}</Text>
          <Text style={{ color: theme.text, marginTop: 5 }}>{order.customer}</Text>
          <Text style={{ color: theme.muted, marginTop: 5 }}>{order.status} · ${order.total}</Text>
        </Card>
      ))}
    </Screen>
  );
}
