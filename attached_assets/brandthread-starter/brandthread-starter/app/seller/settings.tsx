import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Page() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Settings</Title>
      {['Brand profile', 'Team permissions', 'Payout account', 'Shipping rules', 'Returns and disputes', 'Subscription'].map(item => (
        <Card key={item}>
          <Text style={{ color: theme.text, fontWeight: '900' }}>{item}</Text>
        </Card>
      ))}
    </Screen>
  );
}
