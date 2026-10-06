import React from 'react';
const host = (name: string) => (props: any) => React.createElement(name, props, props.children);
export const LinearGradient = host('LinearGradient');
export const BlurView = host('BlurView');
export const VideoView = host('VideoView');
export const useVideoPlayer = (_source: unknown, setup?: (player: any) => void) => {
  const player = React.useMemo(() => ({ play() {}, pause() {}, replace() {}, addListener: () => ({ remove() {} }), loop: false, muted: false, currentTime: 0 }), []);
  React.useEffect(() => { setup?.(player); }, [player]);
  return player;
};
