/**
 * Automatic JSX runtime for the app's own source (babel.config.js
 * `jsxImportSource`). Identical to react/jsx-runtime except that element
 * types go through displayElementType() — app-wide text size and
 * high-contrast icons; see ./displayElements.ts.
 */
import * as ReactJsxRuntime from 'react/jsx-runtime';
import { displayElementType } from './displayElements';

export const Fragment = ReactJsxRuntime.Fragment;

export function jsx(type: any, props: any, key?: any) {
  return ReactJsxRuntime.jsx(displayElementType(type), props, key);
}

export function jsxs(type: any, props: any, key?: any) {
  return ReactJsxRuntime.jsxs(displayElementType(type), props, key);
}
