const fs = require('fs');
const path = require('path');
const withCallkeep = require('@config-plugins/react-native-callkeep').default
  ?? require('@config-plugins/react-native-callkeep');
const {
  AndroidConfig,
  IOSConfig,
  withAndroidManifest,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('expo/config-plugins');

/**
 * Native incoming-call ringing for 1:1 DM calls (lib/calls/native/).
 *
 * Wraps `@config-plugins/react-native-callkeep` (applied from here, so it is
 * the only app.json entry needed), which adds CallKit.framework, the
 * RNCallKeep header search path, the `voip` background mode and Android's
 * VoiceConnectionService. On top of that this plugin adds:
 *
 * iOS
 *  1. UIBackgroundModes: voip, audio, remote-notification.
 *  2. PushKit.framework.
 *  3. Bridging-header imports for RNCallKeep + RNVoipPushNotificationManager
 *     so AppDelegate.swift can call them.
 *  4. AppDelegate.swift: registers PushKit at launch and, in
 *     pushRegistry(_:didReceiveIncomingPushWith:for:completion:), reports
 *     the call to CallKit IMMEDIATELY — before JS runs — as Apple requires
 *     for every VoIP push on iOS 13+ (otherwise the app is killed and
 *     PushKit delivery is throttled). The payload keys are the ones
 *     api-server/src/lib/voipPush.ts sends (type, callId, callerName,
 *     hasVideo). A `dm_call_ended` push (caller hung up / answered on
 *     another device / missed / blocked) still has to be reported, so it is
 *     reported and ended in the same breath, which dismisses a ring that is
 *     showing and is invisible otherwise. A push whose calleeId isn't the
 *     account signed in on this phone (NSUserDefaults bt.callUserId) is
 *     reported as "Brandthread" and ended at once.
 *
 * Android
 *  5. Permissions for a self-managed ConnectionService call that rings from
 *     a high-priority FCM data message: MANAGE_OWN_CALLS,
 *     FOREGROUND_SERVICE_PHONE_CALL, FOREGROUND_SERVICE_MICROPHONE,
 *     USE_FULL_SCREEN_INTENT, POST_NOTIFICATIONS, READ_PHONE_STATE.
 *  6. VoiceConnectionService label → the app name (callkeep's plugin ships
 *     "Wazo").
 *
 * Inert in Expo Go / web (no native build). Needs an EAS development or
 * release build; see the PR notes for the Apple / Firebase setup.
 */

const IOS_BACKGROUND_MODES = ['voip', 'audio', 'remote-notification'];
const ANDROID_PERMISSIONS = [
  'android.permission.MANAGE_OWN_CALLS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.READ_PHONE_STATE',
];

const MARK = '// brandthread:voip-callkit';

function withBackgroundModes(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = Array.isArray(cfg.modResults.UIBackgroundModes) ? cfg.modResults.UIBackgroundModes : [];
    for (const mode of IOS_BACKGROUND_MODES) if (!modes.includes(mode)) modes.push(mode);
    cfg.modResults.UIBackgroundModes = modes;
    return cfg;
  });
}

function withPushKitFramework(config) {
  return withXcodeProject(config, (cfg) => {
    const target = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project: cfg.modResults,
      projectName: cfg.modRequest.projectName,
    });
    cfg.modResults.addFramework('PushKit.framework', { target: target.uuid });
    return cfg;
  });
}

const BRIDGING_IMPORTS = [
  '#import <RNCallKeep/RNCallKeep.h>',
  '#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>',
];

function withBridgingHeader(config) {
  return withDangerousMod(config, ['ios', async (cfg) => {
    const projectName = cfg.modRequest.projectName;
    const iosRoot = cfg.modRequest.platformProjectRoot;
    const candidates = [
      path.join(iosRoot, projectName, `${projectName}-Bridging-Header.h`),
      ...fs.existsSync(path.join(iosRoot, projectName))
        ? fs.readdirSync(path.join(iosRoot, projectName))
          .filter((f) => f.endsWith('-Bridging-Header.h'))
          .map((f) => path.join(iosRoot, projectName, f))
        : [],
    ];
    const header = candidates.find((p) => fs.existsSync(p));
    if (!header) {
      throw new Error('[with-voip-callkit] No Swift bridging header found; native call ringing needs it.');
    }
    let contents = fs.readFileSync(header, 'utf8');
    for (const line of BRIDGING_IMPORTS) {
      if (!contents.includes(line)) contents = `${contents.trimEnd()}\n${line}\n`;
    }
    fs.writeFileSync(header, contents);
    return cfg;
  }]);
}

const SWIFT_EXTENSION = `
${MARK}
// PushKit → CallKit. Apple requires every VoIP push to be reported to
// CallKit before this method returns (iOS 13+), so it happens here, natively,
// even when the app was killed and JS isn't running yet. JS picks the call up
// through react-native-callkeep / react-native-voip-push-notification events
// (artifacts/mobile/lib/calls/native/nativeCallKit.ios.ts).
extension AppDelegate: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {}

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let data = payload.dictionaryPayload
    let callId = (data["callId"] as? String) ?? UUID().uuidString.lowercased()
    let ended = (data["type"] as? String) == "dm_call_ended"

    // Only ring for the account signed in on this phone right now
    // (lib/calls/native/callIdentity.ts writes bt.callUserId; nativeRingDecision
    // is the JS twin). Signed out or another account: Apple still requires
    // the push to be reported to CallKit, so report it under a generic name
    // and end it immediately, without the caller's details or JS.
    let signedInUserId = UserDefaults.standard.string(forKey: "bt.callUserId") ?? ""
    let pushCalleeId = (data["calleeId"] as? String) ?? ""
    let forThisAccount = !signedInUserId.isEmpty && (pushCalleeId.isEmpty || pushCalleeId == signedInUserId)
    if !forThisAccount {
      RNCallKeep.reportNewIncomingCall(
        callId,
        handle: "Brandthread",
        handleType: "generic",
        hasVideo: false,
        localizedCallerName: "Brandthread",
        supportsHolding: false,
        supportsDTMF: false,
        supportsGrouping: false,
        supportsUngrouping: false,
        fromPushKit: true,
        payload: nil,
        withCompletionHandler: completion
      )
      RNCallKeep.endCall(withUUID: callId, reason: 1)
      return
    }

    let callerName = (data["callerName"] as? String) ?? "Brandthread"
    let hasVideo = (data["hasVideo"] as? Bool) ?? false

    // CallKeep calls completion() once CallKit has the call; JS never does.
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)
    RNCallKeep.reportNewIncomingCall(
      callId,
      handle: callerName,
      handleType: "generic",
      hasVideo: hasVideo,
      localizedCallerName: callerName,
      supportsHolding: false,
      supportsDTMF: false,
      supportsGrouping: false,
      supportsUngrouping: false,
      fromPushKit: true,
      payload: data,
      withCompletionHandler: completion
    )
    if ended {
      // 4 = answered elsewhere, 2 = remote ended (see RNCallKeep endCallWithUUID).
      let reason: Int32 = (data["reason"] as? String) == "answered_elsewhere" ? 4 : 2
      RNCallKeep.endCall(withUUID: callId, reason: reason)
    }
  }
}
`;

function withPushKitAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('[with-voip-callkit] Expected a Swift AppDelegate (Expo SDK 57).');
    }
    let src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;
    if (!/^import PushKit$/m.test(src)) {
      src = src.replace(/^(import React\s*$)/m, '$1\nimport PushKit');
    }
    // Register for VoIP pushes as early as possible (before JS).
    src = src.replace(
      /(\n\s*)return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/,
      '$1RNVoipPushNotificationManager.voipRegistration() ' + MARK + '$1return super.application(application, didFinishLaunchingWithOptions: launchOptions)',
    );
    if (!src.includes('RNVoipPushNotificationManager.voipRegistration()')) {
      throw new Error('[with-voip-callkit] Could not find didFinishLaunching in AppDelegate.swift.');
    }
    src = `${src.trimEnd()}\n${SWIFT_EXTENSION}`;
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withAndroidCallPermissions(config) {
  return AndroidConfig.Permissions.withPermissions(config, ANDROID_PERMISSIONS);
}

function withConnectionServiceLabel(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const service = (app.service ?? []).find((s) => s.$['android:name'] === 'io.wazo.callkeep.VoiceConnectionService');
    if (service) {
      service.$['android:label'] = '@string/app_name';
      // Self-managed calls run as a phone-call foreground service (Android 14+ requires the type).
      service.$['android:foregroundServiceType'] = 'phoneCall|microphone';
    }
    return cfg;
  });
}

module.exports = function withVoipCallKit(config) {
  // Mods added later run first (@expo/config-plugins withMod → nextMod), so
  // the label patch is added BEFORE callkeep's plugin: callkeep inserts the
  // service, then the patch below sees it.
  config = withConnectionServiceLabel(config);
  config = withCallkeep(config);
  config = withBackgroundModes(config);
  config = withPushKitFramework(config);
  config = withBridgingHeader(config);
  config = withPushKitAppDelegate(config);
  config = withAndroidCallPermissions(config);
  return config;
};

module.exports.SWIFT_EXTENSION = SWIFT_EXTENSION;
module.exports.MARK = MARK;
