// The public repo carries no account-scoped identifiers: bundle id, team, owner
// and EAS project id are kept out of app.json.
//
// They are read from two places, in this order:
//
//   1. identity.local.json, uncommitted, for a build run on this machine.
//   2. DIVAN_* environment variables, for a build run on EAS — where the file
//      cannot follow, because .gitignore keeps it out of the uploaded archive
//      and a build with the placeholder bundle id fails signing against a
//      provisioning profile for the real one. Set them once with
//      `eas env:create` and they live on the project, not in the repository.
//
// With neither, this is plain app.json and the app is unsigned but buildable.
const fs = require('fs');
const path = require('path');

function identity() {
  const local = path.join(__dirname, 'identity.local.json');
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, 'utf8'));
  const env = {
    bundleIdentifier: process.env.DIVAN_BUNDLE_ID,
    appleTeamId: process.env.DIVAN_APPLE_TEAM_ID,
    owner: process.env.DIVAN_OWNER,
    easProjectId: process.env.DIVAN_EAS_PROJECT_ID,
  };
  return Object.values(env).some(Boolean) ? env : null;
}

module.exports = ({ config }) => {
  const id = identity();
  if (!id) return config;

  return {
    ...config,
    owner: id.owner ?? config.owner,
    ios: {
      ...config.ios,
      bundleIdentifier: id.bundleIdentifier ?? config.ios.bundleIdentifier,
      appleTeamId: id.appleTeamId ?? config.ios.appleTeamId,
    },
    extra: {
      ...config.extra,
      eas: { ...(config.extra && config.extra.eas), projectId: id.easProjectId },
    },
  };
};
