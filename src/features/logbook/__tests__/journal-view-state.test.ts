/** @jest-environment node
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import { configureStore } from '@reduxjs/toolkit';
import { defaultJournalCriteria } from '../journal-query';
import { applyJournalCriteria, journalAuthChanged, journalOwnerChanged, journalViewReducer } from '@/store/journal-view';

const createStore = () => configureStore({ reducer: journalViewReducer });
const filtered = () => ({ ...defaultJournalCriteria(), sites: ['site:hill'], sort: 'distance' as const });

it('keeps navigation preferences only in this store and starts a fresh launch with defaults', () => {
  const store = createStore();
  store.dispatch(applyJournalCriteria({ criteria: filtered(), revision: 0 }));
  store.dispatch({ type: 'navigation/changed' });
  expect(store.getState().criteria).toEqual(filtered());
  expect(createStore().getState().criteria).toEqual(defaultJournalCriteria());
});

it('resets on identity changes, preserves same-user refresh, and rejects stale sheet actions', () => {
  const store = createStore();
  store.dispatch(journalAuthChanged('qa-a'));
  const revision = store.getState().revision;
  store.dispatch(applyJournalCriteria({ criteria: filtered(), revision }));
  store.dispatch(journalAuthChanged('qa-a'));
  expect(store.getState().criteria).toEqual(filtered());
  store.dispatch(journalAuthChanged(null));
  store.dispatch(applyJournalCriteria({ criteria: filtered(), revision }));
  expect(store.getState().criteria).toEqual(defaultJournalCriteria());
  store.dispatch(journalAuthChanged('qa-b'));
  expect(store.getState().revision).toBe(revision + 2);
});

it('resets and fences drafts when archive ownership changes without an auth change', () => {
  const store = createStore();
  store.dispatch(applyJournalCriteria({ criteria: filtered(), revision: 0 }));
  store.dispatch(journalOwnerChanged());
  store.dispatch(applyJournalCriteria({ criteria: filtered(), revision: 0 }));
  expect(store.getState().criteria).toEqual(defaultJournalCriteria());
  expect(store.getState().revision).toBe(1);
});
