import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Page() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Seller Content</Title>
      ['Create video or slideshow', 'Tag products', 'Add caption', 'Schedule post', 'Publish to Thread'].map ? null : null
      {['Create video or slideshow', 'Tag products', 'Add caption', 'Schedule post', 'Publish to Thread'].map(item => (
        <Card key={item}>
          <Text style={{ color: theme.text, fontWeight: '900' }}>{item}</Text>
        </Card>
      ))}
    </Screen>
  );
}
