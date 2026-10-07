/** Node renderer's native host boundary; screen logic remains real. */
import React from 'react';
function host(name: string) {
  return React.forwardRef<any, any>((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      focus() {}, blur() {}, clear() {}, scrollTo() {}, scrollToEnd() {},
      setNativeProps() {}, measure(callback: Function) { callback(0, 0, 393, 852, 0, 0); },
      measureInWindow(callback: Function) { callback(0, 100, 280, 56); },
    }));
    return React.createElement(name, props, props.children);
  });
}
export const View = host('View'), Text = host('Text'), TextInput = host('TextInput');
export const Pressable = host('Pressable'), TouchableOpacity = host('TouchableOpacity');
export const ScrollView = host('ScrollView'), Image = host('Image'), ImageBackground = host('ImageBackground');
export const Modal = host('Modal'), ActivityIndicator = host('ActivityIndicator');
export const KeyboardAvoidingView = host('KeyboardAvoidingView'), SafeAreaView = host('SafeAreaView');
export const Switch = host('Switch'), RefreshControl = host('RefreshControl');
export const Platform = { OS: 'android', select: (options: any) => options.android ?? options.native ?? options.default };
export const Dimensions = { get: () => ({ width: 393, height: 852, scale: 1, fontScale: 1 }), addEventListener: () => ({ remove() {} }) };
export const useWindowDimensions = Dimensions.get;
export const StyleSheet = {
  create: <T,>(styles: T) => styles,
  flatten: (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(StyleSheet.flatten)) : style ?? {},
  hairlineWidth: 1, absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  absoluteFill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
};
export const NativeModules = {}, UIManager = { setLayoutAnimationEnabledExperimental() {} };
export const TurboModuleRegistry = {
  get: (_name: string) => null,
  getEnforcing: (name: string) => { throw new Error(`Native module ${name} is unavailable in Node tests`); },
};
export const Keyboard = { dismiss() {}, addListener: () => ({ remove() {} }), isVisible: () => false };
export const Alert = { alert() {} };
export const Linking = { openURL: async () => {}, canOpenURL: async () => true, addEventListener: () => ({ remove() {} }), getInitialURL: async () => null };
export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
export const PixelRatio = { get: () => 1, getFontScale: () => 1, roundToNearestPixel: (n: number) => n };
export const AccessibilityInfo = { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }), announceForAccessibility() {} };
export const useColorScheme = () => 'dark';
export const I18nManager = { isRTL: false };
export const InteractionManager = { runAfterInteractions: (callback: Function) => { callback(); return { cancel() {} }; } };
export const FlatList = (props: any) => React.createElement('FlatList', props,
  props.ListHeaderComponent, ...(props.data ?? []).map((item: any, index: number) => props.renderItem({ item, index })),
  (props.data?.length ? null : props.ListEmptyComponent), props.ListFooterComponent);
export const SectionList = host('SectionList');
export const LayoutAnimation = { configureNext() {}, Presets: { easeInEaseOut: {} } };
export const Easing = {
  linear: (value: number) => value,
  quad: (value: number) => value * value,
  bezier: (..._points: number[]) => (value: number) => value,
  inOut: (easing: (value: number) => number) => easing,
  out: (easing: (value: number) => number) => easing,
  in: (easing: (value: number) => number) => easing,
};
export const Animated = { View, Text, Image, ScrollView, Value: class { constructor(public value: number) {} setValue(n: number) { this.value = n; } interpolate() { return this.value; } }, timing: () => ({ start(callback?: Function) { callback?.({ finished: true }); }, stop() {} }), spring: () => ({ start() {}, stop() {} }), parallel: () => ({ start() {}, stop() {} }), event: () => () => {} };
