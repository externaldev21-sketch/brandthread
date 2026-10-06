import React from 'react';
export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });
export const useSafeAreaFrame = () => ({ x: 0, y: 0, width: 393, height: 852 });
export const SafeAreaView = (props: any) => React.createElement('SafeAreaView', props, props.children);
export const SafeAreaProvider = ({ children }: any) => children;
export const initialWindowMetrics = { frame: useSafeAreaFrame(), insets: useSafeAreaInsets() };
