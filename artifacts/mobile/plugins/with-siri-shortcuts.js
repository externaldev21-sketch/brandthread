const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject, IOSConfig } = require('expo/config-plugins');

/**
 * Adds the "Sales today" App Shortcut (Siri, Shortcuts, Spotlight) to the
 * iOS app: copies ios-extensions/SiriShortcuts/SalesTodayIntent.swift into
 * the generated app folder and compiles it into the MAIN app target. App
 * Intents have to live in the app target (not a pod) for Xcode to extract
 * their metadata. No extension, no new capability, no entitlement.
 */

const FILE = 'SalesTodayIntent.swift';
const SOURCE = path.join(__dirname, '..', 'ios-extensions', 'SiriShortcuts', FILE);

function withSiriShortcutsFile(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const appDir = path.join(cfg.modRequest.platformProjectRoot, cfg.modRequest.projectName);
      fs.copyFileSync(SOURCE, path.join(appDir, FILE));
      return cfg;
    },
  ]);
}

function withSiriShortcutsSource(config) {
  return withXcodeProject(config, (cfg) => {
    const projectName = cfg.modRequest.projectName;
    const filepath = `${projectName}/${FILE}`;
    if (!cfg.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: cfg.modResults,
      });
    }
    return cfg;
  });
}

module.exports = function withSiriShortcuts(config) {
  config = withSiriShortcutsFile(config);
  config = withSiriShortcutsSource(config);
  return config;
};
