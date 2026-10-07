import Constants from 'expo-constants';

/** Expo Go is the StoreClient execution environment, including preview clients where __DEV__ is false. */
export function isExpoGoRuntime(
  executionEnvironment: unknown = Constants.executionEnvironment,
  appOwnership: unknown = Constants.appOwnership,
): boolean {
  return executionEnvironment === 'storeClient' || appOwnership === 'expo';
}

export function isExpoGo(): boolean {
  return isExpoGoRuntime();
}