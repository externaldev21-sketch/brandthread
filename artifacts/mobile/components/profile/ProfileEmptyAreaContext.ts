import React from 'react';

/**
 * Height a profile list's empty state should fill so it centres in the
 * visible gap between the tabs row and whatever floats over the bottom (tab
 * bar + safe area, floating CTA). Provided by ProfileShell, consumed by
 * ProfileGridPlaceholder; null outside a shell.
 */
export const ProfileEmptyAreaContext = React.createContext<number | null>(null);
