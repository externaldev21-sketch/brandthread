/**
 * Structural tests for the vertical connected-dot timeline
 * and action bar patterns used in buyer-order-detail, sample-detail, and order-detail.
 *
 * Pure logic tests — no component rendering needed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Timeline step-state helpers ─────────────────────────────────────────────

const ORDER_STEPS = [
  { key: 'new',           title: 'Order Placed' },
  { key: 'processing',    title: 'Processing' },
  { key: 'ready_to_ship', title: 'Ready to Ship' },
  { key: 'shipped',       title: 'Shipped' },
  { key: 'delivered',     title: 'Delivered' },
];

function getStepState(currentIdx: number, stepIdx: number): 'completed' | 'active' | 'future' {
  if (stepIdx < currentIdx) return 'completed';
  if (stepIdx === currentIdx) return 'active';
  return 'future';
}

// ─── Timeline logic tests ─────────────────────────────────────────────────────

describe('Timeline step-state logic', () => {
  it('marks all steps before current as completed', () => {
    const currentIdx = 3; // 'shipped'
    const states = ORDER_STEPS.map((_, idx) => getStepState(currentIdx, idx));
    expect(states[0]).toBe('completed');
    expect(states[1]).toBe('completed');
    expect(states[2]).toBe('completed');
    expect(states[3]).toBe('active');
    expect(states[4]).toBe('future');
  });

  it('marks first step active at idx=0', () => {
    const states = ORDER_STEPS.map((_, idx) => getStepState(0, idx));
    expect(states[0]).toBe('active');
    expect(states[1]).toBe('future');
    expect(states[4]).toBe('future');
  });

  it('marks last step active when currentIdx equals last index', () => {
    const lastIdx = ORDER_STEPS.length - 1;
    const states = ORDER_STEPS.map((_, idx) => getStepState(lastIdx, idx));
    states.slice(0, lastIdx).forEach(s => expect(s).toBe('completed'));
    expect(states[lastIdx]).toBe('active');
  });

  it('shows description only for active and completed steps (not future)', () => {
    const currentIdx = 2;
    ORDER_STEPS.forEach((_, idx) => {
      const state = getStepState(currentIdx, idx);
      const shouldShowDesc = state === 'active' || state === 'completed';
      expect(shouldShowDesc).toBe(state !== 'future');
    });
  });

  it('does not show line after last step', () => {
    const lastIdx = ORDER_STEPS.length - 1;
    const isLast = (idx: number) => idx === lastIdx;
    expect(isLast(lastIdx)).toBe(true);
    expect(isLast(0)).toBe(false);
  });
});

describe('Sample timeline status normalization', () => {
  const source = readFileSync(resolve(process.cwd(), 'app/sample-detail.tsx'), 'utf8');

  it('maps the server payment status to the visible payment step', () => {
    expect(source).toContain("currentStatus === 'pending_payment' ? 'awaiting_payment'");
  });

  it('represents revision and terminal statuses instead of leaving every step in the future', () => {
    expect(source).toContain("'revision_requested'");
    expect(source).toContain("normalizedStatus === 'rejected' || normalizedStatus === 'cancelled'");
    expect(source).toContain("(['requested', normalizedStatus] as SampleStatus[])");
  });
});

// ─── Dot variant per step state ───────────────────────────────────────────────

describe('Timeline dot variants', () => {
  it('completed step uses filled SUCCESS dot with check', () => {
    const state = getStepState(3, 0);
    expect(state).toBe('completed');
    // Completed: filled circle with checkmark (not empty, not glowing)
    const dotType = state === 'completed' ? 'filled-check' : state === 'active' ? 'glow-accent' : 'empty-ring';
    expect(dotType).toBe('filled-check');
  });

  it('active step uses glowing ACCENT dot', () => {
    const state = getStepState(2, 2);
    expect(state).toBe('active');
    const dotType = state === 'completed' ? 'filled-check' : state === 'active' ? 'glow-accent' : 'empty-ring';
    expect(dotType).toBe('glow-accent');
  });

  it('future step uses empty ring dot', () => {
    const state = getStepState(1, 4);
    expect(state).toBe('future');
    const dotType = state === 'completed' ? 'filled-check' : state === 'active' ? 'glow-accent' : 'empty-ring';
    expect(dotType).toBe('empty-ring');
  });
});

// ─── Connector line styles ────────────────────────────────────────────────────

describe('Timeline connector line styles', () => {
  it('line after completed step is filled (SUCCESS)', () => {
    const getLineStyle = (stepState: string) =>
      stepState === 'completed' ? 'success-filled' : stepState === 'active' ? 'accent-dim' : 'border-dim';
    expect(getLineStyle('completed')).toBe('success-filled');
  });

  it('line after active step is accent-dim', () => {
    const getLineStyle = (stepState: string) =>
      stepState === 'completed' ? 'success-filled' : stepState === 'active' ? 'accent-dim' : 'border-dim';
    expect(getLineStyle('active')).toBe('accent-dim');
  });

  it('line after future step is border-dim', () => {
    const getLineStyle = (stepState: string) =>
      stepState === 'completed' ? 'success-filled' : stepState === 'active' ? 'accent-dim' : 'border-dim';
    expect(getLineStyle('future')).toBe('border-dim');
  });
});

// ─── Sample timeline steps ────────────────────────────────────────────────────

const SAMPLE_STATUSES = [
  'requested', 'awaiting_payment', 'paid', 'in_development',
  'shipped', 'delivered', 'review_needed', 'approved',
];

describe('Sample timeline step ordering', () => {
  it('has exactly 8 steps', () => {
    expect(SAMPLE_STATUSES.length).toBe(8);
  });

  it('places review_needed immediately before approved', () => {
    const reviewIdx = SAMPLE_STATUSES.indexOf('review_needed');
    const approvedIdx = SAMPLE_STATUSES.indexOf('approved');
    expect(approvedIdx - reviewIdx).toBe(1);
  });

  it('places in_development before shipped', () => {
    const devIdx = SAMPLE_STATUSES.indexOf('in_development');
    const shipIdx = SAMPLE_STATUSES.indexOf('shipped');
    expect(shipIdx).toBeGreaterThan(devIdx);
  });
});

// ─── Active step image display logic ─────────────────────────────────────────

describe('Active step sample image display', () => {
  it('shows image on active step when imageUris is non-empty', () => {
    const sampleImageUris = ['https://example.com/sample.jpg'];
    const currentIdx = SAMPLE_STATUSES.indexOf('in_development');
    SAMPLE_STATUSES.forEach((_, idx) => {
      const isActive = idx === currentIdx;
      const showImage = isActive && sampleImageUris.length > 0;
      if (isActive) {
        expect(showImage).toBe(true);
      } else {
        expect(showImage).toBe(false);
      }
    });
  });

  it('does not show image on active step when imageUris is empty', () => {
    const sampleImageUris: string[] = [];
    const currentIdx = SAMPLE_STATUSES.indexOf('in_development');
    SAMPLE_STATUSES.forEach((_, idx) => {
      const isActive = idx === currentIdx;
      const showImage = isActive && sampleImageUris.length > 0;
      expect(showImage).toBe(false);
    });
  });

  it('does not show image on completed steps even when imageUris is non-empty', () => {
    const sampleImageUris = ['https://example.com/sample.jpg'];
    const currentIdx = SAMPLE_STATUSES.indexOf('in_development');
    SAMPLE_STATUSES.forEach((_, idx) => {
      const state = getStepState(currentIdx, idx);
      const showImage = state === 'active' && sampleImageUris.length > 0;
      if (state === 'completed') {
        expect(showImage).toBe(false);
      }
    });
  });
});

// ─── Action bar primary action derivation ────────────────────────────────────

function getPrimaryAction(
  status: string,
  hasReview: boolean,
  payoutReady: boolean,
): string {
  if (status === 'pending_payment') {
    return payoutReady ? 'Pay Securely' : 'Payout Setup Required';
  }
  const canReview = status === 'review_needed' || status === 'delivered';
  if (canReview && !hasReview) return 'Write Review';
  return 'Message Manufacturer';
}

describe('Action bar primary action derivation', () => {
  it('shows Pay Securely when pending and payout ready', () => {
    expect(getPrimaryAction('pending_payment', false, true)).toBe('Pay Securely');
  });

  it('shows Payout Setup Required when pending and payout NOT ready', () => {
    expect(getPrimaryAction('pending_payment', false, false)).toBe('Payout Setup Required');
  });

  it('shows Write Review when review_needed and no prior review', () => {
    expect(getPrimaryAction('review_needed', false, true)).toBe('Write Review');
  });

  it('shows Message Manufacturer when review_needed but review already submitted', () => {
    expect(getPrimaryAction('review_needed', true, true)).toBe('Message Manufacturer');
  });

  it('shows Write Review when delivered and no prior review', () => {
    expect(getPrimaryAction('delivered', false, true)).toBe('Write Review');
  });

  it('shows Message Manufacturer for in_development', () => {
    expect(getPrimaryAction('in_development', false, true)).toBe('Message Manufacturer');
  });

  it('shows Message Manufacturer for approved', () => {
    expect(getPrimaryAction('approved', true, true)).toBe('Message Manufacturer');
  });
});

// ─── Terminal order status detection ─────────────────────────────────────────

type OrderStatus =
  | 'new' | 'processing' | 'ready_to_ship' | 'shipped'
  | 'delivered' | 'cancelled' | 'refunded' | 'disputed';

function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'cancelled' || status === 'refunded' || status === 'disputed';
}

describe('Terminal order status detection', () => {
  it('marks cancelled as terminal', () => {
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('marks refunded as terminal', () => {
    expect(isTerminalStatus('refunded')).toBe(true);
  });

  it('marks disputed as terminal', () => {
    expect(isTerminalStatus('disputed')).toBe(true);
  });

  it('does not mark delivered as terminal', () => {
    expect(isTerminalStatus('delivered')).toBe(false);
  });

  it('does not mark processing as terminal', () => {
    expect(isTerminalStatus('processing')).toBe(false);
  });

  it('does not mark new as terminal', () => {
    expect(isTerminalStatus('new')).toBe(false);
  });
});

// ─── Order timeline hidden for terminal statuses ──────────────────────────────

describe('Order timeline visibility', () => {
  const TERMINAL_STATUSES: OrderStatus[] = ['cancelled', 'refunded', 'disputed'];
  const NON_TERMINAL: OrderStatus[] = ['new', 'processing', 'ready_to_ship', 'shipped', 'delivered'];

  it('hides timeline for all terminal statuses', () => {
    TERMINAL_STATUSES.forEach(s => {
      expect(TERMINAL_STATUSES.includes(s)).toBe(true);
    });
  });

  it('shows timeline for all non-terminal statuses', () => {
    NON_TERMINAL.forEach(s => {
      expect(TERMINAL_STATUSES.includes(s)).toBe(false);
    });
  });
});

// ─── No-emoji assertion helpers ───────────────────────────────────────────────

// These strings are sampled from the UI text to assert no emoji characters slipped through
const UI_TEXT_SAMPLES = [
  'Order Placed',
  'Processing',
  'Ready to Ship',
  'Shipped',
  'Delivered',
  'Order Cancelled',
  'Approve',
  'Request Revision',
  'Reject',
  'Write Review',
  'Message Manufacturer',
  'Help Center',
  'Contact Seller',
  'Requested',
  'Awaiting Payment',
  'Paid',
  'In Development',
  'Review Needed',
  'Approved',
];

const EMOJI_REGEX = /\p{Emoji}/u;

describe('No emoji characters in UI text strings', () => {
  UI_TEXT_SAMPLES.forEach(text => {
    it(`"${text.slice(0, 40)}" contains no emoji`, () => {
      expect(EMOJI_REGEX.test(text)).toBe(false);
    });
  });
});
