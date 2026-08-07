const { withNxMetro } = require('@nx/expo');
// Expo SDK 55+ ships Metro via `@expo/metro`, so both helpers must come from
// the Expo-provided instance.
const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('@expo/metro/metro-config');

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/** @type {import('metro-config').MetroConfig} */
const customConfig = {
  cacheVersion: 'scanner',
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...sourceExts, 'cjs', 'mjs', 'svg'],
  },
};

module.exports = withNxMetro(mergeConfig(defaultConfig, customConfig), {
  debug: false,
  extensions: [],
  watchFolders: [],
});
