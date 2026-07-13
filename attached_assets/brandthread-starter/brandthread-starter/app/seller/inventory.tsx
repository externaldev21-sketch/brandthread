import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Page() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Inventory</Title>
      ['Stock by product and variant', 'Low-stock alerts', 'Preorder allocation', 'Warehouse and manufacturer stock'].map ? null : null
      {['Stock by product and variant', 'Low-stock alerts', 'Preorder allocation', 'Warehouse and manufacturer stock'].map(item => (
        <Card key={item}>
          <Text style={{ color: theme.text, fontWeight: '900' }}>{item}</Text>
        </Card>
      ))}
    </Screen>
  );
}
