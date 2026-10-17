/**
 * WebSocket upgrade paths.
 *
 * On the deployed site only `/api/*` (plus the public paths listed in this
 * artifact's artifact.toml) reaches this server — a bare `/ws/live` upgrade
 * lands on the static web server and never connects, so clients fell back to
 * slow polling. Clients now connect under `/api/ws/*`; the bare `/ws/*` form
 * is still accepted so already-installed app builds keep working.
 */
export function wsPathAliases(wsPath: string): string[] {
  return [wsPath, `/api${wsPath}`, `/api/v1${wsPath}`];
}

export function matchesWsPath(pathname: string, wsPath: string): boolean {
  return wsPathAliases(wsPath).includes(pathname);
}
