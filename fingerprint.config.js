/**
 * The runtime version is a fingerprint of the native layer, computed both here
 * (`eas update`) and on the EAS builder. Anything that exists in only one of
 * those places makes them disagree, and updates published from this machine
 * would never apply to the build. Each entry is generated, not source:
 *
 * - ios/, android/: continuous native generation. EAS prebuilds them before
 *   fingerprinting; locally they don't exist. Their inputs (app config,
 *   plugins, native modules) are already part of the fingerprint.
 * - react-native-audio-api downloads prebuilt binaries into its own package
 *   directory during `pod install`, which runs on EAS and not here. They are
 *   pinned by the package version, which is already hashed.
 *
 * And two inputs skipped outright, because neither reaches the native build:
 *
 * - package.json `scripts`: the default only skips the ios/android ones, so
 *   removing a probe script (PR #37) changed the runtime version and stranded
 *   every OTA update published after it. Scripts here come and go with probes.
 * - .gitignore: hashed by default, and edited for reasons that have nothing to
 *   do with native code.
 */
const { SourceSkips } = require('expo/fingerprint');

/** @type {import('expo/fingerprint').Config} */
module.exports = {
  sourceSkips:
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun |
    SourceSkips.PackageJsonScriptsAll |
    SourceSkips.GitIgnore,
  ignorePaths: [
    'ios/**/*',
    'android/**/*',
    'node_modules/react-native-audio-api/common/cpp/audioapi/external/**/*',
    'node_modules/react-native-audio-api/android/src/main/jniLibs/**/*',
  ],
};
