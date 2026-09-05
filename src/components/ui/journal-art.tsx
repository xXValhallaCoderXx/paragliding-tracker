import { Image, StyleSheet, View } from 'react-native';

import { paper } from '@/ui/theme';

const ART = {
  flight: require('../../../assets/images/journal/flight.png'),
  launch: require('../../../assets/images/journal/launch.png'),
  landing: require('../../../assets/images/journal/landing.png'),
};

/** Decorative only. Actual GPS plots always have their own plain, legible surface. */
export function JournalArt({ scene, height = 180 }: { scene: keyof typeof ART; height?: number }) {
  return (
    <View style={[styles.frame, { height }]} importantForAccessibility="no-hide-descendants">
      <Image source={ART[scene]} resizeMode="cover" accessible={false} style={styles.image} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderRadius: 22, backgroundColor: paper.cardAlt, width: '100%' },
  image: { width: '100%', height: '100%' },
});
