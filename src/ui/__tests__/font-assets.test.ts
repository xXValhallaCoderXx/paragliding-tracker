import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLoaded, loadAsync } from 'expo-font';
import { FONT_ASSETS } from '../font-assets';
import { fonts, paper } from '../theme';
import { loadPostcardFonts } from '@/features/postcard/assets';

jest.mock('expo-font', () => ({ isLoaded: jest.fn(), loadAsync: jest.fn() }));
it('bundles every theme family and shares the registry between startup and postcard preparation', async () => {
  expect(Object.keys(FONT_ASSETS).sort()).toEqual(Object.values(fonts).sort());
  expect(readFileSync(join(__dirname, '../../app/_layout.tsx'), 'utf8')).toContain('useFonts(FONT_ASSETS)');
  jest.mocked(isLoaded).mockImplementation(name => name === fonts.sans);
  await loadPostcardFonts();
  const { [fonts.sans]: _regular, ...missing } = FONT_ASSETS;
  expect(loadAsync).toHaveBeenCalledWith(missing);
});

function luminance(hex: string) {
  const values = [1, 3, 5].map(start => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
it.each([paper.background, paper.card, paper.sheet])('keeps muted helper text legible on %s', surface => {
  expect((luminance(surface) + 0.05) / (luminance(paper.muted) + 0.05)).toBeGreaterThanOrEqual(4.5);
});
