// Keep app.json authoritative for native builds and normal web publishing.
// Only the explicitly requested, workspace-only static preview has a URL prefix.
module.exports = ({ config }) => process.env.BRANDTHREAD_STATIC_PREVIEW === '1'
  ? { ...config, experiments: { ...config.experiments, baseUrl: '/fast-preview' } }
  : config;
