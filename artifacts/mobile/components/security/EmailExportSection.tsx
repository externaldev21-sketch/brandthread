/**
 * "Email me a download link" — the async data export. The instant export on
 * the host screen is untouched; this adds a server-built file (follows, posts,
 * saved items, addresses, blocks as well) that is emailed as a 7-day link and
 * can also be fetched here once it's ready.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Linking } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useApi, type DataExportJob, type DataExportJobsResponse } from '@/lib/api';
import { apiErrorCode, apiErrorMessage } from '@/lib/safety';
import { Button, Card } from '@/components/ui';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';

const EXTRA_CATEGORIES = ['follows', 'posts', 'saved', 'addresses', 'blocks'];

function dateLabel(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
}

export function statusCopy(job: DataExportJob | null, emailEnabled: boolean): { title: string; body: string } {
  if (!job) return { title: '', body: 'We’ll email you a link when it’s ready.' };
  switch (job.status) {
    case 'queued':
    case 'running':
      return { title: 'Preparing your file', body: emailEnabled ? 'We’ll email you a link when it’s ready.' : 'It will show up here when it’s ready.' };
    case 'ready':
      return {
        title: 'Your file is ready',
        body: `${job.emailed ? 'Link sent to your email. ' : ''}Available until ${dateLabel(job.expiresAt)}.`,
      };
    case 'failed':
      return { title: 'Export failed', body: 'We couldn’t build your file. Try again.' };
    default:
      return { title: 'Export expired', body: 'Links last 7 days. Request a new export any time.' };
  }
}

export function EmailExportSection({ categories }: { categories: string[] }) {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const api = useApi();
  const preview = isBuyerDevPreview() || isSellerDevPreview();
  const [state, setState] = useState<DataExportJobsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (preview) return;
    try { setState(await api.dataExportJobs.list()); } catch { /* keep the last known state */ }
  }, [api, preview]);

  useEffect(() => { void load(); }, [load]);

  const latest = state?.jobs[0] ?? null;
  const inFlight = latest?.status === 'queued' || latest?.status === 'running';
  useEffect(() => {
    if (!inFlight) return;
    timer.current = setTimeout(() => { void load(); }, 5000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [inFlight, state, load]);

  async function request() {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await api.dataExportJobs.create([...new Set([...categories, ...EXTRA_CATEGORIES])]);
      await load();
    } catch (err) {
      if (apiErrorCode(err) === 'DATA_EXPORT_RATE_LIMITED') {
        setNotice('You can request one export every 24 hours.');
        await load();
      } else {
        setNotice(apiErrorMessage(err, 'Couldn’t start your export. Try again.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function download(job: DataExportJob) {
    setBusy(true);
    setNotice('');
    try {
      const { url } = await api.dataExportJobs.link(job.id);
      await Linking.openURL(url);
    } catch (err) {
      setNotice(apiErrorMessage(err, 'Couldn’t open your export. Try again.'));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const copy = statusCopy(latest, state?.emailEnabled ?? true);
  const nextAt = state?.nextRequestAt ?? null;
  const canRequest = !inFlight && !(latest && latest.status !== 'failed' && nextAt);

  return (
    <View style={s.wrap}>
      <Text style={s.group}>Get it by email</Text>
      <Card style={s.card}>
        {copy.title ? <Text style={s.title}>{copy.title}</Text> : null}
        <Text style={s.body}>{copy.body}</Text>
        {notice ? <Text testID="export-job-notice" style={s.body}>{notice}</Text> : null}
        {latest?.status === 'ready' && latest.downloadable ? (
          <Button testID="download-export-job" label="Download" icon="download" onPress={() => { void download(latest); }} loading={busy} fullWidth style={s.btn} />
        ) : null}
        {canRequest ? (
          <Button
            testID="request-export-job"
            label="Email me a download link"
            variant={latest?.status === 'ready' ? 'secondary' : 'primary'}
            icon="mail"
            onPress={() => { void request(); }}
            loading={busy}
            fullWidth
            style={s.btn}
          />
        ) : inFlight ? null : (
          <Text style={s.body}>You can request another on {dateLabel(nextAt)}.</Text>
        )}
      </Card>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  wrap: { marginTop: SPACING.lg },
  group: { ...TYPE_SCALE.caption, color: colors.mutedForeground, marginBottom: SPACING.xs },
  card: { padding: SPACING.md, paddingHorizontal: SPACING.md, gap: 4 },
  title: { ...TYPE_SCALE.body, fontFamily: FONT.semibold, color: colors.foreground },
  body: { ...TYPE_SCALE.footnote, color: colors.mutedForeground, lineHeight: 18 },
  btn: { marginTop: SPACING.sm },
});
