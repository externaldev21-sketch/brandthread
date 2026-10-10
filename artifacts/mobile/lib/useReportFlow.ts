/**
 * The one report-flow state machine, shared by the full-screen report route
 * (app/buyer-report.tsx) and the reusable ReportSheet. Both render their own
 * chrome; everything that talks to the server or holds step state lives here.
 *
 * Steps: choose a reason -> add details (required for "Something else") and
 * optionally block the owner -> done.
 */
import { useState } from 'react';
import { haptics } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import {
  REPORT_REASONS, apiErrorMessage, buildReportPayload, reportNoteError, TARGET_LABELS,
} from '@/lib/safety';
import type { ReportReasonId, ReportTargetType } from '@/lib/safetyTypes';

export type ReportStep = 'reason' | 'details' | 'done';

export interface ReportFlowInput {
  targetType: ReportTargetType;
  targetId?: string;
  ownerId?: string;
}

export function useReportFlow({ targetType, targetId, ownerId }: ReportFlowInput) {
  const api = useApi();
  const [step, setStep] = useState<ReportStep>('reason');
  const [reason, setReason] = useState<ReportReasonId | null>(null);
  const [note, setNote] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const selected = REPORT_REASONS.find((r) => r.id === reason) ?? null;
  const noteRequired = reason === 'other';
  const noteTooShort = noteRequired && note.trim().length < 3;
  const canSubmit = !reportNoteError(reason, note) && !submitting && !!targetId;

  function reset() {
    setStep('reason');
    setReason(null);
    setNote('');
    setAlsoBlock(false);
    setSubmitting(false);
    setError(null);
    setAlreadyReported(false);
    setBlocked(false);
    setBlocking(false);
  }

  function chooseReason(id: ReportReasonId) {
    haptics.selection();
    setReason(id);
    setError(null);
    setStep('details');
  }

  /**
   * Submit. Pass a reason to send it straight away (the sheet's one-tap flow
   * for reasons that need no details); otherwise the chosen reason + note go.
   */
  async function submit(quickReason?: ReportReasonId) {
    const sendReason = quickReason ?? reason;
    const sendNote = quickReason ? '' : note;
    if (!targetId || !sendReason || submitting || reportNoteError(sendReason, sendNote)) return;
    if (quickReason) setReason(quickReason);
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.reports.submit(buildReportPayload({ targetType, targetId, reason: sendReason, note: sendNote }));
      setAlreadyReported(result?.status === 'already_reported');
      if (alsoBlock && ownerId) {
        try {
          await api.social.block(ownerId);
          setBlocked(true);
        } catch {
          // The report itself succeeded; the block can be retried from the
          // confirmation step.
        }
      }
      haptics.success();
      setStep('done');
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t send your report. Check your connection and try again.'));
      haptics.error();
    } finally {
      setSubmitting(false);
    }
  }

  async function blockNow() {
    if (!ownerId || blocking) return;
    setBlocking(true);
    try {
      await api.social.block(ownerId);
      setBlocked(true);
      haptics.success();
    } catch (err) {
      setError(apiErrorMessage(err, 'We couldn’t block this account. Try again.'));
    } finally {
      setBlocking(false);
    }
  }

  return {
    step, setStep, reason, selected, note, setNote, alsoBlock, setAlsoBlock,
    submitting, error, alreadyReported, blocked, blocking,
    noteRequired, noteTooShort, canSubmit, targetNoun: TARGET_LABELS[targetType],
    chooseReason, submit, blockNow, reset,
  };
}
