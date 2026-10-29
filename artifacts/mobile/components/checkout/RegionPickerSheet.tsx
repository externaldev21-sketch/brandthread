/**
 * State / Country picker as a bottom sheet over the address form (Shop's
 * "Add address" region list), not a new full-screen page:
 *  - about two thirds of the screen tall, the form stays visible behind a
 *    light dim; drag the handle down (or tap the dim) to dismiss;
 *  - a search bar pinned at the top filters as you type, by name or code
 *    ("New" → New Hampshire, New Jersey, …; "NY" → New York; "US");
 *  - the likely value first (device-locale country, or the state for the
 *    ZIP already typed), then the A–Z list with an alphabet scrubber;
 *  - tapping a row selects it and closes the sheet.
 * Motion and swipe-to-close come from the shared useSheetTransition engine.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Dimensions, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type GestureResponderEvent, type LayoutChangeEvent,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/Icon';
import { useSheetTransition } from '@/components/ui/BottomSheet';
import { useIsWebShell, WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';
import { a11yModalProps } from '@/lib/a11y/modal';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { FONT, FS, SP } from '@/lib/theme';
import { filterRegions, firstIndexForLetter, regionLetters, sortRegions } from '@/lib/regionPicker';
import type { PickerOption } from './CheckoutPrimitives';
import { useCheckoutColors, type CheckoutColors } from './CheckoutPrimitives';

const ROW_H = 52;
const SHEET_HEIGHT_RATIO = 0.66;

export function RegionPickerSheet({
  visible, title, options, value, suggested, suggestedLabel, onSelect, onClose, testID,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  value: string;
  /** The likely choice, shown above the list (device country, ZIP's state). */
  suggested?: PickerOption | null;
  /** Why it's suggested, e.g. "From your ZIP code". */
  suggestedLabel?: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  testID?: string;
}) {
  const ck = useCheckoutColors();
  const s = useMemo(() => makeStyles(ck), [ck]);
  const insets = useSafeAreaInsets();
  const isWebShell = useIsWebShell();
  const [query, setQuery] = useState('');
  const listRef = useRef<FlatList<PickerOption>>(null);
  const headerHeight = useRef(0);
  const scrubberHeight = useRef(0);
  const { modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout } = useSheetTransition(visible, () => setQuery(''));

  const sorted = useMemo(() => sortRegions(options), [options]);
  const rows = useMemo(() => filterRegions(options, query), [options, query]);
  const letters = useMemo(() => regionLetters(options), [options]);
  const searching = query.trim().length > 0;
  const showSuggested = !searching && !!suggested;

  const choose = (next: string) => {
    onSelect(next);
    onClose();
  };

  const jumpTo = (event: GestureResponderEvent) => {
    if (!letters.length || scrubberHeight.current <= 0) return;
    const step = scrubberHeight.current / letters.length;
    const letter = letters[Math.min(letters.length - 1, Math.max(0, Math.floor(event.nativeEvent.locationY / step)))];
    const index = firstIndexForLetter(sorted, letter);
    if (index >= 0) listRef.current?.scrollToOffset({ offset: headerHeight.current + index * ROW_H, animated: false });
  };

  const sheetHeight = Math.round(Dimensions.get('window').height * SHEET_HEIGHT_RATIO);

  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={onClose} testID={testID}>
      <View style={s.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={`Close ${title} list`}>
            {/* Light dim: the address form stays readable behind the sheet. */}
            <View style={[StyleSheet.absoluteFill, s.dim]} />
          </Pressable>
        </Animated.View>
        <Animated.View
          {...a11yModalProps()}
          onLayout={onSheetLayout}
          style={[s.sheet, isWebShell && s.sheetWebShell, { height: sheetHeight, paddingBottom: Math.max(insets.bottom, SP.sm) }, sheetStyle]}
          testID={testID ? `${testID}-sheet` : undefined}
        >
          {/* Only the top drags the sheet, so the list scrolls freely. */}
          <GestureDetector gesture={panGesture}>
            <View>
              <View style={s.handleWrap}><View style={s.handle} /></View>
              <Text style={s.title} accessibilityRole="header">{title}</Text>
            </View>
          </GestureDetector>
          <View style={s.search}>
            <Icon name="search" size={16} color={ck.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={`Search ${title.toLowerCase()}`}
              placeholderTextColor={ck.subtle}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel={`Search ${title.toLowerCase()}`}
              style={[s.searchInput, WEB_INPUT_RESET]}
              testID={testID ? `${testID}-search` : undefined}
            />
          </View>
          <View style={s.body}>
            <FlatList
              ref={listRef}
              data={rows}
              keyExtractor={option => option.value}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              bounces={false}
              overScrollMode="never"
              initialNumToRender={20}
              getItemLayout={(_, index) => ({ length: ROW_H, offset: headerHeight.current + ROW_H * index, index })}
              contentContainerStyle={s.listContent}
              ListHeaderComponent={
                <View onLayout={(event: LayoutChangeEvent) => { headerHeight.current = event.nativeEvent.layout.height; }}>
                  {showSuggested && suggested ? (
                    <>
                      <Text style={s.sectionLabel}>{suggestedLabel ?? 'Suggested'}</Text>
                      <Row option={suggested} selected={suggested.value === value} onPress={() => choose(suggested.value)} s={s} ck={ck} testID={testID ? `${testID}-suggested` : undefined} />
                      <Text style={s.sectionLabel}>All {title === 'Country' ? 'countries' : 'states'}</Text>
                    </>
                  ) : null}
                </View>
              }
              ListEmptyComponent={<Text style={s.empty}>No matches for “{query.trim()}”</Text>}
              renderItem={({ item }) => (
                <Row option={item} selected={item.value === value} onPress={() => choose(item.value)} s={s} ck={ck} testID={testID ? `${testID}-${item.value}` : undefined} />
              )}
            />
            {!searching && letters.length > 6 ? (
              <View
                style={s.scrubber}
                onLayout={(event: LayoutChangeEvent) => { scrubberHeight.current = event.nativeEvent.layout.height; }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={jumpTo}
                onResponderMove={jumpTo}
                accessibilityLabel="Jump to letter"
                testID={testID ? `${testID}-scrubber` : undefined}
              >
                {letters.map(letter => <Text key={letter} style={s.letter} pointerEvents="none">{letter}</Text>)}
              </View>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Row({ option, selected, onPress, s, ck, testID }: {
  option: PickerOption; selected: boolean; onPress: () => void;
  s: ReturnType<typeof makeStyles>; ck: CheckoutColors; testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${option.label}${selected ? ', selected' : ''}`}
      testID={testID}
    >
      <Text style={s.rowLabel} numberOfLines={1}>{option.label}</Text>
      <Text style={s.rowCode}>{option.value}</Text>
      <View style={s.check}>{selected ? <Icon name="check" size={17} color={ck.text} /> : null}</View>
    </Pressable>
  );
}

const makeStyles = (ck: CheckoutColors) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  dim: { backgroundColor: 'rgba(0,0,0,0.35)' }, // theme-exempt: neutral scrim behind region picker
  sheet: {
    backgroundColor: ck.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: ck.fieldBorder,
    overflow: 'hidden',
  },
  sheetWebShell: { width: '100%', maxWidth: WEB_SHELL_MAX_WIDTH, alignSelf: 'center' },
  handleWrap: { alignItems: 'center', paddingTop: SP.sm, paddingBottom: SP.xs },
  handle: { width: 36, height: 5, borderRadius: 3, backgroundColor: ck.subtle },
  title: { fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text, textAlign: 'center', paddingBottom: SP.sm },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    marginHorizontal: SP.md, marginBottom: SP.xs, paddingHorizontal: 12, height: 40,
    borderRadius: 10, backgroundColor: '#1C1C1E',
  },
  searchInput: {
    flex: 1, color: ck.text, fontFamily: FONT.regular, fontSize: FS.base, paddingVertical: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  body: { flex: 1, flexDirection: 'row' },
  listContent: { paddingLeft: SP.md, paddingRight: SP.lg + 4, paddingBottom: SP.lg },
  sectionLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, color: ck.muted, paddingTop: SP.md, paddingBottom: SP.xs },
  row: {
    height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ck.divider,
  },
  rowPressed: { opacity: 0.6 },
  rowLabel: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base, color: ck.text },
  rowCode: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted },
  check: { width: 20, alignItems: 'center' },
  empty: { fontFamily: FONT.regular, fontSize: FS.sm, color: ck.muted, paddingVertical: SP.lg, textAlign: 'center' },
  scrubber: { position: 'absolute', right: 2, top: SP.sm, bottom: SP.lg, width: 20, justifyContent: 'space-around', alignItems: 'center' },
  letter: { fontFamily: FONT.semibold, fontSize: 11, lineHeight: 14, color: ck.muted },
});
