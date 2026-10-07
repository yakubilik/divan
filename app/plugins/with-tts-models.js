// EMA's three ONNX files into the app bundle, when they are there.
//
// They are ~35 MB, rebuilt by tts/export.py and never committed; `npm run
// tts:models` copies them into assets/tts/. Whatever is in that folder at
// prebuild is added to the Xcode project as a bundle resource, at the bundle's
// root (src/ema.ts reads `Paths.bundle/ema-<stage>.onnx`). A prebuild without
// them adds nothing, the build does not fail, and the app reads Turkish with
// the system voice. Adding the same file twice is skipped, so a second prebuild
// is harmless.
const fs = require('fs');
const path = require('path');
const { withXcodeProject, IOSConfig } = require('expo/config-plugins');

const FILES = ['ema-text.onnx', 'ema-sound.onnx', 'ema-decoder.onnx'];

module.exports = function withTtsModels(config) {
  return withXcodeProject(config, (cfg) => {
    const dir = path.join(cfg.modRequest.projectRoot, 'assets', 'tts');
    const present = FILES.filter((f) => fs.existsSync(path.join(dir, f)));
    if (present.length !== FILES.length) {
      if (present.length) console.warn(`with-tts-models: only ${present.join(', ')} in assets/tts; EMA needs all three, adding none`);
      return cfg;
    }
    const project = cfg.modResults;
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, 'Resources');
    for (const f of present) {
      const filepath = path.relative(cfg.modRequest.platformProjectRoot, path.join(dir, f));
      IOSConfig.XcodeUtils.addResourceFileToGroup({ filepath, groupName: 'Resources', project, isBuildFile: true });
    }
    // An extension Xcode does not know is typed `unknown`; `file` is plainly copied.
    const refs = project.pbxFileReferenceSection();
    for (const key of Object.keys(refs)) {
      const ref = refs[key];
      if (ref && typeof ref === 'object' && FILES.some((f) => String(ref.path || '').replace(/"/g, '').endsWith(f))) {
        ref.lastKnownFileType = 'file';
        for (const k of Object.keys(ref)) if (ref[k] === undefined) delete ref[k];
      }
    }
    return cfg;
  });
};
