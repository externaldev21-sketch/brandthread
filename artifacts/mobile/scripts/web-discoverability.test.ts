import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-web.js'), 'utf8');

describe('Brandthread public web discoverability', () => {
  it('uses the stable production origin and indexes only public brand/legal routes', () => {
    expect(source).toContain("const CANONICAL_ORIGIN = 'https://brandthread.app'");
    expect(source).toContain("const PUBLIC_ROUTES = ['/', '/privacy', '/terms', '/community-guidelines']");
    expect(source).toContain("'noindex,nofollow'");
  });

  it('generates crawl files and complete social metadata', () => {
    expect(source).toContain("path.join(outputDir, 'robots.txt')");
    expect(source).toContain("path.join(outputDir, 'sitemap.xml')");
    expect(source).toContain('twitter:card');
    expect(source).toContain('og:image');
    expect(source).toContain('application/ld+json');
    expect(source).toContain("'@type': 'Organization'");
    expect(source).toContain("'@type': 'WebPage'");
  });
});