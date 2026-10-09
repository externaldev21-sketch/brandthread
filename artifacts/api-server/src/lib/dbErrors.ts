/** Postgres 23505 (unique_violation), however drizzle/pg happens to wrap it. */
export function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; cause?: { code?: string } } | null | undefined;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** The violated constraint/index name, e.g. "users_email_ci_unique" — node-postgres exposes this on unique_violation errors. */
export function violatedConstraint(error: unknown): string | undefined {
  const err = error as { constraint?: string; cause?: { constraint?: string } } | null | undefined;
  return err?.constraint ?? err?.cause?.constraint;
}

/**
 * A unique violation on a users.username index: the case-insensitive
 * `users_username_ci_unique` (migration 109) or the plain unique constraint
 * drizzle declares on the column (`users_username_unique` / legacy
 * `users_username_key`), whichever Postgres happens to check first.
 */
export function isUsernameUniqueViolation(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;
  const constraint = violatedConstraint(error);
  return typeof constraint === "string" && /^users_username/.test(constraint);
}
