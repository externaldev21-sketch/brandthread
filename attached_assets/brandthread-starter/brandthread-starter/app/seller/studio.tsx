import { Text } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Input, PrimaryButton, Subtitle, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Studio() {
  const { theme } = useTheme();
  return (
    <Screen>
      <Title>Design Studio AI</Title>
      <Subtitle>Create designs, mockups, campaign imagery, and product shots.</Subtitle>
      <Input placeholder="Describe the design you want..." multiline style={{ height: 120, paddingTop: 16 }} />
      <PrimaryButton label="Generate concept" onPress={() => {}} />
      {[
        'Text to garment mockup',
        'Mockup to model photoshoot',
        'Prompt-based edits',
        'Background removal',
        'Manual canvas',
        'Saved brand assets'
      ].map(tool => (
        <Card key={tool}><Text style={{ color: theme.text, fontWeight: '900' }}>{tool}</Text></Card>
      ))}
    </Screen>
  );
}
