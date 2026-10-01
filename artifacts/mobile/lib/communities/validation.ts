/** Client-side mirror of the server's group name / description rules (routes/communities.ts). */
export const NAME_MIN = 3;
export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 160;

export function validateGroupName(name: string): string | null {
  const n = name.trim();
  if (n.length < NAME_MIN) return `Group names are at least ${NAME_MIN} characters.`;
  if (n.length > NAME_MAX) return `Group names are up to ${NAME_MAX} characters.`;
  return null;
}

export function validateGroupDescription(description: string): string | null {
  if (description.trim().length > DESCRIPTION_MAX) return `Descriptions can be up to ${DESCRIPTION_MAX} characters.`;
  return null;
}
