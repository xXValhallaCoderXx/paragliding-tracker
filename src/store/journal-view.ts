import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import { defaultJournalCriteria, type JournalCriteria } from '@/journal/criteria';

export interface JournalViewState {
  criteria: JournalCriteria;
  revision: number;
  authUserId: string | null;
}

/** Navigation-lifetime preferences only; never persisted alongside the journal. */
const initialState: JournalViewState = {
  criteria: defaultJournalCriteria(), revision: 0, authUserId: null,
};

const slice = createSlice({
  name: 'journalView',
  initialState,
  reducers: {
    applyJournalCriteria(state, action: PayloadAction<{ criteria: JournalCriteria; revision: number }>) {
      // A dismissed sheet must not restore another account's selections.
      if (action.payload.revision !== state.revision) return;
      state.criteria = action.payload.criteria;
    },
    journalAuthChanged(state, action: PayloadAction<string | null>) {
      if (state.authUserId === action.payload) return;
      state.authUserId = action.payload;
      state.criteria = defaultJournalCriteria();
      state.revision += 1;
    },
    journalOwnerChanged(state) {
      state.criteria = defaultJournalCriteria();
      state.revision += 1;
    },
  },
});

export const { applyJournalCriteria, journalAuthChanged, journalOwnerChanged } = slice.actions;
export const journalViewReducer = slice.reducer;
