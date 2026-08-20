import { decodeTrackSegments, encodeTrackSegments } from '../encoding';

describe('encodeTrackSegments', () => {
  it('round trips', () => {
    const segments = [[46.5295, 11.5994, 46.53, 11.6], [46.6, 11.7]];
    expect(decodeTrackSegments(encodeTrackSegments(segments))).toEqual(segments);
  });

  it('stays well inside a sensible row size at the point ceiling', () => {
    const segments = [
      Array.from({ length: 512 }, (_, index) => 46.5 + index / 100_000),
    ];
    expect(encodeTrackSegments(segments).length).toBeLessThan(8_192);
  });
});

describe('decodeTrackSegments', () => {
  it('treats absence as an empty track rather than an error', () => {
    expect(decodeTrackSegments(null)).toEqual([]);
    expect(decodeTrackSegments(undefined)).toEqual([]);
    expect(decodeTrackSegments('')).toEqual([]);
    expect(decodeTrackSegments('[]')).toEqual([]);
  });

  it('never throws on a corrupt column', () => {
    // Read on every logbook render for every flight, so one bad row must cost one missing
    // thumbnail rather than a screen that cannot mount.
    expect(decodeTrackSegments('{')).toEqual([]);
    expect(decodeTrackSegments('not json')).toEqual([]);
    expect(decodeTrackSegments('{"a":1}')).toEqual([]);
    expect(decodeTrackSegments('[1,2,3]')).toEqual([]);
    expect(decodeTrackSegments('[["a","b"]]')).toEqual([]);
    expect(decodeTrackSegments('[[null,null]]')).toEqual([]);
  });

  it('rejects a segment whose coordinates lost their pairing', () => {
    // There is no way to tell which half of the pair survived, and guessing would draw the
    // track somewhere it never went.
    expect(decodeTrackSegments('[[46.5,11.5,46.6]]')).toEqual([]);
  });

  it('drops empty segments without discarding the track', () => {
    expect(decodeTrackSegments('[[],[46.5,11.5]]')).toEqual([[46.5, 11.5]]);
  });
});
