import test from 'node:test';
import assert from 'node:assert/strict';
import { PageHistory, capturePageStructure } from '../page-history.mjs';

test('undo restores deleted pages, split names, and selection without sharing arrays', () => {
  const state = { pageOrder: [2, 0, 1], splitPoints: [1], splitNames: ['Cover', 'Body'], curPage: 3 };
  const history = new PageHistory();
  const before = capturePageStructure(state);
  state.pageOrder.pop();
  state.curPage = 2;
  history.record(before, state);
  before.splitNames[0] = 'Changed later';
  assert.deepEqual(history.undo(), { pageOrder: [2, 0, 1], splitPoints: [1], splitNames: ['Cover', 'Body'], curPage: 3 });
  assert.equal(history.canUndo, false);
});

test('no-op movement does not consume undo and history is bounded and resettable', () => {
  const history = new PageHistory(2);
  const state = { pageOrder: [0, 1, 2], splitPoints: [], splitNames: [], curPage: 1 };
  history.record(state, { ...state, curPage: 2 });
  assert.equal(history.canUndo, false);
  for (const next of [[1, 0, 2], [2, 1, 0], [0, 2, 1]]) {
    const before = capturePageStructure(state);
    state.pageOrder = next;
    history.record(before, state);
  }
  assert.deepEqual(history.undo().pageOrder, [2, 1, 0]);
  assert.deepEqual(history.undo().pageOrder, [1, 0, 2]);
  assert.equal(history.undo(), null);
  history.record(state, { ...state, pageOrder: [] });
  history.clear();
  assert.equal(history.canUndo, false);
});
