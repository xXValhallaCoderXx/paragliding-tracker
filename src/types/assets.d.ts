// Font files are imported directly from @expo-google-fonts packages so Metro
// bundles only the weights the app uses (the package index requires every
// weight). Metro resolves them to asset ids.
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
