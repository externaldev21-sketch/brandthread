/**
 * Colors for one Inbox/Requests pill (see InboxPillRow). The selected pill is
 * a filled accent pill (same treatment as the shared Chip) — never
 * `cardElevated`, which equals the screen background in the default
 * monochrome theme and so made the *active* tab read as plain text while the
 * inactive one kept its outline. Pure (no React Native import) for tests.
 */
export interface InboxPillThemeSlice {
  accent: string; onAccent: string; border: string; borderSubtle: string; muted: string;
}

export function inboxPillColors(theme: InboxPillThemeSlice, active: boolean) {
  return active
    ? {
      backgroundColor: theme.accent,
      borderColor: theme.accent,
      label: theme.onAccent,
      countBackground: `${theme.onAccent}26`,
      countLabel: theme.onAccent,
    }
    : {
      backgroundColor: 'transparent',
      borderColor: theme.border,
      label: theme.muted,
      countBackground: theme.borderSubtle,
      countLabel: theme.muted,
    };
}
