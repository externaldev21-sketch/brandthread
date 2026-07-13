import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { orders } from '@/mock';
import { useTheme } from '@/context/ThemeContext';

export default function SellerDashboard() {
  const { theme } = useTheme();
  const stats = [
    ['Revenue', '$24,820'],
    ['Orders', '184'],
    ['Conversion', '4.8%'],
    ['Pending payout', '$7,460']
  ];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>Dashboard</Title>
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.border }} />
      </View>

      <Card>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '900' }}>Finish setting up your brand</Text>
        <Text style={{ color: theme.muted, marginTop: 6 }}>3 of 6 steps complete</Text>
        <View style={{ height: 8, borderRadius: 999, backgroundColor: theme.border, marginTop: 14 }}>
          <View style={{ width: '50%', height: 8, borderRadius: 999, backgroundColor: theme.accent }} />
        </View>
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {stats.map(([label, value]) => (
          <Card key={label} style={{ width: '48%' }}>
            <Text style={{ color: theme.muted }}>{label}</Text>
            <Text style={{ color: theme.text, fontSize: 22, fontWeight: '900', marginTop: 8 }}>{value}</Text>
          </Card>
        ))}
      </View>

      <Text style={{ color: theme.text, fontSize: 20, fontWeight: '900' }}>Quick actions</Text>
      {[
        ['Create a design', '/seller/studio'],
        ['Add a product', '/seller/products'],
        ['Find a manufacturer', '/seller/manufacturers'],
        ['Build your storefront', '/seller/store-builder'],
        ['Create a Thread post', '/seller/content']
      ].map(([label, route]) => (
        <Pressable key={label} onPress={() => router.push(route as never)}>
          <Card><Text style={{ color: theme.text, fontWeight: '800' }}>{label}</Text></Card>
        </Pressable>
      ))}

      <Text style={{ color: theme.text, fontSize: 20, fontWeight: '900' }}>Recent orders</Text>
      {orders.map(order => (
        <Card key={order.id}>
          <Text style={{ color: theme.text, fontWeight: '900' }}>{order.id} · {order.customer}</Text>
          <Text style={{ color: theme.muted, marginTop: 6 }}>{order.status} · ${order.total}</Text>
        </Card>
      ))}
    </Screen>
  );
}
