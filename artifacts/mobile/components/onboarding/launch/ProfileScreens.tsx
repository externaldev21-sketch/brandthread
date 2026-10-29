/**
 * Signed-in first-run screens. Presentational + the small amount of data each
 * one loads for itself; app/onboarding.tsx owns step order and saving.
 *
 *  UsernameScreen       Depop "Choose your username" + Whatnot suggestions
 *                       https://mobbin.com/screens/c63b35d5-9f0b-43da-9c09-91fcc98b5ec6
 *                       https://mobbin.com/screens/ee3a45d6-edcf-4f9d-8a05-caa9a3f6c72b
 *  PhotoScreen          Instagram "Add a profile picture" + "Add picture" sheet
 *                       https://mobbin.com/screens/00469017-3d7b-441c-ae32-825a8340020d
 *                       https://mobbin.com/screens/c3441f0a-341b-46f8-94e2-ddc73a133916
 *  InterestScreen       Depop "Interest" (Adding an interest)
 *                       https://mobbin.com/flows/6caedb01-2f8f-406d-ba8a-39c5bc264367
 *  BrandsScreen         Depop "Show these brands in search" (Adding brands)
 *                       https://mobbin.com/flows/43f24fc1-b3bb-48f3-a8cf-4ad31162ffab
 *  SizesScreen          Depop "Sizes"
 *                       https://mobbin.com/screens/7aa47a58-559f-466b-9679-73e50dae9c31
 *  NotificationsScreen  Cash App "Turn on notifications"
 *                       https://mobbin.com/screens/be5cd190-352d-4597-a544-31cb00eeea3a
 *  RoleScreen           Etsy radio rows ("Welcome to the Etsy app")
 *                       https://mobbin.com/screens/e37bf6b7-2dc6-4117-ba2b-fb6a77eb4e96
 *  StoreScreen / StageScreen  Depop "Start selling" step card + TikTok radio list
 *                       https://mobbin.com/screens/f1309ebc-8e30-48ea-8d56-0b72b1692c1e
 *                       https://mobbin.com/screens/f10440c9-2c15-407c-a8ba-fe2f23d4323e
 */
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { InertContext } from './motion';
import { MEDIA, FONT, FS } from '@/lib/theme';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { discoverBrands, type DiscoverBrand } from '@/services/discoverService';
import { SURVEY_SIZE_CATEGORIES, type OnboardingSurvey } from '@/lib/onboardingSurvey';
import type { SizeCategory } from '@/lib/sizeRecommendation';
import { normalizeUsernameInput, usernameFormatError, usernameSuggestions } from '@/lib/onboardingFlow';
import {
  Chip,
  Field,
  FieldError,
  FieldHint,
  GUTTER,
  ListRow,
  OnbHeader,
  OnbScreen,
  PillButton,
  RadioRow,
  ScalePressable,
  SectionTitle,
  Sub,
  Title,
} from './kit';

type HeaderProps = { progress?: number; onBack?: () => void };

/** TikTok's footer for optional multi-pick screens: grey Skip, primary Next. */
function SkipNextRow({ onSkip, onNext, nextLabel = 'Next', nextDisabled, loading, testPrefix }: {
  onSkip: () => void; onNext: () => void; nextLabel?: string; nextDisabled?: boolean; loading?: boolean; testPrefix: string;
}) {
  return (
    <View style={s.row}>
      <PillButton testID={`${testPrefix}-skip`} label="Skip" variant="secondary" onPress={onSkip} disabled={loading} style={s.flex} />
      <PillButton testID={`${testPrefix}-next`} label={nextLabel} onPress={onNext} disabled={nextDisabled} loading={loading} style={s.flex} />
    </View>
  );
}

// ─── Username ────────────────────────────────────────────────────────────────

const CHECK_DEBOUNCE_MS = 400;

type Availability = { state: 'idle' | 'checking' | 'available' | 'taken' | 'offline'; message?: string };

/** Debounced check against GET /api/auth/username/check (ignores your own handle). */
function useUsernameAvailability(username: string): Availability {
  const api = useApi();
  const [result, setResult] = useState<Availability>({ state: 'idle' });
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    if (!username || usernameFormatError(username)) { setResult({ state: 'idle' }); return; }
    setResult({ state: 'checking' });
    const timer = setTimeout(() => {
      api.auth.checkUsername(username)
        .then((r) => {
          if (id !== seq.current) return;
          setResult(r.available ? { state: 'available' } : { state: 'taken', message: r.error || 'That username is taken.' });
        })
        .catch(() => {
          if (id !== seq.current) return;
          setResult({ state: 'offline', message: 'Couldn’t check this username. It will be checked again when you continue.' });
        });
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, username]);
  return result;
}

export function UsernameScreen({
  value,
  onChange,
  seed,
  submitError,
  onContinue,
  busy,
  progress,
  onBack,
}: HeaderProps & {
  value: string;
  onChange: (v: string) => void;
  seed: { firstName?: string | null; lastName?: string | null; email?: string | null };
  submitError?: string;
  onContinue: () => void;
  busy?: boolean;
}) {
  const api = useApi();
  const formatError = usernameFormatError(value);
  const availability = useUsernameAvailability(value);
  const [touched, setTouched] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const digits = useMemo(() => String(Math.floor(10 + Math.random() * 89)), []);

  // Whatnot: a few free handles under the field. Only ones the server confirms.
  useEffect(() => {
    let cancelled = false;
    const candidates = usernameSuggestions(seed, digits).slice(0, 5);
    Promise.all(candidates.map((c) => api.auth.checkUsername(c).then((r) => (r.available ? c : null)).catch(() => null)))
      .then((list) => { if (!cancelled) setSuggestions(list.filter((x): x is string => !!x).slice(0, 4)); });
    return () => { cancelled = true; };
  }, [api, digits, seed.email, seed.firstName, seed.lastName]);

  const showFormat = (touched || value.length >= 3) && !!formatError;
  const error = showFormat ? formatError : availability.state === 'taken' ? availability.message : submitError;
  const canContinue = !!value && !formatError && availability.state !== 'taken' && availability.state !== 'checking';

  return (
    <OnbScreen
      testID="onboarding-username"
      header={<OnbHeader progress={progress} onBack={onBack} />}
      footer={<PillButton testID="onboarding-username-continue" label="Continue" onPress={onContinue} disabled={!canContinue} loading={busy} />}
    >
      <Title>Choose your username</Title>
      <Sub>You can change this in your settings.</Sub>
      <Field
        testID="onboarding-username-input"
        label="Username"
        value={value}
        onChangeText={(t) => { setTouched(true); onChange(normalizeUsernameInput(t)); }}
        onBlur={() => setTouched(true)}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        autoFocus
        error={!!error}
        maxLength={30}
        returnKeyType="next"
        onSubmitEditing={() => { if (canContinue && !busy) onContinue(); }}
        right={availability.state === 'checking' ? <ActivityIndicator size="small" /> : null}
      />
      {error ? (
        <FieldError testID="onboarding-username-error" message={error} />
      ) : availability.state === 'available' ? (
        <FieldHint message={`@${value} is available`} ok />
      ) : availability.state === 'offline' ? (
        <FieldHint message={availability.message} />
      ) : null}
      {suggestions.length > 0 ? (
        <View style={s.chips}>
          {suggestions.map((sug, i) => (
            <Chip index={i} key={sug} testID={`onboarding-username-suggestion-${sug}`} label={sug} selected={sug === value} onPress={() => onChange(sug)} />
          ))}
        </View>
      ) : null}
    </OnbScreen>
  );
}

// ─── Photo ───────────────────────────────────────────────────────────────────

export function PhotoScreen({
  uri,
  onPicked,
  onContinue,
  onSkip,
  busy,
  error,
  progress,
  onBack,
}: HeaderProps & {
  uri: string | null;
  onPicked: (asset: { uri: string; mimeType?: string | null }) => void;
  onContinue: () => void;
  onSkip: () => void;
  busy?: boolean;
  error?: string;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState(false);
  const [pickError, setPickError] = useState('');
  const placeholderBg = theme.text.toUpperCase() === MEDIA.foreground ? '#2A2A2C' : '#D6DBE1';
  const placeholderFg = theme.text.toUpperCase() === MEDIA.foreground ? '#5A5A5E' : '#F4F5F7';

  async function pick(source: 'library' | 'camera') {
    setSheet(false);
    setPickError('');
    try {
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.9 };
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setPickError('Allow camera access in Settings to take a photo.'); return; }
        result = await ImagePicker.launchCameraAsync(options);
      } else {
        result = await ImagePicker.launchImageLibraryAsync(options);
      }
      const asset = !result.canceled ? result.assets?.[0] : undefined;
      if (asset) onPicked({ uri: asset.uri, mimeType: asset.mimeType });
    } catch (e: any) {
      setPickError(e?.message || 'Couldn’t open your photos. Try again.');
    }
  }

  // On web there is no camera picker: the button opens the file chooser directly.
  const openPicker = () => (Platform.OS === 'web' ? void pick('library') : setSheet(true));

  return (
    <OnbScreen
      testID="onboarding-photo"
      header={<OnbHeader progress={progress} onBack={onBack} />}
      footer={uri ? (
        <>
          <PillButton testID="onboarding-photo-continue" label="Continue" onPress={onContinue} loading={busy} />
          <PillButton testID="onboarding-photo-change" label="Change picture" variant="secondary" onPress={openPicker} disabled={busy} />
        </>
      ) : (
        <>
          <PillButton testID="onboarding-photo-add" label="Add picture" onPress={openPicker} />
          <PillButton testID="onboarding-photo-skip" label="Skip" variant="secondary" onPress={onSkip} />
        </>
      )}
    >
      <Title>Add a profile picture</Title>
      <Sub>Add a profile picture so people know it’s you. Everyone will be able to see your picture.</Sub>
      <ScalePressable onPress={openPicker} accessibilityRole="button" accessibilityLabel="Choose a profile picture" style={s.avatarWrap}>
        {uri ? (
          <Image testID="onboarding-photo-preview" source={{ uri }} style={s.avatar} />
        ) : (
          <View style={[s.avatar, { backgroundColor: placeholderBg }]}>
            <View style={[s.avatarHead, { backgroundColor: placeholderFg }]} />
            <View style={[s.avatarBody, { backgroundColor: placeholderFg }]} />
          </View>
        )}
      </ScalePressable>
      <FieldError testID="onboarding-photo-error" message={error || pickError} />

      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <Pressable style={s.backdrop} onPress={() => setSheet(false)} accessibilityLabel="Close" />
        <View style={[s.sheet, { backgroundColor: theme.background, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[s.grabber, { backgroundColor: theme.border }]} />
          <ScalePressable onPress={() => setSheet(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={s.sheetClose}>
            <Feather name="x" size={24} color={theme.text} />
          </ScalePressable>
          <Text style={[s.sheetTitle, { color: theme.text }]}>Add picture</Text>
          <View style={[s.sheetGroup, { borderColor: theme.border }]}>
            <ScalePressable testID="onboarding-photo-library" onPress={() => { void pick('library'); }} style={[s.sheetRow, { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]} accessibilityRole="button">
              <Text style={[s.sheetRowText, { color: theme.text }]}>Choose from Camera Roll</Text>
            </ScalePressable>
            <ScalePressable testID="onboarding-photo-camera" onPress={() => { void pick('camera'); }} style={s.sheetRow} accessibilityRole="button">
              <Text style={[s.sheetRowText, { color: theme.text }]}>Take photo</Text>
            </ScalePressable>
          </View>
        </View>
      </Modal>
    </OnbScreen>
  );
}

// ─── Interest (department) ───────────────────────────────────────────────────

export const DEPARTMENTS = ['Menswear', 'Mens & Womenswear', 'Womenswear'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export function InterestScreen({
  value,
  onPick,
  onSkip,
  progress,
  onBack,
}: HeaderProps & { value: Department | null; onPick: (d: Department) => void; onSkip: () => void }) {
  const { theme } = useAppTheme();
  return (
    <OnbScreen
      testID="onboarding-interest"
      header={<OnbHeader progress={progress} onBack={onBack} />}
      footer={<PillButton testID="onboarding-interest-skip" label="Skip" variant="secondary" onPress={onSkip} />}
    >
      <Title>What do you shop for?</Title>
      <View style={s.list}>
        {DEPARTMENTS.map((d, i) => (
          <ListRow key={d} index={i} testID={`onboarding-interest-${d}`} label={d} selected={value === d} onPress={() => onPick(d)} />
        ))}
      </View>
      <Text style={[s.footnote, { color: theme.muted }]}>
        Your selection filters the items you see.
      </Text>
    </OnbScreen>
  );
}

// ─── Brands ──────────────────────────────────────────────────────────────────

export function BrandsScreen({
  selected,
  onChange,
  onContinue,
  onSkip,
  busy,
  error,
  progress,
  onBack,
}: HeaderProps & {
  selected: DiscoverBrand[];
  onChange: (next: DiscoverBrand[]) => void;
  onContinue: () => void;
  onSkip: () => void;
  busy?: boolean;
  error?: string;
}) {
  const { theme } = useAppTheme();
  const [brands, setBrands] = useState<DiscoverBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const inert = useContext(InertContext);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    discoverBrands(60)
      .then((list) => { if (!cancelled) setBrands(list); })
      .catch((e) => { if (!cancelled) setLoadError(e?.message || 'Couldn’t load brands.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const picked = new Set(selected.map((b) => b.sellerId));
  const q = query.trim().toLowerCase();
  const rest = brands.filter((b) => !picked.has(b.sellerId) && (!q || b.name.toLowerCase().includes(q)));
  const toggle = (b: DiscoverBrand) => onChange(picked.has(b.sellerId) ? selected.filter((x) => x.sellerId !== b.sellerId) : [...selected, b]);
  const searchBg = theme.text.toUpperCase() === MEDIA.foreground ? '#1C1C1E' : '#F0F0F0';

  return (
    <OnbScreen
      testID="onboarding-brands"
      header={<OnbHeader progress={progress} onBack={onBack} />}
      footer={<SkipNextRow testPrefix="onboarding-brands" onSkip={onSkip} onNext={onContinue} nextDisabled={selected.length === 0} loading={busy} />}
    >
      <Title>Choose brands to follow</Title>
      <Sub>Follow brands and see their pieces first.</Sub>
      <View style={[s.search, { backgroundColor: searchBg }]}>
        <Feather name="search" size={18} color={theme.muted} />
        <TextInput
          testID="onboarding-brands-search"
          value={query}
          onChangeText={setQuery}
          placeholder="Search brands"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          editable={!inert}
          style={[s.searchInput, { color: theme.text }]}
        />
      </View>
      {selected.length > 0 ? (
        <View style={[s.chips, s.chipsTop]}>
          {selected.map((b) => <Chip key={b.sellerId} testID={`onboarding-brand-${b.sellerId}`} label={b.name} selected onPress={() => toggle(b)} />)}
        </View>
      ) : null}
      <FieldError message={error} />
      {loading ? (
        <ActivityIndicator style={s.loading} color={theme.text} />
      ) : loadError ? (
        <View style={s.loading}>
          <Text style={[s.footnote, { color: theme.muted }]}>Couldn’t load brands. {loadError}</Text>
          <PillButton label="Try again" variant="secondary" onPress={() => setAttempt((n) => n + 1)} style={s.retry} />
        </View>
      ) : (
        <>
          <SectionTitle>Brands on Brandthread</SectionTitle>
          {rest.length > 0 ? (
            <View style={s.chips}>
              {rest.map((b, i) => <Chip index={i} key={b.sellerId} testID={`onboarding-brand-${b.sellerId}`} label={b.name} selected={false} onPress={() => toggle(b)} />)}
            </View>
          ) : (
            <Text style={[s.footnote, { color: theme.muted }]}>
              {q ? `No brands match “${query.trim()}”.` : brands.length === 0 ? 'No brands available. Find brands later in Discover.' : 'All brands selected.'}
            </Text>
          )}
        </>
      )}
    </OnbScreen>
  );
}

// ─── Sizes ───────────────────────────────────────────────────────────────────

const SIZE_QUESTIONS: Record<SizeCategory, string> = {
  shoes: 'What shoe size do you wear?',
  tops: 'What top size do you wear?',
  bottoms: 'What bottom size do you wear?',
  outerwear: 'What coat size do you wear?',
} as Record<SizeCategory, string>;

const SIZE_EXAMPLES: Partial<Record<SizeCategory, string>> = {
  shoes: 'Example “US 9”',
  tops: 'Example “M”',
  bottoms: 'Example waist “32”',
  outerwear: 'Example “L”',
};

export function SizesScreen({
  sizes,
  onChange,
  onContinue,
  onSkip,
  progress,
  onBack,
}: HeaderProps & {
  sizes: OnboardingSurvey['sizes'];
  onChange: (next: OnboardingSurvey['sizes']) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<SizeCategory | null>(null);
  const count = Object.values(sizes).filter(Boolean).length;
  const order: SizeCategory[] = ['shoes', 'tops', 'bottoms', 'outerwear'] as SizeCategory[];
  const categories = order
    .map((k) => SURVEY_SIZE_CATEGORIES.find((c) => c.key === k))
    .filter((c): c is (typeof SURVEY_SIZE_CATEGORIES)[number] => !!c);
  const openCat = categories.find((c) => c.key === open);

  function set(key: SizeCategory, value: string | null) {
    const next = { ...sizes };
    if (value) next[key] = value; else delete next[key];
    onChange(next);
  }

  return (
    <OnbScreen
      testID="onboarding-sizes"
      header={<OnbHeader progress={progress} onBack={onBack} />}
      footer={(
        <View style={s.sizesFooter}>
          <Text style={[s.sizesCount, { color: theme.text }]}>
            {count === 0 ? 'No sizes selected' : `${count} size${count === 1 ? '' : 's'} selected`}
          </Text>
          {count === 0 ? (
            <PillButton testID="onboarding-sizes-skip" label="Skip" variant="secondary" onPress={onSkip} style={s.okBtn} />
          ) : (
            <PillButton testID="onboarding-sizes-ok" label="Continue" onPress={onContinue} style={s.okBtn} />
          )}
        </View>
      )}
    >
      <Title>Your sizes</Title>
      <Sub>Used to show items in your size.</Sub>
      {categories.map((c) => {
        const value = sizes[c.key];
        return (
          <View key={c.key} style={s.sizeBlock}>
            <Text style={[s.sizeQ, { color: theme.text }]}>{SIZE_QUESTIONS[c.key] ?? c.label}</Text>
            <ScalePressable
              testID={`onboarding-size-${c.key}`}
              onPress={() => setOpen(c.key)}
              accessibilityRole="button"
              accessibilityLabel={`${c.label} size${value ? `, ${value}` : ''}`}
              style={[s.sizeRow, { borderBottomColor: theme.border }]}
            >
              <Text style={[s.sizeValue, { color: value ? theme.text : theme.subtle }]}>{value ?? 'Select'}</Text>
              {value ? (
                <ScalePressable testID={`onboarding-size-${c.key}-clear`} onPress={() => set(c.key, null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Clear ${c.label} size`}>
                  <Feather name="x" size={22} color={theme.text} />
                </ScalePressable>
              ) : <Feather name="chevron-right" size={20} color={theme.muted} />}
            </ScalePressable>
            <Text style={[s.sizeExample, { color: theme.subtle }]}>{SIZE_EXAMPLES[c.key] ?? ''}</Text>
          </View>
        );
      })}

      <Modal visible={!!openCat} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={s.backdrop} onPress={() => setOpen(null)} accessibilityLabel="Close" />
        <View style={[s.sheet, { backgroundColor: theme.background, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[s.grabber, { backgroundColor: theme.border }]} />
          <Text style={[s.sheetTitle, s.sheetTitleCenter, { color: theme.text }]}>{openCat?.label}</Text>
          <ScrollView style={s.sheetList}>
            {openCat?.options.map((opt) => (
              <ListRow
                key={opt}
                testID={`onboarding-size-${openCat.key}-${opt}`}
                label={opt}
                selected={sizes[openCat.key] === opt}
                onPress={() => { set(openCat.key, opt); setOpen(null); }}
              />
            ))}
          </ScrollView>
        </View>
      </Modal>
    </OnbScreen>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────

export function NotificationsScreen({
  onTurnOn,
  onSkip,
  busy,
  progress,
  onBack,
}: HeaderProps & { onTurnOn: () => void; onSkip: () => void; busy?: boolean }) {
  const { theme } = useAppTheme();
  // The browser build can't take push permission, so there's nothing to turn
  // on or decline: one Continue, and copy that says where alerts live.
  const web = Platform.OS === 'web';
  return (
    <OnbScreen
      testID="onboarding-notifications"
      header={<OnbHeader progress={progress} onBack={onBack} />}
      footer={web ? (
        <PillButton testID="onboarding-notifications-continue" label="Continue" onPress={onSkip} />
      ) : (
        <>
          <PillButton testID="onboarding-notifications-skip" label="Skip" variant="secondary" onPress={onSkip} disabled={busy} />
          <PillButton testID="onboarding-notifications-continue" label="Turn on" onPress={onTurnOn} loading={busy} />
        </>
      )}
    >
      <View style={[s.bell, { backgroundColor: theme.text }]}>
        <Feather name="bell" size={26} color={theme.background} />
      </View>
      <Title style={s.bellTitle}>{web ? 'Get alerts in the app' : 'Turn on notifications'}</Title>
      <Sub>
        {web
          ? 'Alerts aren’t available in the browser. Turn them on anytime in the Brandthread mobile app.'
          : 'Get order and shipping updates, messages, and drops from brands you follow. You can turn them off anytime.'}
      </Sub>
    </OnbScreen>
  );
}

// ─── Buyer or seller ─────────────────────────────────────────────────────────

export function RoleScreen({
  value,
  onChange,
  onContinue,
  busy,
  error,
  progress,
  onBack,
}: HeaderProps & {
  value: 'buyer' | 'seller' | null;
  onChange: (v: 'buyer' | 'seller') => void;
  onContinue: () => void;
  busy?: boolean;
  error?: string;
}) {
  return (
    <OnbScreen
      testID="onboarding-role"
      header={<OnbHeader progress={progress} onBack={onBack} />}
      footer={<PillButton testID="onboarding-role-continue" label="Continue" onPress={onContinue} disabled={!value} loading={busy} />}
    >
      <Title>How will you use Brandthread?</Title>
      <Sub>You can open a store later from your profile.</Sub>
      <View style={s.list}>
        <RadioRow testID="account-type-buyer" label="Shop" sub="Buy from independent brands and follow their drops." selected={value === 'buyer'} onPress={() => onChange('buyer')} />
        <RadioRow index={1} testID="account-type-seller" label="Sell" sub="Open a store and sell your own brand." selected={value === 'seller'} onPress={() => onChange('seller')} />
      </View>
      <FieldError testID="onboarding-role-error" message={error} />
    </OnbScreen>
  );
}

// ─── Seller: store name + stage (Depop "Start selling") ──────────────────────

function StepCard({ step, total, title, body }: { step: number; total: number; title: string; body: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={[s.card, { borderColor: theme.border }]}>
      <Text style={[s.cardStep, { color: theme.muted }]}>Step {step} of {total}</Text>
      <Text style={[s.cardTitle, { color: theme.text }]}>{title}</Text>
      <Text style={[s.cardBody, { color: theme.muted }]}>{body}</Text>
    </View>
  );
}

export function StoreScreen({
  value,
  onChange,
  onContinue,
  onBack,
  error,
}: { value: string; onChange: (v: string) => void; onContinue: () => void; onBack: () => void; error?: string }) {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  const tooShort = value.length > 0 && trimmed.length < 2;
  return (
    <OnbScreen
      testID="onboarding-store"
      header={<OnbHeader onBack={onBack} title="Start selling" />}
      footer={<PillButton testID="onboarding-store-continue" label="Continue" onPress={onContinue} disabled={trimmed.length < 2} />}
    >
      <StepCard step={1} total={2} title="Name your store" body="This is the name buyers see on your store and products. You can change it later." />
      <Field
        testID="onboarding-store-name"
        variant="underline"
        label="Store name"
        value={value}
        onChangeText={onChange}
        autoCapitalize="words"
        autoFocus
        maxLength={60}
        error={tooShort || !!error}
        returnKeyType="next"
        onSubmitEditing={() => { if (trimmed.length >= 2) onContinue(); }}
      />
      <FieldError message={tooShort ? 'Enter at least 2 characters.' : error} />
    </OnbScreen>
  );
}

export const BRAND_STAGES = [
  { value: 'idea', label: 'Idea stage', sub: 'Nothing produced yet.' },
  { value: 'build', label: 'Building now', sub: 'I’m designing or sourcing products.' },
  { value: 'selling', label: 'Already selling', sub: 'I have customers and orders.' },
  { value: 'scale', label: 'Ready to scale', sub: 'Expand operations and sales.' },
] as const;

export function StageScreen({
  value,
  onChange,
  onContinue,
  onBack,
  busy,
  error,
}: { value: string | null; onChange: (v: string) => void; onContinue: () => void; onBack: () => void; busy?: boolean; error?: string }) {
  return (
    <OnbScreen
      testID="onboarding-stage"
      header={<OnbHeader onBack={onBack} title="Start selling" />}
      footer={<PillButton testID="onboarding-stage-continue" label="Open my store" onPress={onContinue} disabled={!value} loading={busy} />}
    >
      <StepCard step={2} total={2} title="Brand stage" body="Used to set up your dashboard. Buyers never see it." />
      <View style={s.list}>
        {BRAND_STAGES.map((st, i) => (
          <RadioRow key={st.value} index={i} testID={`onboarding-stage-${st.value}`} label={st.label} sub={st.sub} selected={value === st.value} onPress={() => onChange(st.value)} />
        ))}
      </View>
      <FieldError testID="onboarding-stage-error" message={error} />
    </OnbScreen>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  chipsTop: { marginTop: 16 },
  list: { marginTop: 16 },
  footnote: { fontSize: FS.sm, lineHeight: 18, marginTop: 16, textAlign: 'center' },
  avatarWrap: { alignSelf: 'center', marginTop: 40 },
  avatar: { width: 168, height: 168, borderRadius: 84, overflow: 'hidden', alignItems: 'center' },
  avatarHead: { width: 58, height: 58, borderRadius: 29, marginTop: 30 },
  avatarBody: { width: 120, height: 120, borderRadius: 60, marginTop: 10 },
  backdrop: { flex: 1, backgroundColor: MEDIA.pickerScrim },
  sheet: {
    borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: GUTTER, paddingTop: 8,
  },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: 8 },
  sheetClose: { alignSelf: 'flex-start', paddingVertical: 8 },
  sheetTitle: { fontSize: 22, fontFamily: FONT.bold, marginTop: 4, marginBottom: 16 },
  sheetTitleCenter: { fontSize: 17, textAlign: 'center', marginTop: 8 },
  sheetGroup: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  sheetRow: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 16 },
  sheetRowText: { fontSize: 16 },
  sheetList: { maxHeight: 360 },
  search: { marginTop: 20, height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 },
  searchInput: { flex: 1, fontSize: 16, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : null) },
  loading: { marginTop: 32, alignItems: 'center' },
  retry: { marginTop: 12, alignSelf: 'stretch' },
  sizesFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sizesCount: { fontSize: 15 },
  okBtn: { minWidth: 96, height: 44 },
  sizeBlock: { marginTop: 24 },
  sizeQ: { fontSize: 16, fontFamily: FONT.bold },
  sizeRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  sizeValue: { fontSize: 17 },
  sizeExample: { fontSize: 12, marginTop: 6 },
  bell: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  bellTitle: { marginTop: 20 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, padding: 16, marginTop: 8 },
  cardStep: { fontSize: 12 },
  cardTitle: { fontSize: 20, fontFamily: FONT.bold, marginTop: 8 },
  cardBody: { fontSize: 15, lineHeight: 20, marginTop: 8 },
});
