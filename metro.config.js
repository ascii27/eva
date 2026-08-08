const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // react-native-audio-api's AudioControls component imports
  // react-native-gesture-handler without declaring the dependency. Eva never
  // renders AudioControls (we only use AudioContext/AudioManager for TTS
  // playback), so stub the module out rather than shipping an unused native
  // dependency in the dev build.
  if (moduleName === 'react-native-gesture-handler') {
    return { type: 'empty' };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
