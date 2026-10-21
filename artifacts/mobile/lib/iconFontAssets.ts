/**
 * Only families used by this app. Static requires let Expo package the existing
 * assets locally in native builds and emit same-origin, hashed web assets.
 * Do not import the icon components/glyph maps just to load their fonts.
 */
export const ICON_FONT_ASSETS: Readonly<Record<string, number>> = {
  feather: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf'),
  material: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf'),
  ionicons: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'),
  'material-community': require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'),
  FontAwesome: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/FontAwesome.ttf'),
  'FontAwesome6Brands-Regular': require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/FontAwesome6_Brands.ttf'),
};
