import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, PrimaryButton, Title } from '@/components/UI';
import { products } from '@/mock';
import { useTheme } from '@/context/ThemeContext';

export default function Products() {
  const { theme } = useTheme();
  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title>Products</Title>
      </View>
      <PrimaryButton label="Create product" onPress={() => {}} />
      {products.map(product => (
        <Card key={product.id} style={{ flexDirection: 'row', gap: 12 }}>
          <Image source={product.image} style={{ width: 80, height: 90, borderRadius: 16 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '900', fontSize: 17 }}>{product.name}</Text>
            <Text style={{ color: theme.muted, marginTop: 6 }}>${product.price} · {product.fulfillmentType}</Text>
            <Text style={{ color: theme.muted, marginTop: 4 }}>Inventory: {product.inventory}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
