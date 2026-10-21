import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');

describe('Discover search, spacing and floating-navigation clearance', () => {
  it('uses an elevated filled search pill without a hairline outline', () => {
    const header = read('components/discover/DiscoverSearchHeader.tsx');
    expect(header).toContain('backgroundColor: theme.cardElevated');
    expect(header).toContain('height: 44, borderRadius: RADII.pill, borderWidth: 0');
    const overlay = read('components/discover/search/DiscoverSearchOverlay.tsx');
    expect(overlay).toContain('SEARCH_BAR_HEIGHT = 44');
    expect(overlay).toContain('backgroundColor: theme.cardElevated');
  });

  it('keeps the filters above search and does not reserve an empty strip below it', () => {
    const header = read('components/discover/DiscoverSearchHeader.tsx');
    expect(header.indexOf('{beforeSearch}')).toBeLessThan(header.indexOf('<TouchableOpacity'));
    expect(header).toContain('marginBottom: 0');
    const filters = read('components/discover/DiscoverFilterRow.tsx');
    expect(filters).toContain('divider={false}');
    expect(filters).not.toContain('onChange={onChange} scrollable');
    const grid = read('components/discover/DiscoverGrid.tsx');
    expect(grid).toContain('paddingHorizontal: MASONRY_SIDE');
  });

  it('renders an explicit footer spacer from the shared tab bar clearance', () => {
    expect(read('app/(buyer)/discover.tsx')).toContain('bottomClearance={tabBarClearance}');
    const grid = read('components/discover/DiscoverGrid.tsx');
    expect(grid).toContain('bottomClearance > 0');
    expect(grid).toContain('style={{ height: bottomClearance }} testID="discover-bottom-clearance"');
  });

  it('hides creator rows only when all loaded posts have the same nonempty author ID', () => {
    const grid = read('components/discover/DiscoverGrid.tsx');
    expect(grid).toContain('posts.length > 0 && !!posts[0].authorId');
    expect(grid).toContain('posts.every(post => post.authorId === posts[0].authorId)');
    expect(grid).toContain('showCreator={!hideCreatorRows}');
    expect(grid).toContain('(hideCreatorRows ? 0 : MASONRY_CAPTION_HEIGHT)');
    const tile = read('components/discover/DiscoverMasonryTile.tsx');
    expect(tile).toContain('showCreator = true');
    expect(tile).toContain('{showCreator ? <View style={styles.byline}>');
  });
});
