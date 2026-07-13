import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Page() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Customers & Marketing</Title>
      ['Customer profiles', 'Segments', 'Email and SMS integrations', 'Abandoned checkout flows', 'Discounts and campaigns'].map ? null : null
      {['Customer profiles', 'Segments', 'Email and SMS integrations', 'Abandoned checkout flows', 'Discounts and campaigns'].map(item => (
        <Card key={item}>
          <Text style={{ color: theme.text, fontWeight: '900' }}>{item}</Text>
        </Card>
      ))}
    </Screen>
  );
}
