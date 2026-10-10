/** Placeholder emails for linked profiles (see lib/accountProfiles.ts). No DB access here. */

export const LINKED_PROFILE_EMAIL_DOMAIN_DEFAULT = "linked.brandthread.app";

export function linkedProfileEmailDomain(): string {
  return (process.env.LINKED_PROFILE_EMAIL_DOMAIN || LINKED_PROFILE_EMAIL_DOMAIN_DEFAULT).trim().toLowerCase();
}

/** Never delivered as-is: mail to it is forwarded to the login's email. */
export function linkedProfileEmail(token: string): string {
  return `p-${token}@${linkedProfileEmailDomain()}`;
}

export function isLinkedProfileEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${linkedProfileEmailDomain()}`);
}

