import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, Subtitle, Title } from '@/components/UI';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';

export default function AccountType() {
  const { setAccountType } = useApp();
  const { theme } = useTheme();

  const choose = (type: 'buyer' | 'seller') => {
    setAccountType(type);
    router.push('/onboarding/profile');
  };

  return (
    <Screen>
      <Title>How will you use Brandthread?</Title>
      <Subtitle>You can add more capabilities later.</Subtitle>

      <Pressable onPress={() => choose('buyer')}>
        <Card style={{ minHeight: 170, justifyContent: 'space-between' }}>
          <Text style={{ color: theme.text, fontSize: 26, fontWeight: '900' }}>Buyer</Text>
          <Text style={{ color: theme.muted, lineHeight: 22 }}>
            Discover brands, watch seller content, shop tagged products, follow friends, and track orders.
          </Text>
        </Card>
      </Pressable>

      <Pressable onPress={() => choose('seller')}>
        <Card style={{ minHeight: 170, justifyContent: 'space-between' }}>
          <Text style={{ color: theme.text, fontSize: 26, fontWeight: '900' }}>Seller</Text>
          <Text style={{ color: theme.muted, lineHeight: 22 }}>
            Build and operate your clothing brand from design through manufacturing, sales, and fulfillment.
          </Text>
        </Card>
      </Pressable>
    </Screen>
  );
}
