import { describe, expect, it } from 'vitest';
import { alertRules, slackAction } from './alert-rules.mjs';

describe('Sentry alert rules', () => {
  it('defines four production rules per project that email owners, falling back to all members', () => {
    for (const app of ['mobile', 'api'] as const) {
      const rules = alertRules({ app });
      expect(rules).toHaveLength(4);
      expect(new Set(rules.map((r) => r.name)).size).toBe(4);
      for (const r of rules) {
        expect(r.environment).toBe('production');
        expect(r.actions).toEqual([{ id: 'sentry.mail.actions.NotifyEmailAction', targetType: 'IssueOwners', fallthroughType: 'ActiveMembers' }]);
        expect(r.conditions.length).toBe(1);
      }
    }
    expect(alertRules({ app: 'mobile' })[0].name).toBe('[Brandthread App] New issue');
    expect(alertRules({ app: 'api' })[0].name).toBe('[Brandthread API] New issue');
  });

  it('adds Slack only when a workspace and channel are both set', () => {
    expect(slackAction(undefined, '#alerts')).toBeNull();
    expect(slackAction('123', 'alerts')).toEqual({ id: 'sentry.integrations.slack.notify_action.SlackNotifyServiceAction', workspace: '123', channel: '#alerts' });
    const rules = alertRules({ app: 'api', slack: slackAction('123', '#alerts') });
    expect(rules.every((r) => r.actions.length === 2)).toBe(true);
  });
});
