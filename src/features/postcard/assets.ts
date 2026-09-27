import { FONT_ASSETS } from '@/ui/font-assets';
import { isLoaded, loadAsync } from 'expo-font';

export const POSTCARD_ART = {
  flying: require('../../../assets/images/journal/flight.png'),
  launch: require('../../../assets/images/journal/launch.png'),
  landing: require('../../../assets/images/journal/landing.png'),
};
export async function loadPostcardFonts() {
  await loadAsync(Object.fromEntries(Object.entries(FONT_ASSETS).filter(([name]) => !isLoaded(name))));
}
