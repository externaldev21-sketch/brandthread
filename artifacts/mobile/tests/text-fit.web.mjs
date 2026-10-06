#!/usr/bin/env node
/**
 * Text-fit audit dispatcher.
 *
 * Existing route-based audit:
 *   TEXT_FIT_BASE=http://localhost:8171 node tests/text-fit.web.mjs '[["buyer","/buyer-settings"]]'
 *
 * Exported-build dashboard audit:
 *   node tests/text-fit.web.mjs --build-dir=<dir> --role=seller [--shots=<dir>]
 *
 * Direct URL or HTML-file audit:
 *   node tests/text-fit.web.mjs <url-or-html-file> [screenshot.png]
 */
import fs from 'node:fs';
import path from 'node:path';

export const FIT_SCRIPT = () => {
  const issues = [];
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} "${(el.innerText || el.value || '').trim().slice(0, 40)}"`;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw) issues.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const ownsText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const isField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
    if (ownsText || isField) {
      if (el.scrollWidth > el.clientWidth + 1 && el.tagName !== 'TEXTAREA') {
        issues.push(`clipped text: ${label(el)} (${el.scrollWidth} > ${el.clientWidth})`);
      }
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) issues.push(`ellipsis in use: ${label(el)}`);
    }
    const parent = el.parentElement;
    if (parent && parent !== document.body && visible(parent)) {
      const a = el.getBoundingClientRect();
      const b = parent.getBoundingClientRect();
      if (a.left < b.left - 1 || a.right > b.right + 1) issues.push(`box leaves parent: ${label(el)} in ${label(parent)}`);
    }
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
      const padL = parseFloat(cs.paddingLeft);
      const padR = parseFloat(cs.paddingRight);
      if (ownsText && (padL < 12 || padR < 12)) issues.push(`button padding < 12px: ${label(el)} (${padL}/${padR})`);
    }
  }
  const buttons = [...document.body.querySelectorAll('button,[role=button]')].filter(visible);
  const rows = new Map();
  for (const button of buttons) {
    const rect = button.getBoundingClientRect();
    const key = Math.round(rect.top / 4);
    (rows.get(key) ?? rows.set(key, []).get(key)).push(rect);
  }
  for (const group of rows.values()) {
    if (group.length < 2) continue;
    if (new Set(group.map((r) => Math.round(r.height))).size > 1 ||
      new Set(group.map((r) => Math.round(r.width))).size > 1) {
      issues.push('buttons in one row differ in size');
    }
  }
  return issues;
};

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  for (const dir of fs.readdirSync(root).filter((entry) => entry.startsWith('chromium'))) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
      const candidate = path.join(root, dir, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

async function auditDirectTarget(target, shot) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ executablePath: findChromium(), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
    const url = /^https?:/.test(target) ? target : `file://${path.resolve(target)}`;
    await page.goto(url, { waitUntil: 'load' });
    const issues = await page.evaluate(FIT_SCRIPT);
    if (shot) await page.screenshot({ path: shot, fullPage: true });
    if (issues.length) {
      console.error(`TEXT-FIT FAIL (${issues.length})\n - ${issues.join('\n - ')}`);
      process.exitCode = 1;
    } else {
      console.log('TEXT-FIT PASS at 393x852');
    }
  } finally {
    await browser.close();
  }
}

const buildHarness = process.argv.some((arg) => arg.startsWith('--build-dir='));
if (buildHarness) {
  await import('./text-fit.web-build.mjs');
} else {
  const target = process.argv[2];
  const isDirectTarget = /^https?:/.test(target ?? '') ||
    (!!target && fs.existsSync(target) && fs.statSync(target).isFile());
  if (isDirectTarget) {
    await auditDirectTarget(target, process.argv[3]);
  } else {
    await import('./text-fit.web-legacy.mjs');
  }
}