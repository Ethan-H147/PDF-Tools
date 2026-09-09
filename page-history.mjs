// SPDX-License-Identifier: AGPL-3.0-or-later

// Keep document structure only; rendered pages and PDF bytes stay out of history.
export function capturePageStructure(state) {
  return {
    pageOrder: state.pageOrder.slice(),
    splitPoints: state.splitPoints.slice(),
    splitNames: state.splitNames.slice(),
    curPage: state.curPage,
  };
}

export class PageHistory {
  constructor(limit = 50) {
    this.limit = limit;
    this.entries = [];
  }

  record(before, after) {
    const same = ['pageOrder', 'splitPoints', 'splitNames'].every(key =>
      before[key].length === after[key].length && before[key].every((value, index) => value === after[key][index]));
    if (same) return;
    this.entries.push(capturePageStructure(before));
    if (this.entries.length > this.limit) this.entries.shift();
  }

  get canUndo() { return this.entries.length > 0; }
  undo() { return this.entries.pop() || null; }
  clear() { this.entries.length = 0; }
}
