/**
 * One username / display-name case rule (less-AI pass item 29):
 * - A handle is always lowercase with exactly one leading "@" ("@northline").
 * - A display name is shown exactly as the person typed it — never
 *   upper-cased, title-cased or lower-cased by the UI.
 */
export function formatHandle(handle: string | null | undefined): string {
  const bare = (handle ?? '').trim().replace(/^@+/, '').toLowerCase();
  return bare ? `@${bare}` : '';
}
