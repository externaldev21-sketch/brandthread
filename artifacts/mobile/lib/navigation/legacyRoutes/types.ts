/**
 * A route that used to be its own screen and now lives somewhere else.
 *
 * `to` is either a fixed href (the old query string is carried over, with the
 * target's own params winning on a clash) or a function that builds the new
 * href from the old query params (for moves that rename or drop params).
 */
export type LegacyParams = Record<string, string>;

export interface LegacyRoute {
  /** Old pathname, e.g. '/analytics-sales'. No query string, no trailing slash. */
  from: string;
  to: string | ((params: LegacyParams) => string);
  /** One line for the route map: why it moved / where the feature lives now. */
  note: string;
}
