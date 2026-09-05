import type { RefObject } from 'react';
import { Image, Text, View, type TextStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { fonts, paper } from '@/ui/theme';
import { POSTCARD_ART } from './assets';
import { postcardPresentation, type PostcardDraft, type PostcardSource } from './presentation';

/** This mounted view is both the preview and the export. All positions use the same scale. */
export function PostcardCard({ source, draft, width, captureView, onLayout, onImageLoad, onImageError }: {
  source: PostcardSource; draft: PostcardDraft; width: number; captureView: RefObject<View | null>;
  onLayout: () => void; onImageLoad: () => void; onImageError: () => void;
}) {
  const model = postcardPresentation(source, draft);
  const story = draft.format === 'story';
  const scale = width / 360;
  const box = (x: number, y: number, w: number, h: number) => ({
    position: 'absolute' as const, left: x * scale, top: y * scale, width: w * scale, height: h * scale,
  });
  const text = (size: number, line: number, extra?: TextStyle): TextStyle => ({
    fontFamily: fonts.sans, color: paper.ink, fontSize: size * scale, lineHeight: line * scale,
    includeFontPadding: false, ...extra,
  });
  const routeY = story ? 350 : 200;
  return (
    <View ref={captureView} collapsable={false} onLayout={onLayout} testID="postcard-capture"
      style={{ width, height: (story ? 640 : 360) * scale, backgroundColor: paper.background, overflow: 'hidden' }}>
      <View style={[box(16, story ? 20 : 12, 328, 18), { borderBottomWidth: scale, borderColor: paper.border }]}>
        <Text allowFontScaling={false} style={text(8, 11, { fontFamily: fonts.mono, color: paper.thermal })}>{model.date.toUpperCase()}</Text>
      </View>
      <Text allowFontScaling={false} numberOfLines={2} ellipsizeMode="tail"
        style={[box(16, story ? 52 : 34, 328, story ? 64 : 44), text(story ? 28 : 21, story ? 31 : 22, { fontFamily: fonts.sansBold })]}>{model.title}</Text>
      {model.site ? <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail"
        style={[box(16, story ? 123 : 80, 328, 15), text(10, 14)]}>{model.site}</Text> : null}
      <Image key={draft.scene} source={POSTCARD_ART[draft.scene]} resizeMode="cover" accessible={false}
        onLoad={onImageLoad} onError={onImageError}
        style={[box(16, story ? 148 : 100, 328, story ? 185 : 90), { borderRadius: 10 * scale }]} />
      <View style={[box(16, routeY, model.view.width, model.view.height + 12), { backgroundColor: paper.card, borderRadius: 8 * scale }]}>
        {model.route === 'unavailable' ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: 8 * scale }}>
            <Text allowFontScaling={false} style={text(10, 14, { textAlign: 'center' })}>Route unavailable</Text>
            <Text allowFontScaling={false} style={text(7, 11, { textAlign: 'center', color: paper.muted })}>No usable GPS route</Text>
          </View>
        ) : (
          <>
            <Svg width="100%" height={model.view.height * scale} viewBox={`0 0 ${model.view.width} ${model.view.height}`}>
              {model.route === 'track' ? <Path d={model.path} fill="none" stroke={paper.thermal} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" /> : null}
              {model.first ? <Circle cx={model.first.x} cy={model.first.y} r={3} fill={paper.ink} /> : null}
              {model.route === 'track' && model.last ? <Circle cx={model.last.x} cy={model.last.y} r={3} fill={paper.card} stroke={paper.thermal} strokeWidth={1.5} /> : null}
            </Svg>
            <Text allowFontScaling={false} style={text(6.5, 10, { textAlign: 'center', fontFamily: fonts.mono })}>
              {model.route === 'point' ? 'RECORDED POSITION ONLY' : 'RECORDED ROUTE'}
            </Text>
          </>
        )}
      </View>
      {[
        ['AIRTIME', model.airtime], ['TRACK DISTANCE', model.distance], ['MAX GPS ALTITUDE', model.altitude],
      ].map(([label, value], index) => (
        <View key={label} style={story ? box(16 + index * 112, 500, 106, 42) : box(190, 198 + index * 24, 154, 24)}>
          <Text allowFontScaling={false} style={text(6.5, 10, { fontFamily: fonts.mono, color: paper.muted })}>{label}</Text>
          <Text allowFontScaling={false} numberOfLines={1} style={text(story ? 15 : 12, story ? 20 : 14, { fontFamily: fonts.sansBold })}>{value}</Text>
        </View>
      ))}
      <Text allowFontScaling={false} style={[box(16, story ? 539 : 270, 328, 11), text(7, 10, { fontFamily: fonts.mono, color: paper.thermal })]}>
        {model.labels.join(' · ')}{model.labels.length ? ' · Recorded portion only' : ''}
      </Text>
      <Text allowFontScaling={false} numberOfLines={3} ellipsizeMode="tail"
        style={[box(16, story ? 558 : 284, 328, 42), text(11, 14)]}>{model.caption}</Text>
      <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail"
        style={[box(16, story ? 603 : 326, 328, 12), text(8, 11)]}>{model.signature}</Text>
      <Text allowFontScaling={false} numberOfLines={1}
        style={[box(16, story ? 618 : 340, 328, 9), text(6, 8, { color: paper.muted })]}>{model.attribution}</Text>
      <Text allowFontScaling={false} style={[box(16, story ? 629 : 350, 328, 9), text(6, 8, { fontFamily: fonts.mono, letterSpacing: scale, textAlign: 'right' })]}>FLIGHT LOG ALPHA</Text>
    </View>
  );
}
