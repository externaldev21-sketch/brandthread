import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Page() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Manufacturer Hub</Title>
      ['Browse verified manufacturers', 'Invite your own manufacturer', 'Compare price cards', 'Open production workspace', 'Track samples and bulk orders'].map ? null : null
      {['Browse verified manufacturers', 'Invite your own manufacturer', 'Compare price cards', 'Open production workspace', 'Track samples and bulk orders'].map(item => (
        <Card key={item}>
          <Text style={{ color: theme.text, fontWeight: '900' }}>{item}</Text>
        </Card>
      ))}
    </Screen>
  );
}
