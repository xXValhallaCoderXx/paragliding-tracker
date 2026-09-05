import { emptyLogbookChips } from '../empty-logbook';

describe('emptyLogbookChips', () => {
  it('names the glider it will pre-fill', () => {
    expect(emptyLogbookChips({ gliderType: 'Advance Iota 3', locationReady: true })).toEqual([
      { key: 'glider', label: 'ADVANCE IOTA 3', tone: 'muted' },
      { key: 'site', label: 'CHOOSE YOUR LAUNCH', tone: 'muted' },
      { key: 'location', label: 'LOCATION OK', tone: 'good' },
    ]);
  });

  it('says nothing about a glider that has not been named', () => {
    // A chip reading "NO GLIDER" would turn a promise into a complaint, and the setup card
    // already covers it when it is owed.
    const chips = emptyLogbookChips({ gliderType: null, locationReady: true });
    expect(chips.map((chip) => chip.key)).toEqual(['site', 'location']);
  });

  it('treats whitespace as no glider at all', () => {
    expect(emptyLogbookChips({ gliderType: '   ', locationReady: true })).toHaveLength(2);
  });

  it('flags location rather than promising a track it cannot record', () => {
    const chips = emptyLogbookChips({ gliderType: null, locationReady: false });
    expect(chips.find((chip) => chip.key === 'location')).toEqual({
      key: 'location',
      label: 'LOCATION NEEDED',
      tone: 'warning',
    });
  });

  it('always promises the site, because that is the part pilots do not expect', () => {
    for (const locationReady of [true, false]) {
      const chips = emptyLogbookChips({ gliderType: null, locationReady });
      expect(chips.some((chip) => chip.key === 'site')).toBe(true);
    }
  });
});
