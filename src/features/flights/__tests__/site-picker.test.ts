import { siteFieldHint, sitePickerView } from '../site-picker';
import type { SitePickerInput } from '../site-picker';

function view(overrides: Partial<SitePickerInput> = {}) {
  return sitePickerView({
    query: '',
    debouncedQuery: '',
    trigger: 'none',
    hasPosition: true,
    resultCount: 0,
    fetching: false,
    ...overrides,
  });
}

describe('sitePickerView opening', () => {
  it('stays shut on a flight that already has a site', () => {
    // The bug this exists for. The saved name went straight into the field, which fired a
    // search for that name and dropped a list of near-identical matches under a field the
    // pilot had already filled in — before they had touched anything.
    const shut = view({ query: 'Bukit Jugra', debouncedQuery: 'Bukit Jugra' });
    expect(shut.open).toBe(false);
    expect(shut.shouldSearch).toBe(false);
    expect(shut.shouldLookNearby).toBe(false);
  });

  it('opens on nearby launches when the pilot focuses an empty field', () => {
    const opened = view({ trigger: 'focus' });
    expect(opened.mode).toBe('nearby');
    expect(opened.title).toBe('Nearby launches');
    expect(opened.shouldLookNearby).toBe(true);
  });

  it('opens nothing over a name the pilot has not touched', () => {
    // Tapping a field that reads "Bukit Jugra" is far more likely to mean "let me edit this"
    // than "search for Bukit Jugra" — and searching would be the original annoyance with one
    // extra tap in front of it.
    const focused = view({ trigger: 'focus', query: 'Bukit Jugra', debouncedQuery: 'Bukit Jugra' });
    expect(focused.open).toBe(false);
    expect(focused.shouldSearch).toBe(false);
  });

  it('searches once they actually type', () => {
    const searching = view({ trigger: 'typing', query: 'Bukit', debouncedQuery: 'Bukit' });
    expect(searching.mode).toBe('search');
    expect(searching.shouldSearch).toBe(true);
    expect(searching.shouldLookNearby).toBe(false);
  });

  it('falls back to nearby when the field is cleared', () => {
    // Emptying the box asks the opposite question to typing in it.
    expect(view({ trigger: 'typing' }).mode).toBe('nearby');
  });

  it('closes once a suggestion is taken', () => {
    const taken = view({ trigger: 'none', query: 'Bukit Jugra', debouncedQuery: 'Bukit Jugra' });
    expect(taken.open).toBe(false);
    // And sends nothing: the pick set the field text, which is the very signal that used to
    // reopen the list and search for the name it had just inserted.
    expect(taken.shouldSearch).toBe(false);
  });

  it('shows nearby on request even when the field is full', () => {
    // The way back in after settling. Without this the request would be overruled by the
    // text already in the box and the link would do nothing.
    const asked = view({ trigger: 'nearby', query: 'Bukit Jugra', debouncedQuery: 'Bukit Jugra' });
    expect(asked.mode).toBe('nearby');
    expect(asked.shouldLookNearby).toBe(true);
  });

  it('offers a way back in whenever it is shut', () => {
    expect(view().reopen).toBe('nearby');
    // With nowhere to look around, the offer is to find a position rather than to open an
    // empty list.
    expect(view({ hasPosition: false }).reopen).toBe('locate');
    expect(view({ trigger: 'focus' }).reopen).toBeNull();
  });

  it('has nothing to open when there is no position and nothing typed', () => {
    expect(view({ trigger: 'focus', hasPosition: false }).open).toBe(false);
    expect(view({ trigger: 'nearby', hasPosition: false }).open).toBe(false);
  });
});

describe('sitePickerView contents', () => {
  it('reports busy while the debounce has not caught up', () => {
    // The list still holds results for the previous keystroke. Showing them invites a tap on
    // a place that has nothing to do with what is now in the field.
    const midType = view({
      trigger: 'typing',
      query: 'Bukit Ju',
      debouncedQuery: 'Bukit',
      resultCount: 3,
    });
    expect(midType.busy).toBe(true);
  });

  it('asks for more letters rather than searching on two', () => {
    const short = view({ trigger: 'typing', query: 'Bu', debouncedQuery: 'Bu' });
    expect(short.shouldSearch).toBe(false);
    expect(short.empty).toBe('Type at least 3 letters to search.');
  });

  it('never phrases an empty result as a failure', () => {
    // Coverage outside Europe is genuinely thin, and the field underneath is still a
    // perfectly good text box.
    const none = view({ trigger: 'typing', query: 'Bukit', debouncedQuery: 'Bukit' });
    expect(none.empty).toContain('Your own name works fine');
    expect(view({ trigger: 'focus' }).empty).toBe('No launches catalogued near here yet.');
  });

  it('says nothing at all while it is still looking', () => {
    expect(view({ trigger: 'focus', fetching: true }).empty).toBeNull();
  });

  it('says nothing when there are results to show', () => {
    expect(view({ trigger: 'focus', resultCount: 4 }).empty).toBeNull();
  });
});

describe('siteFieldHint', () => {
  it('credits the catalogue a name came from once the list has gone', () => {
    // The list vanishing is the whole point, so the hint is what confirms the pick landed —
    // and it carries the attribution the visible list used to.
    const shut = view({ query: 'Bukit Jugra', debouncedQuery: 'Bukit Jugra' });
    expect(siteFieldHint('paraglidingearth', shut)).toBe('From ParaglidingEarth (CC BY-SA 3.0)');
    expect(siteFieldHint('osm', shut)).toBe('From OpenStreetMap (ODbL)');
  });

  it('claims no source for a name the pilot typed themselves', () => {
    expect(siteFieldHint(null, view())).toBe('Pick a launch, or type any name.');
  });

  it('gets out of the way while the panel is open', () => {
    // The panel carries its own heading and its own attribution line.
    expect(siteFieldHint('osm', view({ trigger: 'focus' }))).toBeNull();
  });
});
