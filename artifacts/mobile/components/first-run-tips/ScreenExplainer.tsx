/**
 * <ScreenExplainer id="..." /> — the one-time "what is this screen" pop-up.
 * One line to mount on any screen a first-time user would need explained:
 * copy comes from SCREEN_EXPLAINERS (lib/firstRunTips/content.ts), seen-state
 * from the shared first-run tips system (server-backed per account, local
 * cache), so it shows once per screen per account and never stacks with
 * another tip or coach.
 *
 * Only shows while its screen is the focused route, so a screen mounted
 * underneath another (a tab kept alive, a stack screen behind a push) never
 * pops its explainer over a different screen.
 */
import React from 'react';
import { FirstRunTip } from './FirstRunTip';
import { useRouteIsFocused } from '@/hooks/useRouteIsFocused';
import { SCREEN_EXPLAINERS, type ScreenExplainerId } from '@/lib/firstRunTips/content';

export interface ScreenExplainerProps {
  id: ScreenExplainerId;
  /** False while the screen is still a loading skeleton. Defaults to true. */
  contentReady?: boolean;
  /** Screen-specific reason to hold off (e.g. its own modal is open). */
  suppressed?: boolean;
}

export function ScreenExplainer({ id, contentReady = true, suppressed = false }: ScreenExplainerProps) {
  const focused = useRouteIsFocused();
  const { title, lines } = SCREEN_EXPLAINERS[id];
  return (
    <FirstRunTip
      id={id}
      variant="explainer"
      contentReady={contentReady && focused}
      suppressed={suppressed}
      explainer={{ title, lines, testID: `first-run-tip-explainer-${id}` }}
    />
  );
}

