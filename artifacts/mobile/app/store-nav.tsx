import React, { useState, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, Switch,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Header } from '@/components/layout';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, FilterChip, StatusBadge, SectionHeader,
  EmptyState, StatCard,
} from '@/components/BrandthreadUI';
import { getMenus, updateMenu } from '@/services/storeService';
import { StoreMenu, StoreMenuItem, MenuType, MenuItemTarget } from '@/services/storeTypes';
import { SheetRise } from '@/components/motion/SheetRise';

const MENU_TABS: { type: MenuType; label: string }[] = [
  { type: 'main', label: 'Main Menu' },
  { type: 'mobile', label: 'Mobile Menu' },
  { type: 'footer', label: 'Footer Menu' },
];

const LINK_TARGETS: { value: MenuItemTarget; label: string }[] = [
  { value: 'collection', label: 'Collection' },
  { value: 'product', label: 'Product' },
  { value: 'page', label: 'Page' },
  { value: 'seller_profile', label: 'Seller Profile' },
  { value: 'external', label: 'External URL' },
  { value: 'none', label: 'No link' },
];

function uid(): string {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

interface ItemFormState {
  label: string;
  target: MenuItemTarget;
  url: string;
  targetId: string;
  visible: boolean;
}

function defaultItemForm(): ItemFormState {
  return { label: '', target: 'collection', url: '', targetId: '', visible: true };
}

export default function StoreNavScreen() {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [menus, setMenus] = useState<StoreMenu[]>([]);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<StoreMenuItem | null>(null);
  const [editingParentId, setEditingParentId] = useState<string | null>(null);
  const [isNewItem, setIsNewItem] = useState(false);
  const [itemForm, setItemForm] = useState<ItemFormState>(defaultItemForm());
  const [modalVisible, setModalVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadMenus();
    }, [])
  );

  async function loadMenus() {
    try {
      const result = await getMenus();
      setMenus(result);
      if (result.length > 0 && !activeMenuId) {
        setActiveMenuId(result[0].id);
      }
    } catch {
      setMenus([]);
    }
  }

  const activeMenu = menus.find((m) => m.id === activeMenuId) ?? null;

  // ─── Item mutations ───────────────────────────────────────────────────────────

  function openNewItem(parentId: string | null = null) {
    setEditingItem(null);
    setEditingParentId(parentId);
    setIsNewItem(true);
    setItemForm(defaultItemForm());
    setModalVisible(true);
  }

  function openEditItem(item: StoreMenuItem) {
    setEditingItem(item);
    setEditingParentId(null);
    setIsNewItem(false);
    setItemForm({
      label: item.label,
      target: item.target,
      url: item.url ?? '',
      targetId: item.targetId ?? '',
      visible: item.visible,
    });
    setModalVisible(true);
  }

  async function handleSaveItem() {
    if (!itemForm.label.trim()) {
      Alert.alert('Label required', 'Please enter a menu item label.');
      return;
    }
    if (!activeMenu) return;

    const updatedItems = deepCloneItems(activeMenu.items);

    if (isNewItem) {
      const newItem: StoreMenuItem = {
        id: uid(),
        label: itemForm.label.trim(),
        target: itemForm.target,
        url: itemForm.url || undefined,
        targetId: itemForm.targetId || undefined,
        visible: itemForm.visible,
        order: 0,
        children: [],
      };
      if (editingParentId) {
        const parent = findItemById(updatedItems, editingParentId);
        if (parent) {
          newItem.order = parent.children.length;
          parent.children.push(newItem);
        }
      } else {
        newItem.order = updatedItems.length;
        updatedItems.push(newItem);
      }
    } else if (editingItem) {
      const found = findItemById(updatedItems, editingItem.id);
      if (found) {
        found.label = itemForm.label.trim();
        found.target = itemForm.target;
        found.url = itemForm.url || undefined;
        found.targetId = itemForm.targetId || undefined;
        found.visible = itemForm.visible;
      }
    }

    try {
      await updateMenu(activeMenu.id, updatedItems);
      await loadMenus();
    } catch {
      Alert.alert('Error', 'Failed to save menu item.');
    }
    setModalVisible(false);
  }

  async function handleToggleVisible(itemId: string) {
    if (!activeMenu) return;
    const updatedItems = deepCloneItems(activeMenu.items);
    const found = findItemById(updatedItems, itemId);
    if (found) found.visible = !found.visible;
    try {
      await updateMenu(activeMenu.id, updatedItems);
      await loadMenus();
    } catch {}
  }

  async function handleRemoveItem(itemId: string) {
    Alert.alert(
      'Remove Item',
      'Remove this menu item?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive', onPress: async () => {
            if (!activeMenu) return;
            const updatedItems = removeItemById(deepCloneItems(activeMenu.items), itemId);
            try {
              await updateMenu(activeMenu.id, updatedItems);
              await loadMenus();
            } catch {
              Alert.alert('Error', 'Failed to remove item.');
            }
          },
        },
      ]
    );
  }

  async function handleMoveItem(itemId: string, direction: 'up' | 'down', parentId: string | null) {
    if (!activeMenu) return;
    const updatedItems = deepCloneItems(activeMenu.items);
    let listRef: StoreMenuItem[];
    if (parentId) {
      const parent = findItemById(updatedItems, parentId);
      if (!parent) return;
      listRef = parent.children;
    } else {
      listRef = updatedItems;
    }
    const idx = listRef.findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= listRef.length) return;
    const tmp = listRef[idx];
    listRef[idx] = listRef[swapIdx];
    listRef[swapIdx] = tmp;
    listRef.forEach((it, i) => { it.order = i; });
    try {
      await updateMenu(activeMenu.id, updatedItems);
      await loadMenus();
    } catch {}
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function deepCloneItems(items: StoreMenuItem[]): StoreMenuItem[] {
    return JSON.parse(JSON.stringify(items));
  }

  function findItemById(items: StoreMenuItem[], id: string): StoreMenuItem | null {
    for (const item of items) {
      if (item.id === id) return item;
      const found = findItemById(item.children, id);
      if (found) return found;
    }
    return null;
  }

  function removeItemById(items: StoreMenuItem[], id: string): StoreMenuItem[] {
    return items
      .filter((item) => item.id !== id)
      .map((item) => ({ ...item, children: removeItemById(item.children, id) }));
  }

  // ─── Item Row Renderer ───────────────────────────────────────────────────────

  function renderItem(item: StoreMenuItem, depth: number = 0, parentId: string | null = null) {
    const canAddChild = depth < 1;
    return (
      <View key={item.id}>
        <View style={[styles.itemRow, { paddingLeft: SP.md + depth * 20 }]}>
          <Feather name="menu" size={ICON.sm} color={MUTED} style={styles.dragHandle} />
          <TouchableOpacity onPress={() => handleToggleVisible(item.id)} style={styles.visibleToggle}>
            <Feather
              name={item.visible ? 'eye' : 'eye-off'}
              size={ICON.sm}
              color={item.visible ? PURPLE : MUTED}
            />
          </TouchableOpacity>
          <View style={styles.itemLabelWrap}>
            <Text style={styles.itemLabel} numberOfLines={1}>{item.label}</Text>
            <Text style={styles.itemTarget} numberOfLines={1}>
              {item.target === 'none' ? 'no link' : `link:${item.target}`}
            </Text>
          </View>
          <View style={styles.itemActions}>
            <TouchableOpacity
              style={styles.itemActionBtn}
              onPress={() => handleMoveItem(item.id, 'up', parentId)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Feather name="chevron-up" size={ICON.xs} color={MUTED} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.itemActionBtn}
              onPress={() => handleMoveItem(item.id, 'down', parentId)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Feather name="chevron-down" size={ICON.xs} color={MUTED} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.itemActionBtnPurple}
              onPress={() => openEditItem(item)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Feather name="edit-2" size={ICON.xs} color={PURPLE} />
            </TouchableOpacity>
            {canAddChild && (
              <TouchableOpacity
                style={styles.itemActionBtnPurple}
                onPress={() => openNewItem(item.id)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Feather name="plus" size={ICON.xs} color={CYAN} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.itemActionBtnDanger}
              onPress={() => handleRemoveItem(item.id)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <Feather name="x" size={ICON.xs} color={RED} />
            </TouchableOpacity>
          </View>
        </View>
        {item.children.map((child) => renderItem(child, depth + 1, item.id))}
      </View>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      <Header
        title="Navigation"
        onBack={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); goBackOr(router); }}
      />
      <Text style={styles.headerSubtitle}>Set up your store's navigation menus.</Text>

      {/* Menu Tab Selector */}
      <View style={styles.tabRow}>
        {MENU_TABS.map((tab) => {
          const menu = menus.find((m) => m.type === tab.type);
          const isActive = menu?.id === activeMenuId;
          return (
            <TouchableOpacity
              key={tab.type}
              style={[styles.menuTab, isActive && styles.menuTabActive]}
              onPress={() => { Haptics.selectionAsync(); if (menu) setActiveMenuId(menu.id); }}
            >
              <Text style={[styles.menuTabText, isActive && styles.menuTabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Menu Items */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + SP.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {activeMenu && activeMenu.items.length === 0 && (
          <EmptyState
            icon="menu"
            title="No items yet"
            description="Add your first menu item."
            action={{ label: '+ Add Item', onPress: () => openNewItem(null), icon: 'plus' }}
            style={styles.emptyState}
          />
        )}

        {activeMenu && activeMenu.items.length > 0 && (
          <View style={styles.itemsList}>
            {activeMenu.items.map((item) => renderItem(item, 0, null))}
          </View>
        )}

        {activeMenu && (
          <TouchableOpacity style={styles.addItemBtn} onPress={() => openNewItem(null)}>
            <Feather name="plus" size={ICON.sm} color={PURPLE} />
            <Text style={styles.addItemBtnText}>+ Add Menu Item</Text>
          </TouchableOpacity>
        )}

        {/* Footer note */}
        <View style={styles.footerNote}>
          <Feather name="info" size={ICON.xs} color={MUTED} />
          <Text style={styles.footerNoteText}>
            Changes to navigation take effect immediately on your published store.
          </Text>
        </View>
      </ScrollView>

      {/* Item Editor Modal */}
      <Modal
        visible={modalVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <SheetRise style={[styles.modalSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Menu Item</Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={ICON.md} color={FG} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Label */}
              <Text style={styles.fieldLabel}>Label *</Text>
              <TextInput
                style={styles.textInput}
                value={itemForm.label}
                onChangeText={(v) => setItemForm((p) => ({ ...p, label: v }))}
                placeholder="e.g. Shop, Collections…"
                placeholderTextColor={SUBTLE}
              />

              {/* Link type */}
              <Text style={[styles.fieldLabel, { marginTop: SP.md }]}>Link Type</Text>
              <View style={styles.chipRow}>
                {LINK_TARGETS.map((t) => (
                  <FilterChip
                    key={t.value}
                    label={t.label}
                    active={itemForm.target === t.value}
                    onPress={() => setItemForm((p) => ({ ...p, target: t.value }))}
                  />
                ))}
              </View>

              {/* Conditional input */}
              {itemForm.target === 'collection' && (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: SP.md }]}>Collection name or ID</Text>
                  <TextInput
                    style={styles.textInput}
                    value={itemForm.targetId}
                    onChangeText={(v) => setItemForm((p) => ({ ...p, targetId: v }))}
                    placeholder="Enter collection name or ID"
                    placeholderTextColor={SUBTLE}
                  />
                </>
              )}
              {itemForm.target === 'product' && (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: SP.md }]}>Product name or ID</Text>
                  <TextInput
                    style={styles.textInput}
                    value={itemForm.targetId}
                    onChangeText={(v) => setItemForm((p) => ({ ...p, targetId: v }))}
                    placeholder="Enter product name or ID"
                    placeholderTextColor={SUBTLE}
                  />
                </>
              )}
              {itemForm.target === 'page' && (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: SP.md }]}>Page title or slug</Text>
                  <TextInput
                    style={styles.textInput}
                    value={itemForm.targetId}
                    onChangeText={(v) => setItemForm((p) => ({ ...p, targetId: v }))}
                    placeholder="Enter page title or slug"
                    placeholderTextColor={SUBTLE}
                  />
                </>
              )}
              {itemForm.target === 'external' && (
                <>
                  <Text style={[styles.fieldLabel, { marginTop: SP.md }]}>URL</Text>
                  <TextInput
                    style={styles.textInput}
                    value={itemForm.url}
                    onChangeText={(v) => setItemForm((p) => ({ ...p, url: v }))}
                    placeholder="https://nightshiftstudio.co"
                    placeholderTextColor={SUBTLE}
                    keyboardType="url"
                    autoCapitalize="none"
                  />
                  <View style={styles.warningRow}>
                    <Feather name="alert-triangle" size={ICON.xs} color={ORANGE} />
                    <Text style={styles.warningText}>Only link to pages you own.</Text>
                  </View>
                </>
              )}

              {/* Visible toggle */}
              <View style={styles.visibleRow}>
                <Text style={styles.fieldLabel}>Visible</Text>
                <Switch
                  value={itemForm.visible}
                  onValueChange={(v) => setItemForm((p) => ({ ...p, visible: v }))}
                  trackColor={{ false: BORDER, true: PURPLE }}
                  thumbColor={FG}
                />
              </View>

              {/* Save */}
              <PrimaryButton
                label="Save Item"
                onPress={handleSaveItem}
                style={{ marginTop: SP.md }}
              />
            </ScrollView>
          </SheetRise>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;
  const BORDER_ACTIVE = theme.accentLight;
  const BG = theme.background;
  const SURFACE = theme.surface;
  const CARD = theme.card;
  const CARD_ELEVATED = theme.cardElevated;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  const SUCCESS = theme.success;
  const SUCCESS_DIM = `${theme.success}20`;
  const ORANGE = theme.warning;
  const ORANGE_DIM = `${theme.warning}20`;
  const RED = theme.error;
  const RED_DIM = `${theme.error}20`;
  const BLUE = theme.accent;
  const BLUE_DIM = theme.accentDim;
  const CYAN = theme.secondary;
  const CYAN_DIM = theme.secondaryDim;
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerSubtitle: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: SP.md,
    gap: SP.sm,
    marginBottom: SP.sm,
  },
  menuTab: {
    flex: 1,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.md,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  menuTabActive: {
    backgroundColor: CARD_ELEVATED,
    borderColor: BORDER_ACTIVE,
  },
  menuTabText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
    textAlign: 'center',
  },
  menuTabTextActive: {
    color: PURPLE_LIGHT,
    fontFamily: FONT.semibold,
  },
  scrollContent: {
    paddingHorizontal: SP.md,
    paddingTop: SP.xs,
    gap: SP.sm,
  },
  emptyState: {
    marginTop: SP.xl,
  },
  itemsList: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingRight: SP.sm,
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  dragHandle: {
    opacity: 0.4,
  },
  visibleToggle: {
    padding: 2,
  },
  itemLabelWrap: {
    flex: 1,
    gap: 1,
  },
  itemLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  itemTarget: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  itemActionBtn: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.xs,
    backgroundColor: SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemActionBtnPurple: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.xs,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemActionBtnDanger: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.xs,
    backgroundColor: RED_DIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.md,
    alignSelf: 'flex-start',
  },
  addItemBtnText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: PURPLE,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.xs,
    backgroundColor: CARD,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.sm,
    marginTop: SP.sm,
  },
  footerNoteText: {
    flex: 1,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 16,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.md,
  },
  modalTitle: {
    fontSize: FS.lg,
    fontFamily: FONT.bold,
    color: FG,
  },
  fieldLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: MUTED,
    letterSpacing: 0.2,
    marginBottom: SP.xs,
  },
  textInput: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
    minHeight: 48,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginTop: SP.xs,
    backgroundColor: ORANGE_DIM,
    borderRadius: RADIUS.sm,
    padding: SP.sm,
  },
  warningText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: ORANGE,
  },
  visibleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SP.md,
  },
  });
};
