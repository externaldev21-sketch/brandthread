import { Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Input, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Discover() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Discover</Title>
      <Input placeholder="Search brands, products, and people" />
      {['Trending brands', 'New drops', 'Made in USA', 'Streetwear', 'Luxury basics'].map(x => (
        <Card key={x}>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '900' }}>{x}</Text>
          <Text style={{ color: theme.muted, marginTop: 8 }}>Explore curated Brandthread collections.</Text>
        </Card>
      ))}
    </Screen>
  );
}
