/**
 * The Sentry issue-alert rules for Brandthread (item 127), as Sentry API
 * payloads. Pure: no network, no env reads. Used by create-alerts.mjs.
 *
 * Every rule emails the issue owners, falling back to every active member, so
 * an alert lands on Dev's phone through the mail app's push. When a Slack
 * workspace is connected to Sentry, the same rules also post to a channel
 * (Slack's phone notifications).
 */

const EMAIL = { id: 'sentry.mail.actions.NotifyEmailAction', targetType: 'IssueOwners', fallthroughType: 'ActiveMembers' };

export function slackAction(workspaceId, channel) {
  if (!workspaceId || !channel) return null;
  return { id: 'sentry.integrations.slack.notify_action.SlackNotifyServiceAction', workspace: String(workspaceId), channel: channel.startsWith('#') ? channel : `#${channel}` };
}

/** @param {{ app: 'mobile' | 'api', slack?: object | null }} opts */
export function alertRules({ app, slack = null }) {
  const actions = slack ? [EMAIL, slack] : [EMAIL];
  const label = app === 'mobile' ? 'App' : 'API';
  const rules = [
    {
      name: `[Brandthread ${label}] New issue`,
      conditions: [{ id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition' }],
      frequency: 5,
    },
    {
      name: `[Brandthread ${label}] Issue came back`,
      conditions: [{ id: 'sentry.rules.conditions.regression_event.RegressionEventCondition' }],
      frequency: 30,
    },
    {
      name: `[Brandthread ${label}] Error spike (100+ in an hour)`,
      conditions: [{ id: 'sentry.rules.conditions.event_frequency.EventFrequencyCondition', value: 100, interval: '1h' }],
      frequency: 60,
    },
    {
      name: `[Brandthread ${label}] Hitting many people (25+ users in an hour)`,
      conditions: [{ id: 'sentry.rules.conditions.event_frequency.EventUniqueUserFrequencyCondition', value: 25, interval: '1h' }],
      frequency: 60,
    },
  ];
  return rules.map((r) => ({
    actionMatch: 'any',
    filterMatch: 'all',
    filters: [],
    environment: 'production',
    ...r,
    actions,
  }));
}
