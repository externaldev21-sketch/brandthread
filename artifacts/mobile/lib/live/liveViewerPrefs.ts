/**
 * Live viewer display choices from the More sheet ("Show chat as captions",
 * "Pause video"). They belong to the viewer, not to one room, so they carry
 * over as the viewer swipes between rooms for the rest of the session.
 */
export type LiveViewerPrefs = { captions: boolean; dataSaver: boolean };

let prefs: LiveViewerPrefs = { captions: false, dataSaver: false };

export function getLiveViewerPrefs(): LiveViewerPrefs {
  return prefs;
}

export function setLiveViewerPrefs(patch: Partial<LiveViewerPrefs>): LiveViewerPrefs {
  prefs = { ...prefs, ...patch };
  return prefs;
}
