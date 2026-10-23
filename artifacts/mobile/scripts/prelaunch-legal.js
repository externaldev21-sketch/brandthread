const fs = require('fs');
const path = require('path');

const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Legal text stays sourced from the same documents as the app, without
 * shipping an interactive app shell through the two public legal routes. */
function writePrelaunchLegalPages(outputDir, projectRoot) {
  const fonts = fs.readdirSync(path.join(outputDir, 'landing-assets'))
    .filter(name => /^inter-(400|600|700)\.[a-f0-9]+\.ttf$/.test(name))
    .map(name => `@font-face{font-family:Inter;font-weight:${name.match(/\d+/)[0]};font-display:swap;src:url("/landing-assets/${name}") format("truetype")}`)
    .join('\n');
  for (const [id, title] of [['privacy', 'Privacy Policy'], ['terms', 'Terms of Service']]) {
    const markdown = fs.readFileSync(path.join(projectRoot, 'content/legal', `${id}.md`), 'utf8');
    const publicText = markdown.split('\n').filter(line => !line.includes('[LAWYER REVIEW]')).join('\n');
    const content = publicText.split(/\n\s*\n/).map(block => {
      const heading = /^(#{1,6})\s+([\s\S]*)$/.exec(block);
      const tag = heading ? `h${heading[1].length}` : 'p';
      const text = escapeHtml(heading ? heading[2] : block)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      return `<${tag}>${text}</${tag}>`;
    }).join('\n');
    fs.writeFileSync(path.join(outputDir, `${id}.html`), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | Brandthread</title><style>${fonts}
body{margin:0;background:#080808;color:#fff;font-family:Inter,system-ui,sans-serif}
main{max-width:760px;margin:auto;padding:40px 24px 64px;overflow-wrap:anywhere}
p{white-space:pre-wrap;line-height:1.7;color:#ccc}h1,h2,h3{line-height:1.3}a{color:inherit}
</style></head><body><main><a href="/">Brandthread</a>${content}
<footer><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></footer></main></body></html>`);
  }
}
module.exports = { writePrelaunchLegalPages };
