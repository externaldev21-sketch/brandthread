/** Data behind the onboarding profile card (components/onboarding/ProfileBuildCard.tsx). */
export interface ProfileCardData {
  name: string;
  handle: string;
  photoUri: string | null;
}

/** First letter of the name, else of the handle, for the empty photo slot. Empty when neither is set. */
export function profileInitial({ name, handle }: Pick<ProfileCardData, 'name' | 'handle'>): string {
  const source = name.trim() || handle.trim().replace(/^@/, '');
  return source ? source[0]!.toUpperCase() : '';
}
