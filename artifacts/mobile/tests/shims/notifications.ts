// Only the native transport is replaced. Delivery/permission policy stays in
// app code, and tests that exercise permission states provide their own mocks.
export const getPermissionsAsync = async () => ({ granted: false, canAskAgain: true, status: 'undetermined' });
export const requestPermissionsAsync = async () => ({ granted: false, canAskAgain: true, status: 'undetermined' });
export const setNotificationHandler = () => {};
export const setNotificationChannelAsync = async () => {};
export const getExpoPushTokenAsync = async () => { throw new Error('Native push unavailable in Node'); };
export const getLastNotificationResponseAsync = async () => null;
export const clearLastNotificationResponseAsync = async () => {};
export const addNotificationReceivedListener = () => ({ remove() {} });
export const addNotificationResponseReceivedListener = () => ({ remove() {} });
export const AndroidImportance = { HIGH: 4, MAX: 5, DEFAULT: 3 };
