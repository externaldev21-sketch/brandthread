import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/UI';
import { posts } from '@/mock';
import { useTheme } from '@/context/ThemeContext';

export default function Thread() {
  const { theme } = useTheme();

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={{ color: theme.text, fontSize: 30, fontWeight: '900' }}>Thread</Text>
        <Ionicons name="notifications-outline" size={25} color={theme.text} />
      </View>

      <View style={{ flexDirection: 'row', gap: 14 }}>
        {['You', 'Null', 'Static', 'NVR'].map((x, i) => (
          <View key={x} style={{ alignItems: 'center', gap: 6 }}>
            <View style={[styles.story, { borderColor: i === 0 ? theme.border : theme.accent }]} />
            <Text style={{ color: theme.muted, fontSize: 12 }}>{x}</Text>
          </View>
        ))}
      </View>

      {posts.map(post => (
        <Card key={post.id} style={{ padding: 0, overflow: 'hidden' }}>
          <View style={{ padding: 14 }}>
            <Text style={{ color: theme.text, fontWeight: '900', fontSize: 16 }}>{post.sellerName}</Text>
            <Text style={{ color: theme.muted }}>{post.sellerHandle}</Text>
          </View>
          <Image source={post.image} style={{ width: '100%', aspectRatio: 0.82 }} contentFit="cover" />
          <View style={{ padding: 14, gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <Ionicons name="heart-outline" size={25} color={theme.text} />
              <Ionicons name="chatbubble-outline" size={23} color={theme.text} />
              <Ionicons name="repeat-outline" size={25} color={theme.text} />
              <Ionicons name="paper-plane-outline" size={23} color={theme.text} />
            </View>
            <Text style={{ color: theme.text, fontWeight: '800' }}>{post.likes.toLocaleString()} likes</Text>
            <Text style={{ color: theme.text, lineHeight: 21 }}>{post.caption}</Text>

            {post.product && (
              <Pressable style={[styles.product, { borderColor: theme.border }]}>
                <Image source={post.product.image} style={{ width: 52, height: 52, borderRadius: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontWeight: '800' }}>{post.product.name}</Text>
                  <Text style={{ color: theme.muted }}>${post.product.price}</Text>
                </View>
                <Text style={{ color: theme.text, fontWeight: '900' }}>Buy</Text>
              </Pressable>
            )}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  story: { width: 64, height: 64, borderRadius: 32, borderWidth: 3 },
  product: { borderWidth: 1, borderRadius: 16, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }
});
