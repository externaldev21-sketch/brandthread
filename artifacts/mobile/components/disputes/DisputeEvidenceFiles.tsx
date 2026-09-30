import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useApi } from '@/lib/api';
import type { DisputeEvidenceFile, DisputeFileType } from '@/lib/disputeTypes';
import { DISPUTE_FILE_TYPES, fileTypeLabel, formatBytes, shortDate } from './disputeUi';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'application/pdf'];

interface Props {
  disputeId: string;
  files: DisputeEvidenceFile[];
  /** No more uploads: evidence was submitted or the dispute is finished. */
  locked: boolean;
  /** Signed-out preview: show the list, never call the API. */
  readOnly?: boolean;
  onAdded: (file: DisputeEvidenceFile) => void;
}

function uploadErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : '';
  if (/413|5 MB/i.test(text)) return 'That file is over 5 MB.';
  if (/415|JPEG/i.test(text)) return 'Use a JPEG, PNG or PDF.';
  if (/409/.test(text)) return 'Evidence was already submitted.';
  return 'Try again.';
}

export function DisputeEvidenceFiles({ disputeId, files, locked, readOnly, onAdded }: Props) {
  const colors = useColors();
  const api = useApi();
  const [type, setType] = useState<DisputeFileType>('receipt');
  const [busy, setBusy] = useState(false);

  const upload = async (asset: { uri: string; mimeType?: string | null; name?: string | null; size?: number | null }) => {
    const mimeType = (asset.mimeType ?? '').toLowerCase() || (asset.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    if (!ALLOWED.includes(mimeType)) {
      Alert.alert('Unsupported file', 'Use a JPEG, PNG or PDF.');
      return;
    }
    if (asset.size && asset.size > MAX_BYTES) {
      Alert.alert('File too large', 'Files can be up to 5 MB.');
      return;
    }
    setBusy(true);
    try {
      const res = await api.disputes.uploadEvidenceFile(
        disputeId, { uri: asset.uri, mimeType, name: asset.name ?? undefined }, type,
      );
      onAdded(res.file);
    } catch (err) {
      Alert.alert('Couldn’t upload file', uploadErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Allow photo access in Settings to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    await upload({ uri: a.uri, mimeType: a.mimeType, name: a.fileName, size: a.fileSize });
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ALLOWED,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    await upload({ uri: a.uri, mimeType: a.mimeType, name: a.name, size: a.size });
  };

  return (
    <View style={{ gap: SP.sm }}>
      <Text style={[styles.heading, { color: colors.foreground }]}>Evidence files</Text>

      {files.length > 0 ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {files.map((f, i) => (
            <View
              key={f.id}
              style={[styles.fileRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              testID={`dispute-file-${f.id}`}
            >
              <View style={[styles.fileIcon, { backgroundColor: colors.secondary }]}>
                <Feather
                  name={f.contentType === 'application/pdf' ? 'file-text' : 'image'}
                  size={16}
                  color={colors.mutedForeground}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={1}>{f.fileName}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {fileTypeLabel(f.evidenceType)} · {formatBytes(f.sizeBytes)} · {shortDate(f.uploadedAt)}
                </Text>
              </View>
              <Feather name="check" size={16} color={colors.foreground} />
            </View>
          ))}
        </View>
      ) : (
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>No files uploaded.</Text>
      )}

      {!locked && !readOnly ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: SP.md, gap: SP.sm }]}>
          <Text style={[styles.label, { color: colors.foreground }]}>Add a file</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {DISPUTE_FILE_TYPES.map((t) => {
                const active = type === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    onPress={() => setType(t.key)}
                    style={[
                      styles.chip,
                      { borderColor: active ? colors.foreground : colors.border },
                      active && { backgroundColor: colors.foreground },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.background : colors.mutedForeground }]}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity
              disabled={busy}
              onPress={() => void pickPhoto()}
              style={[styles.action, { borderColor: colors.border }]}
              accessibilityRole="button"
            >
              <Feather name="image" size={16} color={colors.foreground} />
              <Text style={[styles.actionText, { color: colors.foreground }]}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={busy}
              onPress={() => void pickDocument()}
              style={[styles.action, { borderColor: colors.border }]}
              accessibilityRole="button"
            >
              <Feather name="file-text" size={16} color={colors.foreground} />
              <Text style={[styles.actionText, { color: colors.foreground }]}>PDF or file</Text>
            </TouchableOpacity>
          </View>
          {busy ? <ActivityIndicator color={colors.foreground} /> : (
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              JPEG, PNG or PDF, up to 5 MB. A new file replaces the one of the same type.
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: FS.base, fontFamily: FONT.semibold },
  label: { fontSize: FS.base, fontFamily: FONT.semibold },
  card: { borderRadius: 14, borderWidth: 1 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, padding: SP.md },
  fileIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  fileName: { fontSize: FS.sm, fontFamily: FONT.semibold },
  meta: { fontSize: FS.meta, fontFamily: FONT.regular },
  chipRow: { flexDirection: 'row', gap: SP.sm },
  chip: { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.pill, borderWidth: 1 },
  chipText: { fontSize: FS.meta, fontFamily: FONT.medium },
  actions: { flexDirection: 'row', gap: SP.sm },
  action: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
    paddingVertical: SP.sm + 4, borderRadius: RADIUS.md, borderWidth: 1, minHeight: 44,
  },
  actionText: { fontSize: FS.sm, fontFamily: FONT.semibold },
});
