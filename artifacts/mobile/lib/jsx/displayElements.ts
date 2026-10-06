/**
 * App-wide text size and high-contrast icons, applied where elements are
 * created instead of in hundreds of screens.
 *
 * babel.config.js points the automatic JSX runtime of the app's own source
 * (not node_modules) at ./jsx-runtime, which passes each element type through
 * `displayElementType()`:
 *
 *   • react-native `Text` / `Animated.Text` → a wrapper that scales the
 *     element's own fontSize / lineHeight by the account's text size
 *     (lib/displayPrefs.ts scaleTextStyle). Nested Text without its own
 *     fontSize inherits the scaled size from its parent.
 *   • @expo/vector-icons icon sets (any component with a static `glyphMap`:
 *     Feather, Ionicons, MaterialIcons, …) → a wrapper that, with
 *     high-contrast icons on, swaps muted silver/grey tints for the theme's
 *     full-contrast foreground (lib/displayPrefs.ts contrastIconColor).
 *
 * The wrappers always wrap (whatever the setting) so toggling a preference
 * re-renders in place instead of remounting screens. Both read
 * DisplayRuntimeContext, provided by contexts/DisplayPrefsContext.tsx; with
 * no provider they render exactly as before. This module contains no JSX on
 * purpose — it is part of the JSX runtime.
 */
import { createContext, useContext } from 'react';
import { jsx } from 'react/jsx-runtime';
import { Animated, Text } from 'react-native';
import { contrastIconColor, flattenStyle, scaleTextStyle } from '../displayPrefs';
import { FG } from '../theme';

export interface DisplayRuntime {
  /** Multiplier for app text (1 = Default). */
  textScale: number;
  highContrastIcons: boolean;
  /** Full-contrast icon colour for the active theme. */
  iconForeground: string;
}

export const DEFAULT_DISPLAY_RUNTIME: DisplayRuntime = { textScale: 1, highContrastIcons: false, iconForeground: FG };

export const DisplayRuntimeContext = createContext<DisplayRuntime>(DEFAULT_DISPLAY_RUNTIME);

type AnyProps = Record<string, any>;
type AnyComponent = (props: AnyProps) => unknown;

function makeScaledText(Base: unknown, name: string): AnyComponent {
  const Scaled = (props: AnyProps) => {
    const { textScale } = useContext(DisplayRuntimeContext);
    if (textScale === 1) return jsx(Base as never, props);
    const style = scaleTextStyle(props.style, textScale);
    return jsx(Base as never, style === props.style ? props : { ...props, style });
  };
  (Scaled as { displayName?: string }).displayName = name;
  return Scaled;
}

const iconWrappers = new WeakMap<object, AnyComponent>();

function contrastIcon(Icon: object): AnyComponent {
  let Wrapped = iconWrappers.get(Icon);
  if (!Wrapped) {
    Wrapped = (props: AnyProps) => {
      const { highContrastIcons, iconForeground } = useContext(DisplayRuntimeContext);
      if (!highContrastIcons) return jsx(Icon as never, props);
      // vector-icons lets a style colour win over the `color` prop.
      const styleColor = props.style ? flattenStyle(props.style).color : undefined;
      const current = styleColor ?? props.color;
      const next = contrastIconColor(current, iconForeground);
      if (next === current) return jsx(Icon as never, props);
      return jsx(Icon as never, {
        ...props,
        color: next,
        ...(styleColor !== undefined ? { style: [props.style, { color: next }] } : null),
      });
    };
    (Wrapped as { displayName?: string }).displayName =
      `ContrastIcon(${(Icon as { displayName?: string; name?: string }).displayName ?? (Icon as { name?: string }).name ?? 'Icon'})`;
    iconWrappers.set(Icon, Wrapped);
  }
  return Wrapped;
}

// Resolved on first use, never at module load: react-native's own modules
// may still be initialising when this file is first evaluated.
let resolved = false;
let RNText: unknown;
let RNAnimatedText: unknown;
let ScaledText: AnyComponent;
let ScaledAnimatedText: AnyComponent;

function resolveTypes() {
  resolved = true;
  RNText = Text;
  RNAnimatedText = Animated?.Text;
  ScaledText = makeScaledText(RNText, 'Text');
  ScaledAnimatedText = makeScaledText(RNAnimatedText, 'AnimatedText');
}

/** The element type to actually render for `type` (see module comment). */
export function displayElementType<T>(type: T): T {
  if (type === null || (typeof type !== 'function' && typeof type !== 'object')) return type;
  if (!resolved) resolveTypes();
  if (type === RNText) return ScaledText as T;
  if (type === RNAnimatedText && RNAnimatedText) return ScaledAnimatedText as T;
  if (typeof type === 'function' && (type as { glyphMap?: unknown }).glyphMap) return contrastIcon(type) as T;
  return type;
}
