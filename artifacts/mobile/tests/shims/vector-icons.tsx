import React from 'react';
const icon = (name: string) => (props: any) => React.createElement(name, props);
export const Feather = icon('Feather'), Ionicons = icon('Ionicons'), MaterialIcons = icon('MaterialIcons');
export const MaterialCommunityIcons = icon('MaterialCommunityIcons'), FontAwesome = icon('FontAwesome');
export const FontAwesome5 = icon('FontAwesome5'), FontAwesome6 = icon('FontAwesome6'), AntDesign = icon('AntDesign');
export const Entypo = icon('Entypo'), Octicons = icon('Octicons'), SimpleLineIcons = icon('SimpleLineIcons');
export const Foundation = icon('Foundation'), EvilIcons = icon('EvilIcons'), Zocial = icon('Zocial');
