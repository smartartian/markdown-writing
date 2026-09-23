export function syncDirtyState(state) {
  state.isDirty = (state.currentContent ?? '') !== (state.persistedContent ?? '');
  return state.isDirty;
}
