const {
  formatFailure,
  getIdentityErrors,
} = require('../scripts/verify-app-identity');

module.exports = function withVerifyAppIdentity(config) {
  const errors = getIdentityErrors(config);
  if (errors.length > 0) {
    throw new Error(formatFailure(errors));
  }
  return config;
};