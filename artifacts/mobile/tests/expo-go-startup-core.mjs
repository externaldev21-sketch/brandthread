export const STARTUP_FAILURE_PATTERNS = [
  /Unable to resolve module/i,
  /Cannot find native module/i,
  /Invariant Violation.*TurboModule/i,
  /Native module cannot be null/i,
  /No component found for view with name/i,
  /ReactNativeJS.*(?:FATAL|Unhandled|TypeError|ReferenceError)/i,
  /FATAL EXCEPTION.*(?:host\.exp\.Exponent|host\.exp\.exponent)/is,
];

export function startupFailure(logs) {
  return STARTUP_FAILURE_PATTERNS.find((pattern) => pattern.test(logs));
}

export function metroBundleStatus(logs, platform) {
  const failure = startupFailure(logs);
  if (failure) return { ready: false, failure };
  const platformName = platform === 'ios' ? 'iOS' : 'Android';
  return {
    ready: new RegExp(`(?:^|\\n)${platformName}\\s+Bundled\\s+\\d+ms\\s+`, 'i').test(logs),
    failure: null,
  };
}

export function currentLogBytes(logFile, startOffset) {
  return logFile.subarray(Math.min(startOffset, logFile.length)).toString('utf8');
}