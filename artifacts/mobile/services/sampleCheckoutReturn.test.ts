import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.resolve(__dirname, '../app/sample-detail.tsx'), 'utf8');

describe('sample hosted checkout return flow', () => {
  it('uses an auth session with the exact marked return URL', () => {
    expect(source).toContain("paymentReturn: '1'");
    expect(source).toContain('WebBrowser.openAuthSessionAsync(session.url, returnUrl)');
  });

  it('only confirms after a successful redirect, not a browser dismissal', () => {
    const success = source.indexOf("if (result.type === 'success')");
    const confirm = source.indexOf('await confirmHostedPayment();', success);
    const dismiss = source.indexOf("if (result.type === 'cancel' || result.type === 'dismiss')");
    expect(success).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(success);
    expect(dismiss).toBeGreaterThan(confirm);
  });

  it('attempts idempotent confirmation when an existing paid session has no URL and consumes return markers', () => {
    expect(source).toContain('if (!session.url)');
    expect(source).toContain('const confirmed = await confirmHostedPayment();');
    expect(source).toContain('paymentReturnConsumed.current = true');
    expect(source).toContain('router.setParams({ paymentReturn: undefined, paymentPrompt: undefined } as never)');
  });
});