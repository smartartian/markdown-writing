export {
  SelectionInvariantError,
  assertSelectionInvariant,
  clampPosition,
  collapsedSelection,
  comparePositions,
  createPosition,
  createSelection,
  isCollapsed,
  mapSelectionThroughTransaction,
  normalizeSelection,
  selectionDirection,
} from './model.js';
export {
  applyModelSelection,
  domPositionToModel,
  domSelectionToModel,
  modelPositionToDom,
  modelSelectionToDom,
} from './dom-mapping.js';
export {
  inlinePositionToTextOffset,
  nodeTextLength,
  textOffsetToInlinePosition,
} from './inline-path.js';
