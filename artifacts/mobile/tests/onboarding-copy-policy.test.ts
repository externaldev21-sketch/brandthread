import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');
function components(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = join(directory, entry.name);
    if (entry.isDirectory()) return components(relative);
    return /\.tsx?$/.test(entry.name) && !/\b(?:test|fixture|preview|demo)\b/i.test(entry.name)
      ? [relative] : [];
  });
}
const retiredPhrases = [
  'Share your fits', 'Keep it real in DMs', 'Find your crew',
  'Pick brands you love', 'Where’s your brand at?',
  'This is how your workspace will greet you.',
  'This is guidance, not a gate.', 'Quote Request Sent! 🎉',
  'Where brands find their people.',
];

describe('professional app copy, with original thread decoration preserved', () => {
  const onboarding = [
    'app/onboarding.tsx', 'app/setup.tsx', 'app/manufacturer-onboard.tsx',
    ...components('components/onboarding'),
  ];
  it.each(onboarding)('%s does not restore retired promotional phrases', (file) => {
    const content = read(file);
    for (const phrase of retiredPhrases) expect(content).not.toContain(phrase);
  });

  it('retired empty-state and prompt wording is absent across app source', () => {
    const remaining: string[] = [];
    for (const file of [...components('app'), ...components('components')]) {
      const source = read(file);
      for (const phrase of retiredPhrases) {
        if (source.includes(phrase)) remaining.push(`${file}: ${phrase}`);
      }
    }
    expect(remaining).toEqual([]);
  });

  it('uses factual headings in brands, inbox and profile empty states', () => {
    expect(read('components/onboarding/launch/ProfileScreens.tsx')).toContain('Choose brands to follow');
    expect(read('components/inbox/MessagesInbox.tsx')).toContain('title="No messages yet"');
    expect(read('components/profile/profileEmptyStates.ts')).toContain("title: 'No posts yet'");
  });

  it('keeps the existing thread renderers and their original dimensions', () => {
    expect(read('app/setup.tsx')).toContain('<ThreadProgress');
    expect(read('app/manufacturer-onboard.tsx')).toContain(
      '<ThreadDraw height={72} color={theme.text} delay={150} duration={1200} style={s.heroThread} />',
    );
    const splash = read('components/splash/AppIntroSplash.tsx');
    expect(splash).toContain("M6,58 C34,10 50,96 78,50 C98,18 108,74 132,42 C144,26 152,40 166,32");
    expect(splash).toContain('strokeDasharray={THREAD_PATH_LENGTH}');
    expect(splash).toContain('duration: 620');
    expect(splash).toContain('styles.streak, echoFar');
    expect(splash).toContain('styles.streak, echoNear');
    expect(splash).toContain('holding.value ?');
    expect(splash).toContain('SplashScreen.hideAsync');
  });
});
