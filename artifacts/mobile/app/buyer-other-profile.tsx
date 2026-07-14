import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  StyleSheet, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import {
  BG, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM,
  GRAD_PRIMARY, FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  getFriendships, getFriendRequests, sendFriendRequest,
  acceptFriendRequest, declineFriendRequest, createOrGetConversation,
  blockUser, subscribeSocial,
} from '@/services/socialService';
import type { Friendship, FriendRequest, FriendshipStatus } from '@/services/socialTypes';

const { width } = Dimensions.get('window');
const GRID_GAP = 2;
const CELL_SIZE = (width - GRID_GAP * 2) / 3;

// Demo posts for other profiles
const DEMO_OTHER_POSTS = [
  { id: 'op1', mediaColors: ['#1a1a2e', '#0d0d1a'], type: 'photo', caption: 'Style check' },
  { id: 'op2', mediaColors: ['#0d1a0d', '#0a140a'], type: 'slideshow', caption: 'New fits' },
  { id: 'op3', mediaColors: ['#1a0d00', '#140a00'], type: 'video', caption: 'Unboxing' },
  { id: 'op4', mediaColors: ['#1a1a2e', '#161630'], type: 'photo', caption: 'OOTD' },
  { id: 'op5', mediaColors: ['#0d1a1a', '#0a1414'], type: 'photo', caption: 'Vintage' },
  { id: 'op6', mediaColors: ['#1a0d1a', '#140a14'], type: 'slideshow', caption: 'Haul' },
];

export default function BuyerOtherProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ userId: string; name: string; handle: string; initials: string; color: string }>();

  const userId = params.userId || 'u_unknown';
  const name = params.name || 'Unknown';
  const handle = params.handle || '@unknown';
  const initials = params.initials || '?';
  const color = params.color || '#8B5CF6';

  const [friendship, setFriendship] = useState<Friendship | null>(null);
  const [friendshipStatus, setFriendshipStatus] = useState<FriendshipStatus | null>(null);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    const [friendships, requests] = await Promise.all([
      getFriendships(),
      getFriendRequests(),
    ]);
    const found = friendships.find(f => f.userId === userId) || null;
    setFriendship(found);
    setFriendshipStatus(found?.status || null);
    setFriendRequests(requests);
  }, [userId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); });
    return unsub;
  }, [loadData]);

  const postTypeIcon = (type: string): string => {
    if (type === 'photo') return 'image';
    if (type === 'slideshow') return 'layers';
    return 'video';
  };

  const handleAddFriend = async () => {
    setLoading(true);
    try {
      await sendFriendRequest({ userId, name, handle, initials, color });
      await loadData();
    } catch {
      Alert.alert('Error', 'Could not send friend request.');
    } finally {
      setLoading(false);
    }
  };

  const handleMessage = async () => {
    setLoading(true);
    try {
      const conv = await createOrGetConversation({
        type: 'buyer_to_buyer',
        participant: { userId, name, handle, initials, color, accountType: 'buyer' },
      });
      router.push((`/buyer-conversation?id=${conv.id}`) as any);
    } catch {
      Alert.alert('Error', 'Could not open conversation.');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    const req = friendRequests.find(r => r.fromId === userId);
    if (!req) return;
    setLoading(true);
    try {
      await acceptFriendRequest(req.id);
      await loadData();
    } catch {
      Alert.alert('Error', 'Could not accept request.');
    } finally {
      setLoading(false);
    }
  };

  const handleDecline = async () => {
    const req = friendRequests.find(r => r.fromId === userId);
    if (!req) return;
    setLoading(true);
    try {
      await declineFriendRequest(req.id);
      await loadData();
    } catch {
      Alert.alert('Error', 'Could not decline request.');
    } finally {
      setLoading(false);
    }
  };

  const handleMore = () => {
    Alert.alert(name, undefined, [
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          await blockUser({ userId, name, handle, initials, color });
          Alert.alert('Blocked', `${name} has been blocked.`);
          router.back();
        },
      },
      {
        text: 'Report',
        onPress: () =>
          router.push(
            `/buyer-report?targetType=profile&targetId=${userId}&targetLabel=${encodeURIComponent(name)}&targetUserId=${userId}` as any,
          ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const isAccepted = friendshipStatus === 'accepted';
  const isPendingSent = friendshipStatus === 'pending_sent';
  const isPendingReceived = friendshipStatus === 'pending_received';
  const noFriendship = !friendshipStatus;

  // For demo: treat all profiles as public
  const isPrivate = false;
  const canSeePosts = !isPrivate || isAccepted;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Back Button */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + SP.md }]}
        onPress={() => router.back()}
      >
        <Feather name="arrow-left" size={ICON.md} color={FG} />
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
        {/* Cover */}
        <LinearGradient
          colors={[color, BG] as [string, string]}
          style={styles.cover}
        />

        {/* Profile Row */}
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: color }]}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>

          <View style={styles.actionButtons}>
            {isAccepted && (
              <>
                <TouchableOpacity
                  onPress={handleMessage}
                  disabled={loading}
                  style={styles.primaryBtnWrap}
                >
                  <LinearGradient
                    colors={GRAD_PRIMARY as unknown as [string, string]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryBtn}
                  >
                    <Text style={styles.primaryBtnText}>Message</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity style={styles.moreBtn} onPress={handleMore}>
                  <Feather name="more-horizontal" size={ICON.md} color={FG} />
                </TouchableOpacity>
              </>
            )}

            {isPendingSent && (
              <>
                <View style={[styles.outlineBtn, styles.disabledBtn]}>
                  <Text style={styles.outlineBtnText}>Requested</Text>
                </View>
                <TouchableOpacity style={styles.moreBtn} onPress={handleMore}>
                  <Feather name="more-horizontal" size={ICON.md} color={FG} />
                </TouchableOpacity>
              </>
            )}

            {isPendingReceived && (
              <>
                <TouchableOpacity
                  onPress={handleAccept}
                  disabled={loading}
                  style={styles.primaryBtnWrap}
                >
                  <LinearGradient
                    colors={GRAD_PRIMARY as unknown as [string, string]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryBtn}
                  >
                    <Text style={styles.primaryBtnText}>Accept</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.outlineBtn}
                  onPress={handleDecline}
                  disabled={loading}
                >
                  <Text style={styles.outlineBtnText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.moreBtn} onPress={handleMore}>
                  <Feather name="more-horizontal" size={ICON.md} color={FG} />
                </TouchableOpacity>
              </>
            )}

            {noFriendship && (
              <>
                <TouchableOpacity
                  onPress={handleAddFriend}
                  disabled={loading}
                  style={styles.primaryBtnWrap}
                >
                  <LinearGradient
                    colors={GRAD_PRIMARY as unknown as [string, string]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryBtn}
                  >
                    <Text style={styles.primaryBtnText}>Add Friend</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity style={styles.moreBtn} onPress={handleMore}>
                  <Feather name="more-horizontal" size={ICON.md} color={FG} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Profile Info */}
        <View style={styles.infoSection}>
          <Text style={styles.nameText}>{name}</Text>
          <Text style={styles.handleText}>{handle}</Text>
          <Text style={styles.bioText}>No bio yet.</Text>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{DEMO_OTHER_POSTS.length}</Text>
            <Text style={styles.statLabel}>Posts</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{friendship?.mutualFriendsCount ?? 0}</Text>
            <Text style={styles.statLabel}>Mutual</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>2023</Text>
            <Text style={styles.statLabel}>Joined</Text>
          </View>
        </View>

        {/* Content */}
        {!canSeePosts ? (
          <View style={styles.privateBox}>
            <Feather name="lock" size={ICON.lg} color={MUTED} />
            <Text style={styles.privateTitle}>Private Account</Text>
            <Text style={styles.privateDesc}>Add as a friend to see their posts.</Text>
            {noFriendship && (
              <TouchableOpacity
                style={styles.privateAction}
                onPress={handleAddFriend}
                disabled={loading}
              >
                <LinearGradient
                  colors={GRAD_PRIMARY as unknown as [string, string]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.privateActionGrad}
                >
                  <Text style={styles.primaryBtnText}>Add Friend</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.postsSection}>
            {DEMO_OTHER_POSTS.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="image" size={32} color={MUTED} />
                <Text style={styles.emptyTitle}>No posts yet.</Text>
              </View>
            ) : (
              <View style={styles.grid}>
                {DEMO_OTHER_POSTS.map(post => (
                  <View key={post.id} style={styles.gridCell}>
                    <LinearGradient
                      colors={post.mediaColors as [string, string]}
                      style={styles.gridCellInner}
                    >
                      <Feather name={postTypeIcon(post.type) as any} size={ICON.md} color={MUTED} />
                    </LinearGradient>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  backBtn: {
    position: 'absolute',
    left: SP.md,
    zIndex: 10,
    width: 40,
    height: 40,
    backgroundColor: 'rgba(7,7,15,0.7)',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cover: {
    height: 180,
    width: '100%',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SP.md,
    marginTop: -40,
    gap: SP.md,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: BG,
  },
  avatarText: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    color: '#FFFFFF',
  },
  actionButtons: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    flexWrap: 'wrap',
    marginBottom: SP.xs,
  },
  primaryBtnWrap: {
    flex: 1,
    minWidth: 80,
    height: 40,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  primaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: '#FFFFFF',
  },
  outlineBtn: {
    flex: 1,
    minWidth: 70,
    height: 40,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledBtn: {
    opacity: 0.5,
    borderColor: BORDER,
  },
  outlineBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: FG,
  },
  moreBtn: {
    width: 40,
    height: 40,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoSection: {
    paddingHorizontal: SP.md,
    marginTop: SP.sm,
    gap: 4,
  },
  nameText: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    color: FG,
  },
  handleText: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },
  bioText: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: SUBTLE,
    marginTop: SP.xs,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    marginTop: SP.md,
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    paddingVertical: SP.md,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNum: {
    fontFamily: FONT.bold,
    fontSize: FS.md,
    color: FG,
  },
  statLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: BORDER,
  },
  postsSection: {
    marginTop: SP.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  gridCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    overflow: 'hidden',
  },
  gridCellInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateBox: {
    margin: SP.md,
    padding: SP.xl,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    gap: SP.sm,
  },
  privateTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
    marginTop: SP.sm,
  },
  privateDesc: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
  },
  privateAction: {
    width: '100%',
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    marginTop: SP.sm,
  },
  privateActionGrad: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SP.xl,
    gap: SP.md,
  },
  emptyTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
  },
});
