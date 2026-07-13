import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';

export default function Index() {
  const { theme } = useTheme();

  useEffect(() => {
    const timer = setTimeout(() => router.replace('/welcome'), 900);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}>
      <Text style={{ color: theme.text, fontSize: 42, fontWeight: '900', letterSpacing: -2 }}>Brandthread</Text>
      <Text style={{ color: theme.muted, marginTop: 10 }}>Build the brand. Run the business.</Text>
    </View>
  );
}
