// Divan in the iOS share sheet (#333).
//
// Adds a Share Extension target to the Xcode project prebuild writes, so a
// `npx expo prebuild --clean` brings it back every time. The extension shows
// up as "Divan" for a web URL (Instagram, X, YouTube, Safari) or for text, and
// does one thing: opens the app on `divan://share?url=…` / `?text=…`
// (plugins/share-extension/ShareViewController.swift). The app decides the
// rest (src/share.ts).
//
// The target is `DivanShare` — the app's own target is already `Divan`, and
// Xcode names two targets apart — with the display name "Divan", which is the
// name the share sheet shows. Its bundle id is the app's plus `.share`, read
// from the resolved config, so identity.local.json's real id carries over and
// the main app's own id is left as it is. No App Group and no pods: a deep link
// is all it hands over, so `-allowProvisioningUpdates` signs it like the app.
const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;
const { withXcodeProject } = require('expo/config-plugins');

const NAME = 'DivanShare';
const SWIFT = 'ShareViewController.swift';
const INFO = `${NAME}-Info.plist`;

function extensionBundleId(appId) {
  return `${appId}.share`;
}

function infoPlist({ version, buildNumber }) {
  return {
    CFBundleDevelopmentRegion: '$(DEVELOPMENT_LANGUAGE)',
    CFBundleDisplayName: 'Divan',
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: '$(PRODUCT_NAME)',
    CFBundlePackageType: '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
    CFBundleShortVersionString: version,
    CFBundleVersion: buildNumber,
    NSExtension: {
      NSExtensionAttributes: {
        // A web link, or words (with a link somewhere in them — the app looks).
        NSExtensionActivationRule: {
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsText: true,
        },
      },
      NSExtensionPointIdentifier: 'com.apple.share-services',
      NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).ShareViewController',
    },
  };
}

/** The main app target's own value for a build setting, for the extension to match. */
function appSetting(project, key) {
  const main = project.getFirstTarget().firstTarget;
  const list = project.pbxXCConfigurationList()[main.buildConfigurationList];
  const configs = project.pbxXCBuildConfigurationSection();
  for (const c of list?.buildConfigurations ?? []) {
    const v = configs[c.value]?.buildSettings?.[key];
    if (v != null) return v;
  }
  return null;
}

function withShareExtension(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    if (project.pbxTargetByName(NAME)) return cfg;

    const appId = cfg.ios?.bundleIdentifier;
    if (!appId) throw new Error('with-share-extension: ios.bundleIdentifier is not set');
    const version = cfg.version ?? '1.0.0';
    const buildNumber = String(cfg.ios?.buildNumber ?? '1');

    // The files, beside the app's own folder in ios/.
    const dir = path.join(cfg.modRequest.platformProjectRoot, NAME);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'share-extension', SWIFT), path.join(dir, SWIFT));
    fs.writeFileSync(path.join(dir, INFO), plist.build(infoPlist({ version, buildNumber })));

    // The target, embedded in the app (`addTarget` adds the PlugIns copy phase
    // to the first target, which is the app) and built before it.
    const target = project.addTarget(NAME, 'app_extension', NAME, extensionBundleId(appId));
    const group = project.addPbxGroup([SWIFT, INFO], NAME, NAME);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    project.addBuildPhase([SWIFT], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    // `addTargetDependency` only writes into sections that are already there,
    // and the app's template has neither.
    for (const k of ['PBXTargetDependency', 'PBXContainerItemProxy']) project.hash.project.objects[k] ??= {};
    project.addTargetDependency(project.getFirstTarget().uuid, [target.uuid]);
    // `addTarget` calls the app's copy phase "Copy Files"; Xcode's own name says what it is for.
    const phases = project.hash.project.objects.PBXCopyFilesBuildPhase ?? {};
    for (const [k, p] of Object.entries(phases)) {
      if (typeof p !== 'object' || p.dstSubfolderSpec !== 13) continue;
      p.name = '"Embed Foundation Extensions"';
      phases[`${k}_comment`] = 'Embed Foundation Extensions';
      for (const ph of project.getFirstTarget().firstTarget.buildPhases) if (ph.value === k) ph.comment = 'Embed Foundation Extensions';
    }

    const settings = {
      CLANG_ENABLE_MODULES: 'YES',
      CODE_SIGN_STYLE: 'Automatic',
      CURRENT_PROJECT_VERSION: buildNumber,
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `"${NAME}/${INFO}"`,
      IPHONEOS_DEPLOYMENT_TARGET: appSetting(project, 'IPHONEOS_DEPLOYMENT_TARGET') ?? '15.1',
      MARKETING_VERSION: version,
      PRODUCT_BUNDLE_IDENTIFIER: `"${extensionBundleId(appId)}"`,
      PRODUCT_NAME: `"${NAME}"`,
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1"',
      ...(cfg.ios?.appleTeamId ? { DEVELOPMENT_TEAM: cfg.ios.appleTeamId } : {}),
    };
    const list = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    const configs = project.pbxXCBuildConfigurationSection();
    for (const c of list.buildConfigurations) Object.assign(configs[c.value].buildSettings, settings);
    return cfg;
  });
}

module.exports = withShareExtension;
module.exports.infoPlist = infoPlist;
module.exports.extensionBundleId = extensionBundleId;
module.exports.NAME = NAME;
