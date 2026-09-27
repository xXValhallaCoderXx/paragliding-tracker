import Svg, { Circle, Path } from 'react-native-svg';
import { paper } from '@/ui/theme';

export function FeedIcon({ name, selected = false }: { name: 'search' | 'heart'; selected?: boolean }) {
  return <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false} pointerEvents="none"
    fill="none" stroke={selected ? paper.thermal : paper.ink} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {name === 'search' ? <><Circle cx={10.5} cy={10.5} r={6.5} /><Path d="m16 16 5 5" /></>
      : <Path d="M12 20 4.5 13a4.7 4.7 0 0 1 7.5-5.5 4.7 4.7 0 0 1 7.5 5.5Z" fill={selected ? paper.thermal : 'none'} />}
  </Svg>;
}
