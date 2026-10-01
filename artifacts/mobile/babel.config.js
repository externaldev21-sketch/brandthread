module.exports = function (api) {
  // Metro passes { platform, isDev } as the babel caller. Stripping console.*
  // only happens for a production (non-dev) NATIVE bundle; dev and the web
  // preview/export keep their logs. warn/error are always kept so Sentry
  // breadcrumbs and real diagnostics survive. See lib/buildFlags.ts.
  const platform = api.caller((c) => (c && c.platform) || null);
  const isDev = api.caller((c) => (c ? c.isDev : undefined));
  const isProdNative =
    platform !== null &&
    platform !== 'web' &&
    (isDev === undefined ? process.env.NODE_ENV === 'production' : !isDev);

  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    plugins: isProdNative
      ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
      : [],
  };
};
