import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  ActivityIndicator: () => null,
  Alert: { alert: vi.fn() },
  Modal: () => null,
  ScrollView: () => null,
  StyleSheet: { create: (styles: unknown) => styles },
  Text: () => null,
  TextInput: () => null,
  TouchableOpacity: () => null,
  View: () => null,
}));

vi.mock('@expo/vector-icons', () => ({ Feather: () => null }));
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: vi.fn(),
  useRouter: vi.fn(),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('expo-haptics', () => ({}));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
vi.mock('@/contexts/AppThemeContext', () => ({ useAppTheme: vi.fn() }));
vi.mock('@/components/BrandthreadUI', () => ({
  BrandthreadCard: () => null,
  GradientCard: () => null,
  PrimaryButton: () => null,
  SecondaryButton: () => null,
  IconButton: () => null,
  StatusBadge: () => null,
  SectionHeader: () => null,
  EmptyState: () => null,
}));
vi.mock('@/lib/api', () => ({ useApi: vi.fn() }));
vi.mock('@/lib/money', () => ({ formatCents: (cents: number) => `$${cents / 100}` }));
vi.mock('@/lib/theme', () => ({
  BG: '#07070F',
  SCREEN_BG: 'transparent',
  SURFACE: '#0D0D17',
  CARD: '#12121F',
  CARD_GLASS: 'rgba(18, 18, 31, 0.58)',
  CARD_ELEVATED: '#18182E',
  ACCENT: '#F4F4FF',
  BORDER: '#303044',
  BORDER_ACTIVE: '#C7CDD5',
  FG: '#F4F4FF',
  MUTED: '#AAAABC',
  SUBTLE: '#77778A',
  SUCCESS: '#10B981',
  SUCCESS_DIM: '#103D31',
  BLUE: '#3B82F6',
  BLUE_DIM: '#172554',
  ORANGE: '#F97316',
  ORANGE_DIM: '#3F2A00',
  RED: '#F87171',
  RED_DIM: '#3F2020',
  GOLD: '#F59E0B',
  GRAD_CARD_GLOW: ['#12121F', '#18182E'],
  FONT: { regular: 'System', semibold: 'System', bold: 'System' },
  FS: { xs: 11, sm: 13, base: 15, md: 17, lg: 19, xl: 22, xxl: 26 },
  SP: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  RADIUS: { xs: 6, sm: 10, md: 14, lg: 18, pill: 999 },
  ICON: { xs: 12, sm: 16, md: 20, lg: 24, xxl: 40 },
  PURPLE: '#8B5CF6',
  PURPLE_LIGHT: '#C4B5FD',
  PURPLE_DIM: '#2E1065',
  CYAN: '#22D3EE',
  CYAN_DIM: '#083344',
  COMP: { buttonH: 52, buttonHSm: 44, inputH: 52, tabBarH: 72, headerH: 56, cardRadius: 18, iconBtn: 44, minTouchTarget: 44 },
}));

import { adaptApiOrder } from '@/app/order-detail';

describe('seller order detail buyer identity adapter', () => {
  it('keeps the guest shipping name when no customer record exists', () => {
    const order = adaptApiOrder({
      id: 'guest-order-1',
      ownerId: 'seller-1',
      buyerId: null,
      customerId: null,
      customer: null,
      guestEmail: 'guest@example.com',
      shippingAddress: {
        name: 'Guest Checkout Buyer',
        street: '123 Test Street',
        city: 'Portland',
        state: 'OR',
        zip: '97205',
        country: 'US',
      },
      orderNumber: 'BT-GUEST-0001',
      status: 'processing',
      totalCents: 2500,
      subtotalCents: 2500,
      shippingCents: 0,
      createdAt: '2026-08-31T12:00:00.000Z',
      items: [],
    });

    expect(order.customer).toMatchObject({
      id: '',
      name: 'Guest Checkout Buyer',
      email: 'guest@example.com',
    });
    expect(order.customer.initials).toBe('GC');
  });
});