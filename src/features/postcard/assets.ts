import { isLoaded, loadAsync } from 'expo-font';

export const POSTCARD_ART = {
  flying: require('../../../assets/images/journal/flight.png'),
  launch: require('../../../assets/images/journal/launch.png'),
  landing: require('../../../assets/images/journal/landing.png'),
};
const FONT_ASSETS = {
  Archivo_400Regular: require('@expo-google-fonts/archivo/400Regular/Archivo_400Regular.ttf'),
  Archivo_700Bold: require('@expo-google-fonts/archivo/700Bold/Archivo_700Bold.ttf'),
  IBMPlexMono_400Regular: require('@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf'),
};
export async function loadPostcardFonts() {
  await loadAsync(Object.fromEntries(Object.entries(FONT_ASSETS).filter(([name]) => !isLoaded(name))));
}
