// `audio` in UIBackgroundModes, guaranteed.
//
// app.json asks for ["voip", "audio", "remote-notification"] and `expo config`
// shows all three, but the built app carried only two: a plugin that manages
// background modes writes the key rather than appending to it, and whichever
// runs last wins. Without `audio` a call goes silent the moment the app leaves
// the foreground — which is most of a call.
//
// Registered FIRST on purpose: expo composes mods so the last one registered
// runs first and delegates inward, which means the first registered runs last
// and gets the final word. This adds what is missing without removing what
// they added.
const { withInfoPlist } = require('expo/config-plugins');

const REQUIRED = ['voip', 'audio', 'remote-notification'];

module.exports = function withCallBackgroundModes(config) {
  return withInfoPlist(config, (cfg) => {
    const have = cfg.modResults.UIBackgroundModes ?? [];
    cfg.modResults.UIBackgroundModes = [...new Set([...have, ...REQUIRED])];
    return cfg;
  });
};
