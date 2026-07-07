import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Badge } from './Badge';

interface ProductCardProps {
  name: string;
  category: string;
  price: string;
  stock: number;
  colorDot?: string;
  onPress?: () => void;
}

export function ProductCard({ name, category, price, stock, colorDot = '#C9A96E', onPress }: ProductCardProps) {
  const colors = useColors();
  const stockVariant = stock === 0 ? 'error' : stock < 10 ? 'warning' : 'success';
  const stockLabel = stock === 0 ? 'Out of stock' : stock < 10 ? `Low: ${stock}` : `In stock: ${stock}`;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.image, { backgroundColor: colorDot + '33' }]}>
        <View style={[styles.dot, { backgroundColor: colorDot }]} />
      </View>
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>{name}</Text>
        <Text style={[styles.category, { color: colors.mutedForeground }]}>{category}</Text>
        <Badge label={stockLabel} variant={stockVariant} />
      </View>
      <View style={styles.right}>
        <Text style={[styles.price, { color: colors.primary }]}>{price}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
    gap: 12,
  },
  image: {
    width: 56,
    height: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  category: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  right: { alignItems: 'flex-end' },
  price: { fontSize: 16, fontFamily: 'Inter_700Bold' },
});
