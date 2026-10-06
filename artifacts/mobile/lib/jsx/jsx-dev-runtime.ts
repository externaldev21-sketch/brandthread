/** Development twin of ./jsx-runtime (babel uses jsxDEV in dev builds). */
import * as ReactJsxDevRuntime from 'react/jsx-dev-runtime';
import { displayElementType } from './displayElements';

export const Fragment = ReactJsxDevRuntime.Fragment;

export function jsxDEV(type: any, props: any, key: any, isStaticChildren: boolean, source?: any, self?: any) {
  return (ReactJsxDevRuntime.jsxDEV as any)(displayElementType(type), props, key, isStaticChildren, source, self);
}
