const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

/**
 * Makes Sentry's source map / debug symbol upload optional.
 *
 * The @sentry/react-native plugin adds upload steps to the iOS and Android
 * builds. Without credentials those steps fail and take the whole build down.
 * This guard skips the upload (and only the upload) unless SENTRY_AUTH_TOKEN,
 * SENTRY_ORG and SENTRY_PROJECT are all set in the build environment, so a
 * build without Sentry configured still succeeds and runs normally.
 *
 * The generated native code is identical on every machine; the decision is
 * made at build time from environment variables, so the runtime fingerprint
 * does not depend on whether Sentry is configured.
 */

const MARKER = '@generated brandthread-sentry-upload-guard';

const XCODE_ENV_SNIPPET = `
# ${MARKER}
# Upload source maps and dSYMs to Sentry only when credentials are present.
if [ -z "$SENTRY_AUTH_TOKEN" ] || [ -z "$SENTRY_ORG" ] || [ -z "$SENTRY_PROJECT" ]; then
  export SENTRY_DISABLE_AUTO_UPLOAD=true
fi
`;

const GRADLE_SNIPPET = `
// ${MARKER}
// Upload source maps to Sentry only when credentials are present.
if (project.ext.has("shouldSentryAutoUploadGeneral")) {
    project.ext.shouldSentryAutoUploadGeneral = { ->
        def present = { String name -> !(System.getenv(name) ?: "").trim().isEmpty() }
        return System.getenv("SENTRY_DISABLE_AUTO_UPLOAD") != "true" &&
            present("SENTRY_AUTH_TOKEN") && present("SENTRY_ORG") && present("SENTRY_PROJECT")
    }
}
`;

function appendOnce(contents, snippet) {
  return contents.includes(MARKER) ? contents : `${contents.replace(/\s*$/, '\n')}${snippet}`;
}

function withIosGuard(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const xcodeEnv = path.join(cfg.modRequest.platformProjectRoot, '.xcode.env');
      const current = fs.existsSync(xcodeEnv) ? fs.readFileSync(xcodeEnv, 'utf8') : '';
      fs.writeFileSync(xcodeEnv, appendOnce(current, XCODE_ENV_SNIPPET));
      return cfg;
    },
  ]);
}

function withAndroidGuard(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy') {
      cfg.modResults.contents = appendOnce(cfg.modResults.contents, GRADLE_SNIPPET);
    }
    return cfg;
  });
}

module.exports = function withSentryUploadGuard(config) {
  return withAndroidGuard(withIosGuard(config));
};

module.exports.MARKER = MARKER;
module.exports.XCODE_ENV_SNIPPET = XCODE_ENV_SNIPPET;
module.exports.GRADLE_SNIPPET = GRADLE_SNIPPET;
module.exports.appendOnce = appendOnce;
