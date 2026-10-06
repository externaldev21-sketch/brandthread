import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }));

import {
  REPORT_NOTE_LIMIT, REPORT_REASONS, buildReportPayload, normalizeReportTarget, reportNoteError,
} from '../lib/safety';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

describe('ReportSheet reason -> payload mapping', () => {
  it('sends every reason id to the server unchanged', () => {
    for (const reason of REPORT_REASONS) {
      const note = reason.id === 'other' ? 'Sells fakes' : undefined;
      expect(buildReportPayload({ targetType: 'post', targetId: 'p1', reason: reason.id, note })).toEqual({
        targetType: 'post', targetId: 'p1', reason: reason.id, ...(note ? { note } : {}),
      });
    }
  });

  it('omits an empty note and trims/limits a long one', () => {
    expect(buildReportPayload({ targetType: 'comment', targetId: 'c1', reason: 'spam', note: '   ' })).not.toHaveProperty('note');
    const payload = buildReportPayload({ targetType: 'comment', targetId: 'c1', reason: 'spam', note: `  ${'x'.repeat(REPORT_NOTE_LIMIT + 50)}  ` });
    expect(payload.note).toHaveLength(REPORT_NOTE_LIMIT);
  });

  it('normalizes target aliases and accepts review reports', () => {
    expect(buildReportPayload({ targetType: 'dm', targetId: 'm1', reason: 'harassment' }).targetType).toBe('message');
    expect(buildReportPayload({ targetType: 'user', targetId: 'u1', reason: 'scam' }).targetType).toBe('profile');
    expect(normalizeReportTarget('review')).toBe('review');
    expect(buildReportPayload({ targetType: 'review', targetId: 'r1', reason: 'spam' }).targetType).toBe('review');
  });

  it('only "Something else" requires a note of at least 3 characters', () => {
    expect(reportNoteError('spam', '')).toBeNull();
    expect(reportNoteError('other', '')).not.toBeNull();
    expect(reportNoteError('other', 'ab')).not.toBeNull();
    expect(reportNoteError('other', 'abc')).toBeNull();
    expect(reportNoteError(null, '')).not.toBeNull();
  });
});

describe('report entry points use the shared sheet', () => {
  it('no longer submits silent "other" reports or hand-built report URLs', () => {
    for (const file of ['app/buyer-search.tsx', 'app/(buyer)/discover.tsx', 'app/(buyer)/friends.tsx', 'app/(tabs)/feed.tsx']) {
      const source = read(file);
      expect(source, file).not.toContain("reason: 'other'");
      expect(source, file).not.toContain('/buyer-report?targetType=');
      expect(source, file).toContain('openReport(');
    }
  });

  it('wires reviews, community members, story mentions and chat privacy to the sheet', () => {
    expect(read('lib/useReviewActions.ts')).toContain("targetType: 'review'");
    expect(read('components/ProductReviewsSection.tsx')).toContain('useReviewActions');
    expect(read('app/product-reviews.tsx')).toContain('useReviewActions');
    expect(read('app/community-members.tsx')).toContain('Report member');
    expect(read('app/story-mention-viewer.tsx')).toContain("targetType: 'story'");
    expect(read('app/conversation-privacy-safety.tsx')).toContain('api.trust.blockStatus');
  });

  it('keeps the full-screen report route and shares one flow implementation with the sheet', () => {
    expect(read('app/buyer-report.tsx')).toContain('useReportFlow');
    expect(read('components/safety/ReportSheet.tsx')).toContain('useReportFlow');
    expect(read('app/_layout.tsx')).toContain('<ReportSheetProvider>');
  });
});
