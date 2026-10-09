/**
 * Regenerates docs/route-map.md from lib/navigation/legacyRoutes:
 *   ROUTE_MAP_WRITE=1 pnpm vitest run tests/route-map-doc.gen.test.ts
 * (A no-op in the normal suite; tests/legacy-routes.test.ts checks the doc.)
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'vitest';

import { LEGACY_ROUTES } from '../lib/navigation/legacyRoutes';
import { appRoutePatterns } from './helpers/appRoutes';

const SAMPLE = { orderId: '<orderId>', id: '<id>', projectId: '<projectId>', productId: '<productId>' };

it('writes docs/route-map.md', () => {
  if (!process.env.ROUTE_MAP_WRITE) return;
  const rows = LEGACY_ROUTES.map((r) => {
    const to = typeof r.to === 'function'
      ? `\`${r.to(SAMPLE)}\` (without params: \`${r.to({})}\`)`
      : `\`${r.to}\``;
    return `| \`${r.from}\` | ${to} | ${r.note} |`;
  });
  const screens = appRoutePatterns().length;
  const doc = [
    '# Route map: old → new',
    '',
    'Screens that were merged or removed no longer have a file in `app/`. Their old',
    'paths still work: `app/+not-found.tsx` looks them up in',
    '`lib/navigation/legacyRoutes/` and replaces the URL with the new home (the old',
    'query string is carried over). In-app links point straight at the new home;',
    '`tests/legacy-routes.test.ts` fails if anything links to an old path, if a',
    'target is missing, or if this file falls out of date.',
    '',
    `Screens in \`app/\` now: **${screens}** (route files, excluding layouts and tests).`,
    '',
    '| Old route | New home | Why |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  writeFileSync(path.resolve(__dirname, '..', 'docs', 'route-map.md'), doc);
});
