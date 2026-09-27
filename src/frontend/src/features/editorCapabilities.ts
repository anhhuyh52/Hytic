/** All editor capabilities are available in the local workspace. */
export type EditorFeature = string;
export const isFeatureAvailable = (_feature: string) => true;
export const featureUnavailableMessage = (_feature: string) => "";
