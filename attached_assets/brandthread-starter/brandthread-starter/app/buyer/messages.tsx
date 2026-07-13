import { Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Messages() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Messages</Title>
      {['Ari Banks', 'Jordan Miles', 'Maya Cole'].map((name, i) => (
        <Card key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.border }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '900' }}>{name}</Text>
            <Text style={{ color: theme.muted }}>{i === 0 ? 'That drop is crazy 🔥' : 'Sent a post'}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
