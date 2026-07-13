import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Page() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Analytics</Title>
      ['Revenue', 'Profit', 'Conversion rate', 'Best products', 'Content performance', 'Customer retention'].map ? null : null
      {['Revenue', 'Profit', 'Conversion rate', 'Best products', 'Content performance', 'Customer retention'].map(item => (
        <Card key={item}>
          <Text style={{ color: theme.text, fontWeight: '900' }}>{item}</Text>
        </Card>
      ))}
    </Screen>
  );
}
