import React from 'react';
export const Image = Object.assign((props: any) => React.createElement('ExpoImage', props), {
  prefetch: async () => true, clearMemoryCache: async () => {}, clearDiskCache: async () => {},
});
