import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function More() {
  const { theme } = useTheme();
  const items = [
    ['Manufacturers', '/seller/manufacturers'],
    ['Inventory', '/seller/inventory'],
    ['Store Builder', '/seller/store-builder'],
    ['Customers & Marketing', '/seller/customers'],
    ['Analytics', '/seller/analytics'],
    ['Content Creator', '/seller/content'],
    ['Settings', '/seller/settings']
  ];

  return (
    <Screen>
      <Title>More</Title>
      {items.map(([label, route]) => (
        <Pressable key={label} onPress={() => router.push(route as never)}>
          <Card><Text style={{ color: theme.text, fontWeight: '900' }}>{label}</Text></Card>
        </Pressable>
      ))}
    </Screen>
  );
}
