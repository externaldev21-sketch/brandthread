#!/usr/bin/env node
/**
 * Build Brandthread's themed launcher artwork.
 *
 * The cover artwork is deliberately used as the complete icon artwork: this
 * keeps the colour, texture, and lighting identical to the in-app theme
 * covers.  The supplied Brandthread mark is also used to produce the
 * transparent adaptive-icon foregrounds.
 *
 * Requires ImageMagick (`magick`) and has no network or time-dependent input,
 * so running this script repeatedly produces byte-stable dimensions/modes.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const themesDir = path.join(root, 'assets/images/themes');
const outputDir = path.join(root, 'assets/images/app-icons');
const logo = path.join(root, 'assets/images/brandthread-logo.png');

const themes = [
  ['monochrome', 'theme-black.png'],
  ['purple', 'theme-purple.png'],
  ['olive', 'theme-olive.png'],
  ['navy', 'theme-navy.png'],
  ['champagne', 'theme-champagne.png'],
  ['black', 'theme-black.png'],
  ['silver', 'theme-silver.png'],
  ['black-gold', 'theme-black-gold.png'],
  ['emerald-gold', 'theme-emerald-gold.png'],
  ['leopard-red', 'theme-leopard-red.png'],
  ['maroon', 'theme-maroon.png'],
  ['gold', 'theme-gold.png'],
];

fs.mkdirSync(outputDir, { recursive: true });
const run = (args) => execFileSync('magick', args, { stdio: 'pipe' });

for (const [name, themeFile] of themes) {
  const source = path.join(themesDir, themeFile);
  const icon = path.join(outputDir, `${name}.png`);
  const foreground = path.join(outputDir, `${name}-android-foreground.png`);

  // Resize only (all source covers are square); force opaque sRGB PNG output.
  run([source, '-resize', '1024x1024!', '-alpha', 'off', '-colorspace', 'sRGB',
    'PNG24:' + icon]);

  // Android adaptive foreground: keep the official mark well inside the
  // 66% safe zone.  Its source alpha is retained while the mark is white.
  run([logo, '-resize', '620x620', '-colorspace', 'sRGB',
    '-channel', 'RGB', '-evaluate', 'set', '100%', '+channel',
    '-gravity', 'center', '-background', 'none', '-extent', '1024x1024',
    'PNG32:' + foreground]);
}

// A labelled, evenly spaced review sheet.  The labels are outside the icon
// artwork and therefore never affect the launcher assets.
const sheet = path.join(outputDir, 'contact-sheet.png');
const tiles = themes.map(([name]) => path.join(outputDir, `${name}.png`));
run([
  'montage',
  ...tiles,
  '-thumbnail', '300x300',
  '-background', '#15121d',
  '-font', 'DejaVu-Sans',
  '-tile', '4x3',
  '-geometry', '300x300+18+18',
  '-background', '#15121d',
  '-bordercolor', '#15121d',
  '-border', '8',
  'PNG24:' + sheet,
]);

console.log(`Generated ${themes.length} icons, ${themes.length} Android foregrounds, and ${sheet}`);