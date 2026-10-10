import { useEffect, useState } from 'react';
import { INITIAL_RTC_STATE, type RtcEngine, type RtcMediaState } from './types';

/** Re-renders on media changes (remote joined, video on/off) of the call's engine. */
export function useRtcState(engine: RtcEngine | null): RtcMediaState {
  const [state, setState] = useState<RtcMediaState>(() => engine?.getState() ?? INITIAL_RTC_STATE);
  useEffect(() => {
    if (!engine) { setState(INITIAL_RTC_STATE); return undefined; }
    setState(engine.getState());
    return engine.onState(setState);
  }, [engine]);
  return state;
}
