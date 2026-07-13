import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Page() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Store Builder</Title>
      ['Theme editor', 'Homepage sections', 'Product pages', 'Custom domain', 'Checkout settings'].map ? null : null
      {['Theme editor', 'Homepage sections', 'Product pages', 'Custom domain', 'Checkout settings'].map(item => (
        <Card key={item}>
          <Text style={{ color: theme.text, fontWeight: '900' }}>{item}</Text>
        </Card>
      ))}
    </Screen>
  );
}
