import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { orders } from '@/mock';
import { useTheme } from '@/context/ThemeContext';

export default function BuyerOrders() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Your orders</Title>
      {orders.slice(0, 2).map(order => (
        <Card key={order.id}>
          <Text style={{ color: theme.text, fontWeight: '900', fontSize: 17 }}>{order.id}</Text>
          <Text style={{ color: theme.muted, marginTop: 7 }}>Status: {order.status}</Text>
          <Text style={{ color: theme.text, marginTop: 7 }}>${order.total.toFixed(2)}</Text>
        </Card>
      ))}
    </Screen>
  );
}
