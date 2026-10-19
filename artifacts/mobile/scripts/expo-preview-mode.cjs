#!/usr/bin/env node
// Developer tooling only. The managed Expo workflow stays the single server.
// The local choice is ignored by Git and is never read by app/runtime code.
const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../../../.local/expo-preview-mode');
const requested = process.argv[2];
if (requested) {
  if (!['development', 'production'].includes(requested)) {
    console.error('Usage: expo-preview-mode.cjs [development|production]');
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${requested}\n`);
  console.log(`Expo preview mode: ${requested}. Restart the managed Expo workflow to apply.`);
} else {
  const mode = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : 'development';
  if (mode === 'production') process.stdout.write('--no-dev --minify');
}
