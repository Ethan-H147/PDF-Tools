  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // ── Tool registry: add a new entry here to add a new tool ──
  const FINE_ROTATION_EXPORT_DPI = { high: 600, ultra: 900 };
  const LARGE_PDF_SAFE_MODE_BYTES = 35 * 1024 * 1024;
  const LARGE_PDF_SAFE_MODE_PAGES = 80;
  const SAFE_FULL_PAGE_CACHE_LIMIT = (navigator.deviceMemory && navigator.deviceMemory >= 6) ? 4 : 3;
  const RASTER_PREVIEW_MAX_PIXELS = (navigator.deviceMemory && navigator.deviceMemory >= 6) ? 4200000 : 2200000;
  const RASTER_PREVIEW_KEY = 'preview-raster';
  const PREVIEW_META_KEY = 'preview-meta';

  const TOOLS = {
    preview: {
      lede: 'View a PDF cleanly with fast page navigation and zoom.',
      meta: 'Open a PDF for viewing<br/>Use page navigation<br/>Zoom without changing the file',
      downloadLabel: 'Preview Only',
      downloadSub: 'view and zoom without exporting',
      suffix: '',
    },
    organize: {
      lede: 'Reorder or remove pages before export.',
      meta: 'Drag pages to reorder<br/>Click × to remove a page<br/>Use Split to divide after a page<br/>Drag pages across split lines freely<br/>Click a split × to remove it<br/>Name and export each part separately<br/>Original PDF pages are preserved',
      downloadLabel: 'Export Organized PDF',
      downloadSub: 'preserve original page content',
      suffix: '_organized',
    },
    edit: {
      lede: 'Crop and rotate individual pages before export.',
      meta: 'Select one page at a time<br/>Drag the crop frame on the page<br/>Fine rotate with a low-sensitivity slider<br/>Use 90° rotate buttons for page turns',
      downloadLabel: 'Export Edited PDF',
      downloadSub: 'apply page crops and rotations',
      suffix: '_edited',
    },
    merge: {
      lede: 'Merge multiple PDFs into one organized document.',
      meta: 'Select any number of PDFs<br/>Reorder files before merging<br/>Merged output opens in Organize',
      downloadLabel: 'Merge PDFs',
      downloadSub: 'combine selected files into organize',
      suffix: '_merged',
    },
    threshold: {
      lede: 'Convert PDFs to black and white with threshold control.',
      meta: 'Black and white output<br/>Client-side only · no upload<br/>Threshold · 0 → 255',
      downloadLabel: 'Export PDF',
      downloadSub: 'render and download all pages',
      suffix: '_bw',
    },
    greyscale: {
      lede: 'Convert PDFs to grayscale with brightness and contrast.',
      meta: 'Grayscale output<br/>Client-side only · no upload<br/>Brightness &amp; contrast',
      downloadLabel: 'Export Grayscale PDF',
      downloadSub: 'render and download all pages',
      suffix: '_grey',
    },
  };

  let activeTool = 'preview';
  let processTool = 'threshold';

  const state = {
    pdfDoc: null, numPages: 0, curPage: 1,
    // threshold
    threshold: 128, invert: false,
    // greyscale
    brightness: 0, contrast: 100, greyInvert: false, sepia: false,
    // output
    resolution: '600',
    // cache
    pages: [], pageOrder: [], splitPoints: [], splitNames: [], fileName: '', fileSize: 0, pdfBytes: null,
    mergeFiles: [], pageEdits: [],
    fineRotationQuality: 'high',
    largePdfSafeMode: false,
    renderGeneration: 0,
    fullPageCacheOrder: [],
  };

  const pageRenderJobs = new Map();
  const thumbnailJobs = new Map();
  const thumbnailQueue = [];
  const thumbnailQueued = new Set();
  let thumbnailQueueRunning = false;
  let thumbnailObserver = null;

  const $ = id => document.getElementById(id);

  // element refs
  const dropZone      = $('dropZone');
  const dropGlyph     = $('dropGlyph');
  const dropLabel     = $('dropLabel');
  const dropSub       = $('dropSub');
  const fileInput     = $('fileInput');
  const fileCard      = $('fileCard');
  const fileNameEl    = $('fileName');
  const pageCountEl   = $('pageCount');
  const fileSizeEl    = $('fileSize');
  const fileStatusEl  = $('fileStatus');
  const errBox        = $('errBox');
  const threshSlider  = $('threshSlider');
  const threshNum     = $('threshNum');
  const threshPct     = $('threshPct');
  const threshHint    = $('threshHint');
  const threshNeedle  = $('threshNeedle');
  const histoCanvas   = $('histoCanvas');
  const invertToggle  = $('invertToggle');
  const brightSlider  = $('brightSlider');
  const brightNum     = $('brightNum');
  const brightTag     = $('brightTag');
  const contrastSlider= $('contrastSlider');
  const contrastNum   = $('contrastNum');
  const contrastTag   = $('contrastTag');
  const greyInvertToggle = $('greyInvertToggle');
  const sepiaToggle   = $('sepiaToggle');
  const prevBtn       = $('prevPage');
  const nextBtn       = $('nextPage');
  const curPageEl     = $('curPage');
  const totPageEl     = $('totPage');
  const downloadBtn   = $('downloadBtn');
  const downloadLabel = $('downloadLabel');
  const downloadSub   = $('downloadSub');
  const resolutionOptions = $('resolutionOptions');
  const advancedOptions = $('advancedOptions');
  const advancedToggle = $('advancedToggle');
  const advancedPanel = $('advancedPanel');
  const advancedCurrentOnly = $('advancedCurrentOnly');
  const advancedPasswordRow = $('advancedPasswordRow');
  const advancedPasswordToggle = $('advancedPasswordToggle');
  const advancedPasswordInput = $('advancedPasswordInput');
  const advancedPasswordNote = $('advancedPasswordNote');
  const resetPagesBtn = $('resetPagesBtn');
  const mergeHint     = $('mergeHint');
  const mergeSummary  = $('mergeSummary');
  const mergeList     = $('mergeList');
  const mergeClearBtn = $('mergeClearBtn');
  const mergeRunBtn   = $('mergeRunBtn');
  const organizeHint  = $('organizeHint');
  const organizeSummary = $('organizeSummary');
  const splitPanel    = $('splitPanel');
  const splitSummary  = $('splitSummary');
  const clearSplitBtn = $('clearSplitBtn');
  const splitPartsList = $('splitPartsList');
  const leftPanel     = document.querySelector('.panel-left');
  const previewCanvas = $('previewCanvas');
  const previewStage  = $('previewStage');
  const canvasWrap    = $('canvasWrap');
  const emptyState    = $('emptyState');
  const organizer     = $('organizer');
  const organizerGrid = $('organizerGrid');
  const organizerEmpty = $('organizerEmpty');
  const pageEditor    = $('pageEditor');
  const pageEditorStrip = $('pageEditorStrip');
  const pageEditorMain = $('pageEditorMain');
  const pageEditorEmpty = $('pageEditorEmpty');
  const pageEditorCanvasWrap = $('pageEditorCanvasWrap');
  const pageEditorCanvas = $('pageEditorCanvas');
  const pageEditorBottom = $('pageEditorBottom');
  const editHint      = $('editHint');
  const editSummary   = $('editSummary');
  const editRotateSlider = $('editRotateSlider');
  const editRotateNum = $('editRotateNum');
  const bottomRotateSlider = $('bottomRotateSlider');
  const bottomRotateNum = $('bottomRotateNum');
  const rotateLeftBtn = $('rotateLeftBtn');
  const rotateRightBtn = $('rotateRightBtn');
  const bottomRotateLeftBtn = $('bottomRotateLeftBtn');
  const bottomRotateRightBtn = $('bottomRotateRightBtn');
  const cropHint      = $('cropHint');
  const cropReadout   = $('cropReadout');
  const cropOverlay   = $('cropOverlay');
  const cropBox       = $('cropBox');
  const themeToggle   = $('themeToggle');
  const themeToggleText = $('themeToggleText');
  const fineQualityLabel = $('fineQualityLabel');
  const fineQualityToggle = $('fineQualityToggle');
  const resetEditBtn  = $('resetEditBtn');
  const previewTitle  = $('previewTitle');
  const previewTools  = $('previewTools');
  const toolIndicator = $('toolIndicator');
  const proofMeta     = $('proofMeta');
  const zoomOutBtn    = $('zoomOut');
  const zoomInBtn     = $('zoomIn');
  const zoomValEl     = $('zoomVal');
  const loader        = $('loader');
  const loaderLabel   = $('loaderLabel');
  const loaderPct     = $('loaderPct');
  const loaderBar     = $('loaderBar');
  const loaderProgress = $('loaderProgress');
  const pageContextMenu = $('pageContextMenu');
  const contextSplitBtn = $('contextSplitBtn');

  const contextMenuState = {
    outputIndex: null,
    sourceIndex: null,
  };

  let errorHideTimer = null;
  const toolTabs = Array.from(document.querySelectorAll('.tool-tab'));
  const toolPanels = Array.from(document.querySelectorAll('.tool-panel'));

  function activateElementOnKeyboard(el) {
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      el.click();
    });
  }

  function setTogglePressed(el, pressed) {
    if (!el) return;
    el.classList.toggle('on', pressed);
    el.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  }

  const THEME_STORAGE_KEY = 'pdf-atelier-theme';

  function readSavedTheme() {
    try {
      return localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage can be unavailable in private contexts; the theme still changes for this session.
    }
  }

  function setDarkMode(enabled, persist = false) {
    document.body.classList.toggle('dark-mode', enabled);
    themeToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    themeToggle.setAttribute('aria-label', enabled ? 'Turn off dark mode' : 'Turn on dark mode');
    themeToggleText.textContent = enabled ? 'Light mode' : 'Dark mode';
    if (persist) saveTheme(enabled ? 'dark' : 'light');
    syncPreviewStageHeight();
    updateToolIndicator();
  }

  themeToggle.addEventListener('click', () => {
    setDarkMode(!document.body.classList.contains('dark-mode'), true);
  });

  advancedToggle.addEventListener('click', () => {
    const expanded = advancedToggle.getAttribute('aria-expanded') === 'true';
    advancedToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    advancedPanel.hidden = expanded;
  });
  advancedCurrentOnly.addEventListener('change', updatePageState);
  advancedPasswordToggle.addEventListener('change', () => {
    syncAdvancedOptions();
    if (!advancedPasswordInput.disabled) advancedPasswordInput.focus();
  });

  function syncToolTabA11y() {
    toolTabs.forEach(tab => {
      const selected = tab.dataset.tool === activeTool;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
    });
    toolPanels.forEach(panel => {
      const selected = panel.id === 'tool-' + activeTool;
      panel.classList.toggle('active', selected);
      panel.setAttribute('aria-hidden', selected ? 'false' : 'true');
    });
  }

  // ── Tool switching ──
  toolTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => switchTool(tab.dataset.tool));
    tab.addEventListener('keydown', e => {
      let nextIndex = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIndex = index + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIndex = index - 1;
      else if (e.key === 'Home') nextIndex = 0;
      else if (e.key === 'End') nextIndex = toolTabs.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        switchTool(tab.dataset.tool);
        return;
      }
      if (nextIndex == null) return;
      e.preventDefault();
      const nextTab = toolTabs[(nextIndex + toolTabs.length) % toolTabs.length];
      nextTab.focus();
      switchTool(nextTab.dataset.tool);
    });
  });

  function updateToolIndicator() {
    const activeTab = document.querySelector('.tool-tab.active');
    if (!activeTab || !toolIndicator) return;
    const navRect = activeTab.parentElement.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    toolIndicator.style.width = tabRect.width + 'px';
    toolIndicator.style.transform = 'translateX(' + (tabRect.left - navRect.left + activeTab.parentElement.scrollLeft) + 'px)';
  }

  function toolTipText(meta) {
    const div = document.createElement('div');
    div.innerHTML = meta.replace(/<br\s*\/?>/gi, '\n');
    return div.textContent.trim();
  }

  function switchTool(id) {
    if (!TOOLS[id]) return;
    if (id === activeTool) {
      syncToolTabA11y();
      return;
    }
    activeTool = id;
    if (id === 'threshold' || id === 'greyscale') processTool = id;
    syncToolTabA11y();
    const tool = TOOLS[id];
    $('masterLede').innerHTML = tool.lede;
    $('masterMeta').dataset.tooltip = toolTipText(tool.meta);
    $('masterMeta').setAttribute('aria-label', toolTipText(tool.meta));
    downloadLabel.innerHTML = tool.downloadLabel;
    downloadSub.innerHTML = tool.downloadSub;
    resolutionOptions.classList.toggle('hidden', !isRasterTool(id));
    downloadBtn.parentElement.style.display = id === 'preview' ? 'none' : '';
    syncAdvancedOptions();
    updateSourceDropMode();
    if (id === 'merge') updateMergeState();
    else updatePageState();
    updatePreviewMode();
    updateToolIndicator();
    syncPreviewStageHeight();
    if (state.pdfDoc && id !== 'organize' && id !== 'edit') requestPreviewRender(isRasterTool(id));
    if (state.pdfDoc && id === 'edit') { syncEditControls(); requestEditedPreviewRender(); }
  }

  function isRasterTool(id) {
    return id === 'threshold' || id === 'greyscale';
  }

  function updatePreviewMode() {
    const organizing = activeTool === 'organize';
    const editing = activeTool === 'edit';
    previewStage.classList.toggle('organizing', organizing);
    previewStage.classList.toggle('editing', editing);
    previewTools.classList.toggle('preview-tools-hidden', organizing || editing);
    previewTitle.innerHTML = organizing
      ? 'Rearrange <em>— drag pages to reorder</em>'
      : editing
        ? 'Crop & Rotate <em>— select one page</em>'
        : activeTool === 'preview'
          ? 'Preview <em>— original PDF</em>'
          : 'Preview <em>— processed output</em>';
    organizer.style.display = organizing ? 'block' : 'none';
    pageEditor.style.display = editing ? 'flex' : 'none';
    if (!editing) cropOverlay.hidden = true;
    if (organizing) {
      emptyState.style.display = 'none';
      canvasWrap.style.display = 'none';
      pageEditor.style.display = 'none';
      renderOrganizer();
      return;
    }
    if (editing) {
      emptyState.style.display = 'none';
      canvasWrap.style.display = 'none';
      renderPageEditor();
      return;
    }
    const hasPages = state.pdfDoc && activePageCount() > 0;
    emptyState.style.display = hasPages ? 'none' : 'block';
    canvasWrap.style.display = hasPages ? 'block' : 'none';
  }

  function updateSourceDropMode() {
    const merging = activeTool === 'merge';
    fileInput.multiple = merging;
    dropGlyph.textContent = merging ? '∑' : '¶';
    dropLabel.textContent = merging ? 'Upload PDFs' : 'Upload PDF';
    dropSub.textContent = merging ? 'Multiple PDFs · click or drop' : 'PDF · click or drop';
    dropZone.setAttribute('aria-label', merging ? 'Upload one or more PDFs' : 'Upload a PDF');
  }

  // ── Helpers ──
  function showError(msg) {
    if (errorHideTimer) clearTimeout(errorHideTimer);
    errBox.textContent = '⚠ ' + msg;
    errBox.classList.add('on');
    errBox.setAttribute('aria-hidden', 'false');
    errorHideTimer = setTimeout(() => {
      errBox.classList.remove('on');
      errBox.setAttribute('aria-hidden', 'true');
      errorHideTimer = null;
    }, 5000);
  }
  function clearError() {
    if (errorHideTimer) clearTimeout(errorHideTimer);
    errorHideTimer = null;
    errBox.classList.remove('on');
    errBox.setAttribute('aria-hidden', 'true');
  }

  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }

  function normalizePdfName(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return state.fileName || 'document.pdf';
    return /\.pdf$/i.test(trimmed) ? trimmed : trimmed + '.pdf';
  }

  function outputBaseName() {
    const clean = normalizePdfName(state.fileName)
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim();
    return clean || 'document';
  }

  function cleanDownloadBase(name, fallback) {
    const clean = String(name || '')
      .replace(/\.pdf$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim();
    return clean || fallback;
  }

  function activePageCount() {
    return state.pageOrder.length;
  }

  function padPage(n) {
    return n ? String(n).padStart(2, '0') : '—';
  }

  function currentSourceIndex() {
    return state.pageOrder[state.curPage - 1];
  }

  function selectedExportPageOrder() {
    if (!advancedCurrentOnly.checked) return state.pageOrder.slice();
    const sourceIndex = currentSourceIndex();
    return sourceIndex == null ? [] : [sourceIndex];
  }

  function exportBaseNameForTool(toolId) {
    let base = outputBaseName() + TOOLS[toolId].suffix;
    if (advancedCurrentOnly.checked && activePageCount() > 1) {
      base += '_page_' + padPage(state.curPage);
    }
    return base;
  }

  function canPasswordProtectExport() {
    return isRasterTool(activeTool);
  }

  function advancedPasswordValue() {
    return advancedPasswordToggle.checked ? advancedPasswordInput.value.trim() : '';
  }

  function jsPdfExportOptions(options) {
    const password = advancedPasswordValue();
    if (!password || !canPasswordProtectExport()) return options;
    return {
      ...options,
      encryption: {
        userPassword: password,
        ownerPassword: password,
        userPermissions: ['print'],
      },
    };
  }

  function syncAdvancedOptions() {
    const hasPages = !!state.pdfDoc && activePageCount() > 0;
    const applies = activeTool !== 'preview' && activeTool !== 'merge';
    const passwordAvailable = applies && canPasswordProtectExport();
    advancedOptions.classList.toggle('hidden', !applies);
    advancedCurrentOnly.disabled = !applies || !hasPages;
    advancedPasswordToggle.disabled = !passwordAvailable;
    advancedPasswordRow.classList.toggle('is-disabled', !passwordAvailable);
    advancedPasswordInput.disabled = !passwordAvailable || !advancedPasswordToggle.checked;
    advancedPasswordNote.textContent = passwordAvailable
      ? 'Locks Threshold and Grayscale PDFs.'
      : 'Available for Threshold and Grayscale rendered exports.';
    if (!passwordAvailable) {
      advancedPasswordToggle.checked = false;
      advancedPasswordInput.value = '';
    }
  }

  function currentPageData() {
    const sourceIndex = currentSourceIndex();
    return sourceIndex == null ? null : state.pages[sourceIndex];
  }

  function shouldUseLargePdfSafeMode(fileSize, pageCount) {
    return fileSize >= LARGE_PDF_SAFE_MODE_BYTES || pageCount >= LARGE_PDF_SAFE_MODE_PAGES;
  }

  function pageHasFullData(pd, renderKey = state.resolution) {
    return !!(pd && pd.lum && pd.histo && pd.renderKey === renderKey);
  }

  function resetRenderCaches() {
    state.renderGeneration++;
    state.fullPageCacheOrder = [];
    pageRenderJobs.clear();
    thumbnailJobs.clear();
    thumbnailQueue.length = 0;
    thumbnailQueued.clear();
  }

  function touchFullPageCache(sourceIndex) {
    if (!state.largePdfSafeMode || sourceIndex == null) return;
    state.fullPageCacheOrder = state.fullPageCacheOrder.filter(index => index !== sourceIndex);
    state.fullPageCacheOrder.push(sourceIndex);
    while (state.fullPageCacheOrder.length > SAFE_FULL_PAGE_CACHE_LIMIT) {
      const evictIndex = state.fullPageCacheOrder.shift();
      if (evictIndex === sourceIndex) continue;
      const pd = state.pages[evictIndex];
      if (!pd) continue;
      pd.lum = null;
      pd.histo = null;
      pd.renderKey = null;
    }
  }

  function forgetFullPageData() {
    state.fullPageCacheOrder = [];
    state.pages = state.pages.map(pd => {
      if (!pd) return null;
      return { ...pd, lum: null, histo: null, renderKey: null };
    });
  }

  function defaultPageEdit() {
    return { crop: { left: 0, top: 0, right: 0, bottom: 0 }, fineRotation: 0, quarterTurns: 0 };
  }

  function clonePageEdit(edit) {
    const src = edit || defaultPageEdit();
    return {
      crop: {
        left: +(src.crop?.left || 0),
        top: +(src.crop?.top || 0),
        right: +(src.crop?.right || 0),
        bottom: +(src.crop?.bottom || 0),
      },
      fineRotation: +(src.fineRotation || 0),
      quarterTurns: ((src.quarterTurns || 0) % 4 + 4) % 4,
    };
  }

  function getPageEdit(sourceIndex) {
    if (sourceIndex == null) return defaultPageEdit();
    if (!state.pageEdits[sourceIndex]) state.pageEdits[sourceIndex] = defaultPageEdit();
    return state.pageEdits[sourceIndex];
  }

  function currentPageEdit() {
    return getPageEdit(currentSourceIndex());
  }

  function editAngle(edit) {
    const e = clonePageEdit(edit);
    return e.quarterTurns * 90 + e.fineRotation;
  }

  function isPageEdited(edit) {
    if (!edit) return false;
    const e = clonePageEdit(edit);
    return Math.abs(e.fineRotation) > 0.001 ||
      e.quarterTurns !== 0 ||
      e.crop.left || e.crop.top || e.crop.right || e.crop.bottom;
  }

  function hasAnyPageEdits() {
    return state.pageEdits.some(isPageEdited);
  }

  function hasFineRotation(edit) {
    return Math.abs(clonePageEdit(edit).fineRotation) > 0.001;
  }

  function fineRotationExportDpi() {
    return FINE_ROTATION_EXPORT_DPI[state.fineRotationQuality] || FINE_ROTATION_EXPORT_DPI.high;
  }

  function syncFineQualityToggle() {
    const ultra = state.fineRotationQuality === 'ultra';
    fineQualityToggle.classList.toggle('on', ultra);
    fineQualityToggle.setAttribute('aria-pressed', ultra ? 'true' : 'false');
    fineQualityLabel.textContent = ultra ? 'Ultra · 900 dpi' : 'High · 600 dpi';
  }

  function defaultSplitName(index) {
    return outputBaseName() + '_part_' + (index + 1);
  }

  function normalizeSplitState() {
    const count = activePageCount();
    if (!state.pdfDoc || count < 2) {
      state.splitPoints = [];
      state.splitNames = [];
      return;
    }
    const max = count - 1;
    const unique = new Set();
    state.splitPoints = state.splitPoints
      .map(Number)
      .filter(point => Number.isInteger(point) && point >= 1 && point <= max && !unique.has(point) && unique.add(point))
      .sort((a, b) => a - b);
    const partCount = state.splitPoints.length + 1;
    while (state.splitNames.length < partCount) {
      state.splitNames.push(defaultSplitName(state.splitNames.length));
    }
    if (state.splitNames.length > partCount) state.splitNames.length = partCount;
    if (!state.splitPoints.length) state.splitNames = [];
  }

  function hasActiveSplit() {
    normalizeSplitState();
    return state.splitPoints.length > 0;
  }

  function splitParts() {
    if (!hasActiveSplit()) return [];
    const boundaries = [0, ...state.splitPoints, activePageCount()];
    return boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1];
      return {
        index,
        start,
        end,
        name: state.splitNames[index] || defaultSplitName(index),
        pageOrder: state.pageOrder.slice(start, end),
      };
    });
  }

  function pageRangeText(start, end) {
    return start + 1 === end ? 'Page ' + (start + 1) : 'Pages ' + (start + 1) + '-' + end;
  }

  function updateSplitPanel() {
    const parts = splitParts();
    const splitActive = parts.length > 0;
    splitPanel.hidden = !splitActive;
    clearSplitBtn.disabled = !splitActive;
    splitPartsList.innerHTML = '';
    if (!splitActive) {
      splitSummary.textContent = 'Use a page Split button in Organize to create a split.';
      return;
    }
    splitSummary.textContent = parts.length + ' PDFs from ' + state.splitPoints.length + ' split point' +
      (state.splitPoints.length === 1 ? '.' : 's.');
    parts.forEach(part => {
      const row = document.createElement('div');
      row.className = 'split-part-row';

      const top = document.createElement('div');
      top.className = 'split-part-top';
      const label = document.createElement('div');
      label.className = 'split-part-label';
      label.textContent = 'Part ' + (part.index + 1);
      const pages = document.createElement('div');
      pages.className = 'split-part-pages';
      pages.textContent = pageRangeText(part.start, part.end);
      top.appendChild(label);
      top.appendChild(pages);

      const input = document.createElement('input');
      input.className = 'split-name-input';
      input.type = 'text';
      input.value = part.name;
      input.setAttribute('aria-label', 'Name for part ' + (part.index + 1));
      input.addEventListener('input', () => {
        state.splitNames[part.index] = input.value;
      });

      const button = document.createElement('button');
      button.className = 'btn-secondary split-export-btn';
      button.type = 'button';
      button.textContent = 'Export part ' + (part.index + 1);
      button.addEventListener('click', () => exportSplitPart(part.index));

      row.appendChild(top);
      row.appendChild(input);
      row.appendChild(button);
      splitPartsList.appendChild(row);
    });
  }

  function isOrderChanged() {
    if (!state.pdfDoc || state.pageOrder.length !== state.numPages) return !!state.pdfDoc;
    return state.pageOrder.some((sourceIndex, outputIndex) => sourceIndex !== outputIndex);
  }

  function updatePageState() {
    const count = activePageCount();
    normalizeSplitState();
    if (count === 0) state.curPage = 1;
    else state.curPage = Math.max(1, Math.min(state.curPage, count));
    pageCountEl.textContent = state.pdfDoc ? count : '—';
    totPageEl.textContent = state.pdfDoc ? padPage(count) : '—';
    curPageEl.textContent = state.pdfDoc && count ? padPage(state.curPage) : '—';
    prevBtn.disabled = !state.pdfDoc || state.curPage <= 1;
    nextBtn.disabled = !state.pdfDoc || state.curPage >= count;
    downloadBtn.disabled = activeTool === 'preview'
      ? true
      : activeTool === 'merge'
        ? state.mergeFiles.length === 0
        : !state.pdfDoc || count === 0;
    resetPagesBtn.disabled = !state.pdfDoc || !isOrderChanged();
    organizeHint.textContent = state.pdfDoc
      ? (state.splitPoints.length ? state.splitPoints.length + ' splits' : count + ' pages')
      : 'ready';
    organizeSummary.textContent = state.pdfDoc
      ? (state.splitPoints.length
        ? (state.splitPoints.length + 1) + ' PDFs are ready. Edit names and export each part from the split panel.'
        : count + ' of ' + state.numPages + ' original pages will be included in export. Use Split on a page to divide the PDF.')
      : 'Upload a PDF to reorder or remove pages.';
    updateSplitPanel();
    proofMeta.textContent = state.pdfDoc
      ? (count ? count + ' pages in output' : 'no pages selected')
      : 'awaiting PDF';
    syncAdvancedOptions();
    updatePreviewMode();
    if (activeTool === 'edit') {
      syncEditControls();
      requestEditedPreviewRender();
    }
  }

  function setLoader(on, label, pct) {
    loader.classList.toggle('on', on);
    loader.setAttribute('aria-busy', on ? 'true' : 'false');
    loader.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on && label != null) loaderLabel.textContent = label;
    if (on && pct != null) {
      const clampedPct = Math.max(0, Math.min(100, Number(pct) || 0));
      const roundedPct = Math.round(clampedPct);
      loaderPct.textContent = roundedPct + '%';
      loaderBar.style.width = clampedPct + '%';
      loaderProgress.setAttribute('aria-valuenow', String(roundedPct));
      loaderProgress.setAttribute('aria-valuetext', roundedPct + '%');
    }
  }

  function threshHintText(v) {
    if (v < 64) return 'low';
    if (v < 110) return 'dark range';
    if (v < 145) return 'mid range';
    if (v < 200) return 'light range';
    return 'high';
  }

  function contrastHintText(v) {
    if (v < 80) return 'low';
    if (v < 95) return 'soft';
    if (v <= 115) return 'normal';
    if (v <= 150) return 'high';
    return 'maximum';
  }

  function greyHintText() {
    if (state.sepia) return 'sepia';
    if (state.greyInvert) return 'inverted';
    if (state.brightness > 40) return 'bright';
    if (state.brightness < -40) return 'dark';
    if (state.contrast > 140) return 'high contrast';
    return 'neutral';
  }

  // ── File handling ──
  function beginFileNameEdit() {
    if (!state.fileName || fileNameEl.querySelector('input')) return;
    const currentName = state.fileName;
    const input = document.createElement('input');
    input.className = 'file-name-input';
    input.type = 'text';
    input.value = currentName;
    fileNameEl.textContent = '';
    fileNameEl.appendChild(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = commit => {
      if (finished) return;
      finished = true;
      if (commit) state.fileName = normalizePdfName(input.value);
      else state.fileName = currentName;
      fileNameEl.textContent = state.fileName;
      fileNameEl.title = 'Click to rename';
    };

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  fileNameEl.addEventListener('click', beginFileNameEdit);
  fileNameEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      beginFileNameEdit();
    }
  });

  function renderMergeList() {
    mergeList.innerHTML = '';
    state.mergeFiles.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'merge-file-row';

      const num = document.createElement('div');
      num.className = 'merge-file-index';
      num.textContent = index + 1;

      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'merge-file-name';
      name.textContent = file.name;
      const meta = document.createElement('div');
      meta.className = 'merge-file-meta';
      meta.textContent = fmtBytes(file.size);
      info.appendChild(name);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'merge-file-actions';
      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '↑';
      up.disabled = index === 0;
      up.setAttribute('aria-label', 'Move ' + file.name + ' up');
      up.addEventListener('click', () => moveMergeFile(index, -1));
      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = '↓';
      down.disabled = index === state.mergeFiles.length - 1;
      down.setAttribute('aria-label', 'Move ' + file.name + ' down');
      down.addEventListener('click', () => moveMergeFile(index, 1));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove ' + file.name);
      remove.addEventListener('click', () => removeMergeFile(index));
      actions.appendChild(up);
      actions.appendChild(down);
      actions.appendChild(remove);

      row.appendChild(num);
      row.appendChild(info);
      row.appendChild(actions);
      mergeList.appendChild(row);
    });
  }

  function updateMergeState() {
    const count = state.mergeFiles.length;
    const totalSize = state.mergeFiles.reduce((sum, file) => sum + file.size, 0);
    mergeHint.textContent = count ? count + ' PDFs' : 'ready';
    mergeSummary.textContent = count
      ? count + ' PDF' + (count === 1 ? '' : 's') + ' selected · ' + fmtBytes(totalSize) + '. Arrange the list, then merge into Organize.'
      : 'Choose multiple PDFs, arrange their order, then merge into the organizer.';
    mergeClearBtn.disabled = count === 0;
    mergeRunBtn.disabled = count === 0;
    if (activeTool === 'merge') downloadBtn.disabled = count === 0;
    renderMergeList();
  }

  function addMergeFiles(fileList) {
    clearError();
    const files = Array.from(fileList).filter(file =>
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) {
      showError('Choose one or more PDF files to merge.');
      return;
    }
    state.mergeFiles.push(...files);
    updateMergeState();
  }

  function moveMergeFile(index, delta) {
    const next = index + delta;
    if (next < 0 || next >= state.mergeFiles.length) return;
    const [file] = state.mergeFiles.splice(index, 1);
    state.mergeFiles.splice(next, 0, file);
    updateMergeState();
  }

  function removeMergeFile(index) {
    state.mergeFiles.splice(index, 1);
    updateMergeState();
  }

  async function mergeSelectedPdfs() {
    clearError();
    if (!window.PDFLib) throw new Error('PDF library did not load. Check your connection and try again.');
    if (!state.mergeFiles.length) {
      showError('Choose at least one PDF to merge.');
      return;
    }
    mergeRunBtn.disabled = true;
    setLoader(true, 'Merging PDFs…', 0);
    try {
      const out = await PDFLib.PDFDocument.create();
      let totalPages = 0;
      for (let i = 0; i < state.mergeFiles.length; i++) {
        const file = state.mergeFiles[i];
        setLoader(true, 'Merging ' + file.name, (i / state.mergeFiles.length) * 70);
        const src = await PDFLib.PDFDocument.load(await file.arrayBuffer());
        const pageIndices = src.getPageIndices();
        const pages = await out.copyPages(src, pageIndices);
        pages.forEach(page => out.addPage(page));
        totalPages += pageIndices.length;
      }
      const bytes = await out.save();
      const mergedName = cleanDownloadBase(state.mergeFiles[0].name, 'merged') +
        (state.mergeFiles.length > 1 ? '_merged.pdf' : '_copy.pdf');
      const mergedBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await loadPdfBytes(mergedBuffer, mergedName, bytes.byteLength, 'Rendering merged PDF…');
      state.mergeFiles = [];
      updateMergeState();
      switchTool('organize');
      setLoader(false);
      proofMeta.textContent = totalPages + ' merged pages';
    } catch (err) {
      console.error(err);
      showError('Merge failed: ' + (err.message || err));
      setLoader(false);
      updateMergeState();
    }
  }

  mergeClearBtn.addEventListener('click', () => {
    state.mergeFiles = [];
    updateMergeState();
  });
  mergeRunBtn.addEventListener('click', () => mergeSelectedPdfs());

  dropZone.addEventListener('click', () => fileInput.click());
  activateElementOnKeyboard(dropZone);
  document.querySelectorAll('.toggle[role="button"]').forEach(activateElementOnKeyboard);
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag');
    if (!e.dataTransfer.files.length) return;
    if (activeTool === 'merge') addMergeFiles(e.dataTransfer.files);
    else handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', e => {
    if (!e.target.files.length) return;
    if (activeTool === 'merge') addMergeFiles(e.target.files);
    else handleFile(e.target.files[0]);
    fileInput.value = '';
  });

  async function loadPdfBytes(buf, fileName, fileSize, loadingLabel = 'Loading PDF…') {
    resetRenderCaches();
    state.fileName = normalizePdfName(fileName);
    state.fileSize = fileSize;
    fileNameEl.textContent = state.fileName;
    fileNameEl.title = 'Click to rename';
    fileNameEl.tabIndex = 0;
    fileSizeEl.textContent = fmtBytes(fileSize);
    fileStatusEl.textContent = 'loading';
    fileCard.classList.add('on');
    setLoader(true, loadingLabel, 0);
    state.pdfBytes = buf.slice(0);
    const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    state.pdfDoc = pdf;
    state.numPages = pdf.numPages;
    state.largePdfSafeMode = shouldUseLargePdfSafeMode(fileSize, pdf.numPages);
    state.curPage = 1;
    state.pages = new Array(pdf.numPages).fill(null);
    state.pageOrder = Array.from({ length: pdf.numPages }, (_, i) => i);
    state.pageEdits = new Array(pdf.numPages).fill(null);
    state.splitPoints = [];
    state.splitNames = [];
    updatePageState();
    const lazyOpen = state.largePdfSafeMode || activeTool === 'preview' || activeTool === 'organize' || activeTool === 'edit';
    if (lazyOpen) {
      setLoader(true, state.largePdfSafeMode ? 'Opening large PDF safely…' : 'Opening PDF…', 45);
      await ensurePageMeta(0);
      if (activeTool === 'edit') await ensureRasterPreviewData(0);
    } else {
      for (let i = 1; i <= pdf.numPages; i++) {
        setLoader(true, 'Rendering page ' + i + ' of ' + pdf.numPages, ((i - 1) / pdf.numPages) * 100);
        await renderPageToLuminance(i);
      }
    }
    fileStatusEl.textContent = state.largePdfSafeMode ? 'ready · safe' : 'ready';
    downloadBtn.disabled = false;
    zoomLevel = 1;
    zoomInBtn.disabled = false;
    zoomOutBtn.disabled = false;
    updatePageState();
    syncPreviewStageHeight();
    drawPreview();
    drawHistogram();
    setLoader(false);
  }

  async function handleFile(file) {
    clearError();
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showError('That doesn’t look like a PDF.'); return;
    }
    try {
      await loadPdfBytes(await file.arrayBuffer(), file.name, file.size);
    } catch (err) {
      console.error(err);
      showError('Could not read this PDF: ' + (err.message || err));
      fileStatusEl.textContent = 'error';
      setLoader(false);
    }
  }

  // ── Page luminance cache ──
  function getRenderScale(baseVp) {
    if (state.resolution === '600') return 600 / 72;
    if (state.resolution === '300') return 300 / 72;
    return Math.min(2.5, 1800 / Math.max(baseVp.width, baseVp.height));
  }

  function getPreviewRenderScale(baseVp) {
    return Math.min(2.5, 2200 / Math.max(baseVp.width, baseVp.height));
  }

  function getRasterPreviewScale(baseVp) {
    const pagePixels = Math.max(1, baseVp.width * baseVp.height);
    return Math.max(0.35, Math.min(2.4, Math.sqrt(RASTER_PREVIEW_MAX_PIXELS / pagePixels)));
  }

  async function ensurePageMeta(sourceIndex) {
    if (!state.pdfDoc || sourceIndex == null) return null;
    const existing = state.pages[sourceIndex];
    if (existing && existing.w && existing.h && existing.scale && existing.metaKey === PREVIEW_META_KEY) return existing;
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = getPreviewRenderScale(baseVp);
    const vp = page.getViewport({ scale });
    const pd = {
      ...(existing || {}),
      w: Math.floor(vp.width),
      h: Math.floor(vp.height),
      scale,
      lum: existing?.lum || null,
      histo: existing?.histo || null,
      thumbUrl: existing?.thumbUrl || null,
      renderKey: existing?.renderKey || null,
      metaKey: PREVIEW_META_KEY,
    };
    state.pages[sourceIndex] = pd;
    return pd;
  }

  async function renderPageToLuminance(pageNum, opts = {}) {
    const sourceIndex = pageNum - 1;
    const existing = state.pages[sourceIndex];
    const page = await state.pdfDoc.getPage(pageNum);
    const baseVp = page.getViewport({ scale: 1 });
    const renderKey = opts.renderKey || state.resolution;
    const scale = opts.scale || getRenderScale(baseVp);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width);
    c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const thumbUrl = opts.skipThumb ? null : makeThumbnailUrl(c);
    const d = img.data;
    const lum = new Uint8ClampedArray(c.width * c.height);
    const histo = new Uint32Array(256);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const v = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) | 0;
      lum[j] = v; histo[v]++;
    }
    state.pages[sourceIndex] = {
      ...(existing || {}),
      lum, w: c.width, h: c.height, histo, scale,
      thumbUrl: existing?.thumbUrl || thumbUrl,
      renderKey,
      metaKey: renderKey === RASTER_PREVIEW_KEY ? PREVIEW_META_KEY : null,
    };
    touchFullPageCache(sourceIndex);
    c.width = 0;
    c.height = 0;
    return state.pages[sourceIndex];
  }

  async function ensurePageData(sourceIndex, opts = {}) {
    if (!state.pdfDoc || sourceIndex == null) return null;
    const renderKey = opts.renderKey || state.resolution;
    const existing = state.pages[sourceIndex];
    if (pageHasFullData(existing, renderKey)) {
      touchFullPageCache(sourceIndex);
      return existing;
    }
    const jobKey = state.renderGeneration + ':full:' + sourceIndex + ':' + renderKey;
    if (pageRenderJobs.has(jobKey)) return pageRenderJobs.get(jobKey);
    const job = renderPageToLuminance(sourceIndex + 1, { ...opts, renderKey }).finally(() => pageRenderJobs.delete(jobKey));
    pageRenderJobs.set(jobKey, job);
    return job;
  }

  async function ensureRasterPreviewData(sourceIndex) {
    if (!state.pdfDoc || sourceIndex == null) return null;
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    const scale = getRasterPreviewScale(page.getViewport({ scale: 1 }));
    return ensurePageData(sourceIndex, { renderKey: RASTER_PREVIEW_KEY, scale, skipThumb: true });
  }

  function makeThumbnailUrl(sourceCanvas, maxW = 520, maxH = 720) {
    let w = maxW;
    let h = Math.round(w * (sourceCanvas.height / sourceCanvas.width));
    if (h > maxH) {
      h = maxH;
      w = Math.round(h * (sourceCanvas.width / sourceCanvas.height));
    }
    const thumb = document.createElement('canvas');
    thumb.width = w;
    thumb.height = h;
    const tctx = thumb.getContext('2d');
    tctx.fillStyle = '#fff';
    tctx.fillRect(0, 0, w, h);
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(sourceCanvas, 0, 0, w, h);
    return thumb.toDataURL('image/png');
  }

  async function renderThumbnail(sourceIndex, quality = 'low') {
    if (!state.pdfDoc || sourceIndex == null) return null;
    const existing = state.pages[sourceIndex];
    if (existing?.thumbUrl && (quality === 'low' || existing.thumbQuality === 'high')) return existing.thumbUrl;
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = quality === 'high'
      ? Math.min(1.45, 900 / Math.max(baseVp.width, baseVp.height))
      : Math.min(0.75, 260 / Math.max(baseVp.width, baseVp.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(vp.width));
    c.height = Math.max(1, Math.floor(vp.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const thumbUrl = quality === 'high'
      ? makeThumbnailUrl(c, 520, 720)
      : makeThumbnailUrl(c, 220, 310);
    const pd = await ensurePageMeta(sourceIndex);
    state.pages[sourceIndex] = { ...(pd || {}), thumbUrl, thumbQuality: quality };
    c.width = 0;
    c.height = 0;
    return thumbUrl;
  }

  function applyThumbnailToElements(sourceIndex, thumbUrl) {
    document.querySelectorAll('[data-thumb-source="' + sourceIndex + '"]').forEach(el => {
      if (el.tagName === 'IMG') el.src = thumbUrl;
      else el.style.backgroundImage = 'url("' + thumbUrl + '")';
      el.textContent = '';
      el.setAttribute('aria-label', 'Page thumbnail ' + (sourceIndex + 1));
    });
  }

  async function ensureThumbnail(sourceIndex, quality = 'low') {
    const existing = state.pages[sourceIndex];
    if (existing?.thumbUrl && (quality === 'low' || existing.thumbQuality === 'high')) return existing.thumbUrl;
    const jobKey = state.renderGeneration + ':thumb:' + sourceIndex + ':' + quality;
    if (thumbnailJobs.has(jobKey)) return thumbnailJobs.get(jobKey);
    const job = renderThumbnail(sourceIndex, quality)
      .then(url => {
        if (url) applyThumbnailToElements(sourceIndex, url);
        if (quality === 'low') queueThumbnail(sourceIndex, 'high');
        return url;
      })
      .finally(() => thumbnailJobs.delete(jobKey));
    thumbnailJobs.set(jobKey, job);
    return job;
  }

  function runThumbnailQueue() {
    if (thumbnailQueueRunning) return;
    thumbnailQueueRunning = true;
    (async () => {
      while (thumbnailQueue.length) {
        const item = thumbnailQueue.shift();
        const sourceIndex = item.sourceIndex;
        const quality = item.quality;
        thumbnailQueued.delete(sourceIndex + ':' + quality);
        const existing = state.pages[sourceIndex];
        if (existing?.thumbUrl && (quality === 'low' || existing.thumbQuality === 'high')) continue;
        try { await ensureThumbnail(sourceIndex, quality); }
        catch (err) { console.warn('Thumbnail render failed', err); }
        await new Promise(r => setTimeout(r, 0));
      }
      thumbnailQueueRunning = false;
    })();
  }

  function queueThumbnail(sourceIndex, quality = 'low') {
    if (sourceIndex == null) return;
    const existing = state.pages[sourceIndex];
    if (existing?.thumbUrl && (quality === 'low' || existing.thumbQuality === 'high')) return;
    const queueKey = sourceIndex + ':' + quality;
    if (thumbnailQueued.has(queueKey)) return;
    thumbnailQueued.add(queueKey);
    thumbnailQueue.push({ sourceIndex, quality });
    runThumbnailQueue();
  }

  function getThumbnailObserver() {
    if (!('IntersectionObserver' in window)) return null;
    if (!thumbnailObserver) {
      thumbnailObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const sourceIndex = Number(entry.target.dataset.thumbSource);
          thumbnailObserver.unobserve(entry.target);
          queueThumbnail(sourceIndex);
        });
      }, { root: previewStage, rootMargin: '420px' });
    }
    return thumbnailObserver;
  }

  function createPageThumb(sourceIndex, label) {
    const pd = state.pages[sourceIndex];
    if (pd?.thumbUrl) {
      const thumb = document.createElement('img');
      thumb.className = 'page-thumb';
      thumb.src = pd.thumbUrl;
      thumb.alt = label;
      thumb.dataset.thumbSource = sourceIndex;
      thumb.draggable = false;
      if (pd.thumbQuality !== 'high') queueThumbnail(sourceIndex, 'high');
      return thumb;
    }
    const thumb = document.createElement('div');
    thumb.className = 'page-thumb page-thumb-placeholder';
    thumb.dataset.thumbSource = sourceIndex;
    thumb.textContent = 'Page ' + (sourceIndex + 1);
    const observer = getThumbnailObserver();
    if (observer) observer.observe(thumb);
    else queueThumbnail(sourceIndex);
    return thumb;
  }

  // ── Processing functions ──
  function applyThresholdToCanvas(pd, canvas) {
    canvas.width = pd.w; canvas.height = pd.h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(pd.w, pd.h);
    const d = img.data; const lum = pd.lum;
    const thresh = state.threshold; const inv = state.invert;
    for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
      const v = (inv ? lum[j] >= thresh : lum[j] < thresh) ? 0 : 255;
      d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function applyGreyscaleToCanvas(pd, canvas) {
    canvas.width = pd.w; canvas.height = pd.h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(pd.w, pd.h);
    const d = img.data; const lum = pd.lum;
    const bf = state.brightness * 1.28;
    const cf = state.contrast / 100;
    const inv = state.greyInvert;
    const sep = state.sepia;
    for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
      let v = (lum[j] - 128) * cf + 128 + bf;
      v = Math.max(0, Math.min(255, v)) | 0;
      if (inv) v = 255 - v;
      if (sep) {
        d[i]   = Math.min(255, (v * 1.12) | 0);
        d[i+1] = v;
        d[i+2] = Math.max(0,  (v * 0.72) | 0);
      } else {
        d[i] = v; d[i+1] = v; d[i+2] = v;
      }
      d[i+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  let originalPreviewRenderToken = 0;
  let processedPreviewRenderToken = 0;

  async function renderOriginalPreview(pd, sourceIndex) {
    const token = ++originalPreviewRenderToken;
    previewCanvas.width = pd.w;
    previewCanvas.height = pd.h;
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    try {
      const page = await state.pdfDoc.getPage(sourceIndex + 1);
      if (token !== originalPreviewRenderToken || (activeTool !== 'preview' && activeTool !== 'merge')) return;
      const viewport = page.getViewport({ scale: pd.scale });
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (token === originalPreviewRenderToken && (activeTool === 'preview' || activeTool === 'merge')) applyZoom();
    } catch (err) {
      console.error(err);
      showError('Preview failed: ' + (err.message || err));
    }
  }

  async function drawPreview() {
    const sourceIndex = currentSourceIndex();
    if (sourceIndex == null) {
      canvasWrap.style.display = 'none';
      emptyState.style.display = activeTool === 'organize' ? 'none' : 'block';
      return;
    }
    const token = ++processedPreviewRenderToken;
    if ((activeTool === 'preview' || activeTool === 'merge') && sourceIndex != null) {
      const pd = await ensurePageMeta(sourceIndex);
      if (token !== processedPreviewRenderToken || sourceIndex !== currentSourceIndex() || (activeTool !== 'preview' && activeTool !== 'merge')) return;
      renderOriginalPreview(pd, sourceIndex);
      proofMeta.textContent = pd.w + ' × ' + pd.h + ' px · page ' + state.curPage + '/' + activePageCount();
      return;
    }
    const pd = isRasterTool(activeTool)
      ? await ensureRasterPreviewData(sourceIndex)
      : await ensurePageData(sourceIndex);
    if (!pd || token !== processedPreviewRenderToken || sourceIndex !== currentSourceIndex() || activeTool === 'organize' || activeTool === 'edit') return;
    if (processTool === 'threshold') applyThresholdToCanvas(pd, previewCanvas);
    else applyGreyscaleToCanvas(pd, previewCanvas);
    proofMeta.textContent = pd.w + ' × ' + pd.h + ' px · page ' + state.curPage + '/' + activePageCount();
    applyZoom();
  }

  async function drawHistogram() {
    if (!isRasterTool(activeTool)) return;
    const sourceIndex = currentSourceIndex();
    const pd = await ensureRasterPreviewData(sourceIndex);
    if (!pd || sourceIndex !== currentSourceIndex() || !isRasterTool(activeTool)) return;
    const cw = histoCanvas.clientWidth || 300;
    const ch = histoCanvas.clientHeight || 56;
    histoCanvas.width = cw * devicePixelRatio;
    histoCanvas.height = ch * devicePixelRatio;
    const ctx = histoCanvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, cw, ch);
    let max = 0;
    for (let i = 1; i < 255; i++) if (pd.histo[i] > max) max = pd.histo[i];
    if (!max) max = 1;
    ctx.fillStyle = '#0c0a08';
    const barW = cw / 256;
    for (let i = 0; i < 256; i++) {
      const h = Math.min(ch, (pd.histo[i] / max) * (ch - 2));
      ctx.fillRect(i * barW, ch - h, Math.max(barW, 1), h);
    }
  }

  let previewRenderFrame = null;
  let previewNeedsHistogram = false;
  function requestPreviewRender(withHistogram = false) {
    previewNeedsHistogram = previewNeedsHistogram || withHistogram;
    if (previewRenderFrame) return;
    previewRenderFrame = requestAnimationFrame(() => {
      previewRenderFrame = null;
      drawPreview();
      if (previewNeedsHistogram) drawHistogram();
      previewNeedsHistogram = false;
    });
  }

  let editPreviewFrame = null;
  function requestEditedPreviewRender() {
    if (editPreviewFrame) return;
    editPreviewFrame = requestAnimationFrame(() => {
      editPreviewFrame = null;
      drawEditedPagePreview();
    });
  }

  function drawThumbnail(canvas, pd) {
    const maxW = 520;
    const maxH = 720;
    let w = maxW;
    let h = Math.round(w * (pd.h / pd.w));
    if (h > maxH) {
      h = maxH;
      w = Math.round(h * (pd.w / pd.h));
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(pd.h - 1, Math.floor((y / h) * pd.h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(pd.w - 1, Math.floor((x / w) * pd.w));
        const v = pd.lum[sy * pd.w + sx];
        const i = (y * w + x) * 4;
        d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function editedLabel(edit) {
    if (!isPageEdited(edit)) return 'Original';
    const parts = [];
    const angle = editAngle(edit);
    if (Math.abs(angle) > 0.001) parts.push((Math.round(angle * 10) / 10) + '°');
    const cropTotal = edit.crop.left + edit.crop.top + edit.crop.right + edit.crop.bottom;
    if (cropTotal) parts.push('crop');
    return parts.join(' · ');
  }

  function renderPageEditor() {
    if (!pageEditorStrip || activeTool !== 'edit') return;
    pageEditorStrip.innerHTML = '';
    const count = activePageCount();
    pageEditorEmpty.classList.toggle('on', !state.pdfDoc || count === 0);
    pageEditorCanvasWrap.style.display = state.pdfDoc && count ? 'block' : 'none';
    pageEditorBottom.style.display = state.pdfDoc && count ? 'flex' : 'none';
    if (!state.pdfDoc || count === 0) {
      pageEditorEmpty.textContent = 'Upload a PDF to crop or rotate pages.';
      cropOverlay.hidden = true;
      return;
    }
    for (let outputIndex = 0; outputIndex < count; outputIndex++) {
      const sourceIndex = state.pageOrder[outputIndex];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'page-edit-card' + (state.curPage === outputIndex + 1 ? ' active' : '');
      card.dataset.outputIndex = outputIndex;
      card.dataset.sourceIndex = sourceIndex;

      card.appendChild(createPageThumb(sourceIndex, 'Page ' + (outputIndex + 1)));

      const actions = document.createElement('div');
      actions.className = 'page-card-actions';
      const badge = document.createElement('span');
      badge.className = 'page-edit-badge';
      badge.textContent = editedLabel(getPageEdit(sourceIndex));
      const num = document.createElement('div');
      num.className = 'page-number';
      num.textContent = outputIndex + 1;
      actions.appendChild(badge);
      actions.appendChild(num);
      card.appendChild(actions);

      card.addEventListener('click', () => {
        state.curPage = outputIndex + 1;
        updatePageState();
        syncEditControls();
        requestEditedPreviewRender();
      });
      pageEditorStrip.appendChild(card);
    }
  }

  const cropDrag = {
    active: false,
    handle: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    startCrop: null,
    overlayRect: null,
  };

  function syncCropLabels(edit) {
    const total = edit.crop.left + edit.crop.top + edit.crop.right + edit.crop.bottom;
    const retainedW = Math.max(0, 100 - edit.crop.left - edit.crop.right);
    const retainedH = Math.max(0, 100 - edit.crop.top - edit.crop.bottom);
    cropHint.textContent = total ? roundCropValue(total) + '% total' : '0%';
    cropReadout.textContent = total
      ? roundCropValue(retainedW) + '% × ' + roundCropValue(retainedH) + '% kept'
      : 'Full page';
    updateCropOverlay();
  }

  function syncEditControls() {
    const hasPages = !!state.pdfDoc && activePageCount() > 0;
    rotateLeftBtn.disabled = !hasPages;
    rotateRightBtn.disabled = !hasPages;
    bottomRotateLeftBtn.disabled = !hasPages;
    bottomRotateRightBtn.disabled = !hasPages;
    resetEditBtn.disabled = !hasPages || !isPageEdited(currentPageEdit());
    editHint.textContent = hasPages ? 'page ' + state.curPage : 'select page';
    editSummary.textContent = hasPages
      ? 'Editing page ' + state.curPage + ' of ' + activePageCount() + '. Changes apply only to this page.'
      : 'Upload a PDF, then choose a page from the editor to crop or rotate it.';
    editRotateSlider.disabled = !hasPages;
    bottomRotateSlider.disabled = !hasPages;
    cropOverlay.hidden = !hasPages;
    if (!hasPages) {
      cropHint.textContent = '0%';
      cropReadout.textContent = 'Full page';
      return;
    }
    const edit = currentPageEdit();
    editRotateSlider.value = edit.fineRotation;
    bottomRotateSlider.value = edit.fineRotation;
    editRotateNum.textContent = (Math.round(editAngle(edit) * 10) / 10).toFixed(1) + '°';
    bottomRotateNum.textContent = editRotateNum.textContent;
    syncCropLabels(edit);
  }

  function roundCropValue(value) {
    return Math.round((+value || 0) * 10) / 10;
  }

  function clampCropValue(value, min = 0, max = 88) {
    return Math.max(min, Math.min(max, +value || 0));
  }

  function normalizeCrop(crop, changedSide) {
    const changedSides = Array.isArray(changedSide) ? changedSide : [changedSide];
    crop.left = roundCropValue(clampCropValue(crop.left));
    crop.top = roundCropValue(clampCropValue(crop.top));
    crop.right = roundCropValue(clampCropValue(crop.right));
    crop.bottom = roundCropValue(clampCropValue(crop.bottom));
    [['left', 'right'], ['top', 'bottom']].forEach(([a, b]) => {
      if (crop[a] + crop[b] <= 88) return;
      const changed = changedSides.includes(a) || changedSides.includes(b)
        ? changedSides.find(side => side === a || side === b)
        : a;
      const other = changed === a ? b : a;
      crop[changed] = roundCropValue(Math.max(0, 88 - crop[other]));
    });
  }

  function setCropValue(side, value) {
    const edit = currentPageEdit();
    edit.crop[side] = value;
    normalizeCrop(edit.crop, side);
    syncEditControls();
    renderPageEditor();
  }

  function canShowCropOverlay() {
    return activeTool === 'edit' && !!state.pdfDoc && activePageCount() > 0 && !!pageEditorCanvas.width;
  }

  function updateCropOverlay() {
    if (!cropOverlay || !cropBox) return;
    if (!canShowCropOverlay()) {
      cropOverlay.hidden = true;
      return;
    }
    const edit = currentPageEdit();
    normalizeCrop(edit.crop);
    const left = edit.crop.left;
    const top = edit.crop.top;
    const right = edit.crop.right;
    const bottom = edit.crop.bottom;
    const width = Math.max(12, 100 - left - right);
    const height = Math.max(12, 100 - top - bottom);
    cropOverlay.hidden = false;
    cropOverlay.style.setProperty('--crop-left', left + '%');
    cropOverlay.style.setProperty('--crop-top', top + '%');
    cropOverlay.style.setProperty('--crop-right', right + '%');
    cropOverlay.style.setProperty('--crop-bottom', bottom + '%');
    cropBox.style.left = left + '%';
    cropBox.style.top = top + '%';
    cropBox.style.width = width + '%';
    cropBox.style.height = height + '%';
  }

  function cropChangedSides(handle) {
    if (handle === 'move') return [];
    const sides = [];
    if (handle.includes('w')) sides.push('left');
    if (handle.includes('e')) sides.push('right');
    if (handle.includes('n')) sides.push('top');
    if (handle.includes('s')) sides.push('bottom');
    return sides;
  }

  function cropFromPointer(handle, dxPct, dyPct) {
    const start = cropDrag.startCrop;
    const crop = { ...start };
    if (handle === 'move') {
      const dx = clampCropValue(dxPct, -start.left, start.right);
      const dy = clampCropValue(dyPct, -start.top, start.bottom);
      crop.left = start.left + dx;
      crop.right = start.right - dx;
      crop.top = start.top + dy;
      crop.bottom = start.bottom - dy;
      normalizeCrop(crop);
      return crop;
    }

    if (handle.includes('w')) crop.left = clampCropValue(start.left + dxPct, 0, 88 - start.right);
    if (handle.includes('e')) crop.right = clampCropValue(start.right - dxPct, 0, 88 - start.left);
    if (handle.includes('n')) crop.top = clampCropValue(start.top + dyPct, 0, 88 - start.bottom);
    if (handle.includes('s')) crop.bottom = clampCropValue(start.bottom - dyPct, 0, 88 - start.top);
    normalizeCrop(crop, cropChangedSides(handle));
    return crop;
  }

  function updateCropDrag(e, final = false) {
    if (!cropDrag.active || e.pointerId !== cropDrag.pointerId || !cropDrag.overlayRect) return;
    const dxPct = ((e.clientX - cropDrag.startX) / cropDrag.overlayRect.width) * 100;
    const dyPct = ((e.clientY - cropDrag.startY) / cropDrag.overlayRect.height) * 100;
    const edit = currentPageEdit();
    edit.crop = cropFromPointer(cropDrag.handle, dxPct, dyPct);
    syncCropLabels(edit);
    resetEditBtn.disabled = !isPageEdited(edit);
    proofMeta.textContent = 'page ' + state.curPage + '/' + activePageCount() + ' · ' + editedLabel(edit);
    if (final) renderPageEditor();
  }

  function beginCropDrag(e) {
    if (!canShowCropOverlay() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = e.target.closest('[data-crop-handle]');
    if (!target || !cropOverlay.contains(target)) return;
    const rect = cropOverlay.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const edit = currentPageEdit();
    cropDrag.active = true;
    cropDrag.handle = target.dataset.cropHandle || 'move';
    cropDrag.pointerId = e.pointerId;
    cropDrag.startX = e.clientX;
    cropDrag.startY = e.clientY;
    cropDrag.startCrop = { ...edit.crop };
    cropDrag.overlayRect = rect;
    cropOverlay.classList.add('dragging');
    cropOverlay.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  function finishCropDrag(e) {
    if (!cropDrag.active || e.pointerId !== cropDrag.pointerId) return;
    updateCropDrag(e, true);
    cropOverlay.classList.remove('dragging');
    if (cropOverlay.hasPointerCapture(e.pointerId)) cropOverlay.releasePointerCapture(e.pointerId);
    cropDrag.active = false;
    cropDrag.handle = null;
    cropDrag.pointerId = null;
    cropDrag.startCrop = null;
    cropDrag.overlayRect = null;
    e.preventDefault();
    e.stopPropagation();
  }

  async function renderEditedColorPreviewToCanvas(sourceIndex, edit, canvas, includeCrop = true) {
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = getRasterPreviewScale(baseVp);
    const vp = page.getViewport({ scale });
    const base = document.createElement('canvas');
    base.width = Math.max(1, Math.floor(vp.width));
    base.height = Math.max(1, Math.floor(vp.height));
    const bctx = base.getContext('2d');
    bctx.fillStyle = '#fff';
    bctx.fillRect(0, 0, base.width, base.height);
    await page.render({ canvasContext: bctx, viewport: vp }).promise;

    const e = clonePageEdit(edit);
    if (!includeCrop) e.crop = { left: 0, top: 0, right: 0, bottom: 0 };
    const cropLeft = Math.round(base.width * e.crop.left / 100);
    const cropTop = Math.round(base.height * e.crop.top / 100);
    const cropRight = Math.round(base.width * e.crop.right / 100);
    const cropBottom = Math.round(base.height * e.crop.bottom / 100);
    const cropW = Math.max(1, base.width - cropLeft - cropRight);
    const cropH = Math.max(1, base.height - cropTop - cropBottom);
    const crop = document.createElement('canvas');
    crop.width = cropW;
    crop.height = cropH;
    const cctx = crop.getContext('2d');
    cctx.fillStyle = '#fff';
    cctx.fillRect(0, 0, cropW, cropH);
    cctx.drawImage(base, cropLeft, cropTop, cropW, cropH, 0, 0, cropW, cropH);

    const angle = editAngle(e) * Math.PI / 180;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const outW = Math.ceil(cropW * cos + cropH * sin);
    const outH = Math.ceil(cropW * sin + cropH * cos);
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(angle);
    ctx.drawImage(crop, -cropW / 2, -cropH / 2);

    base.width = 0;
    base.height = 0;
    crop.width = 0;
    crop.height = 0;
    return { w: outW, h: outH };
  }

  let editedPreviewRenderToken = 0;

  async function drawEditedPagePreview() {
    const sourceIndex = currentSourceIndex();
    const token = ++editedPreviewRenderToken;
    if (sourceIndex == null || !state.pdfDoc) return;
    const tmp = document.createElement('canvas');
    const size = await renderEditedColorPreviewToCanvas(sourceIndex, currentPageEdit(), tmp, false);
    if (!size || token !== editedPreviewRenderToken || sourceIndex !== currentSourceIndex() || activeTool !== 'edit') {
      tmp.width = 0;
      tmp.height = 0;
      return;
    }
    pageEditorCanvas.width = tmp.width;
    pageEditorCanvas.height = tmp.height;
    const ctx = pageEditorCanvas.getContext('2d');
    ctx.clearRect(0, 0, pageEditorCanvas.width, pageEditorCanvas.height);
    ctx.drawImage(tmp, 0, 0);
    tmp.width = 0;
    tmp.height = 0;
    pageEditorCanvasWrap.style.display = 'block';
    proofMeta.textContent = 'page ' + state.curPage + '/' + activePageCount() + ' · ' + editedLabel(currentPageEdit());
    applyZoom({ preserveCenter: false });
    updateCropOverlay();
  }

  async function renderEditedPageImageToCanvas(sourceIndex, edit, canvas) {
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    const pd = state.pages[sourceIndex];
    const baseScale = hasFineRotation(edit)
      ? Math.max(pd?.scale || 0, fineRotationExportDpi() / 72)
      : (pd?.scale || getRenderScale(page.getViewport({ scale: 1 })));
    const vp = page.getViewport({ scale: baseScale });
    const base = document.createElement('canvas');
    base.width = Math.floor(vp.width);
    base.height = Math.floor(vp.height);
    const bctx = base.getContext('2d');
    bctx.fillStyle = '#fff';
    bctx.fillRect(0, 0, base.width, base.height);
    await page.render({ canvasContext: bctx, viewport: vp }).promise;

    const e = clonePageEdit(edit);
    const cropLeft = Math.round(base.width * e.crop.left / 100);
    const cropTop = Math.round(base.height * e.crop.top / 100);
    const cropRight = Math.round(base.width * e.crop.right / 100);
    const cropBottom = Math.round(base.height * e.crop.bottom / 100);
    const cropW = Math.max(1, base.width - cropLeft - cropRight);
    const cropH = Math.max(1, base.height - cropTop - cropBottom);
    const crop = document.createElement('canvas');
    crop.width = cropW;
    crop.height = cropH;
    const cctx = crop.getContext('2d');
    cctx.fillStyle = '#fff';
    cctx.fillRect(0, 0, cropW, cropH);
    cctx.drawImage(base, cropLeft, cropTop, cropW, cropH, 0, 0, cropW, cropH);

    const angle = editAngle(e) * Math.PI / 180;
    const cos = Math.abs(Math.cos(angle));
    const sin = Math.abs(Math.sin(angle));
    const outW = Math.ceil(cropW * cos + cropH * sin);
    const outH = Math.ceil(cropW * sin + cropH * cos);
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(angle);
    ctx.drawImage(crop, -cropW / 2, -cropH / 2);
    return { wPt: outW / baseScale, hPt: outH / baseScale };
  }

  const organizerDrag = {
    active: false,
    sourceOutputIndex: null,
    sourcePageIndex: null,
    sourceFlowIndex: null,
    insertIndex: null,
    clone: null,
    offsetX: 0,
    offsetY: 0,
  };

  function buildOrganizerFlow() {
    normalizeSplitState();
    const flow = [];
    let splitCursor = 0;
    for (let pageIndex = 0; pageIndex <= state.pageOrder.length; pageIndex++) {
      while (splitCursor < state.splitPoints.length && state.splitPoints[splitCursor] === pageIndex) {
        flow.push({ type: 'split', splitIndex: splitCursor });
        splitCursor += 1;
      }
      if (pageIndex < state.pageOrder.length) {
        flow.push({ type: 'page', sourceIndex: state.pageOrder[pageIndex] });
      }
    }
    return flow;
  }

  function applyOrganizerFlow(flow) {
    const nextOrder = [];
    const nextSplitPoints = [];
    flow.forEach(item => {
      if (item.type === 'page') {
        nextOrder.push(item.sourceIndex);
      } else if (item.type === 'split') {
        nextSplitPoints.push(nextOrder.length);
      }
    });
    state.pageOrder = nextOrder;
    state.splitPoints = nextSplitPoints;
    normalizeSplitState();
  }

  function captureOrganizerRects() {
    const rects = new Map();
    if (!organizerGrid) return rects;
    organizerGrid.querySelectorAll('.page-card[data-source-index], .page-placeholder, .page-split-divider').forEach(el => {
      const key = el.classList.contains('page-placeholder')
        ? '__placeholder__'
        : el.classList.contains('page-split-divider')
          ? '__split_' + el.dataset.splitIndex
        : el.dataset.sourceIndex;
      rects.set(key, el.getBoundingClientRect());
    });
    return rects;
  }

  function animateOrganizerFrom(firstRects) {
    if (!firstRects || !firstRects.size || !organizerGrid) return;
    const moving = [];
    organizerGrid.querySelectorAll('.page-card[data-source-index], .page-placeholder, .page-split-divider').forEach(el => {
      const key = el.classList.contains('page-placeholder')
        ? '__placeholder__'
        : el.classList.contains('page-split-divider')
          ? '__split_' + el.dataset.splitIndex
        : el.dataset.sourceIndex;
      const first = firstRects.get(key);
      if (!first) return;
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
      moving.push(el);
    });
    if (!moving.length) return;
    organizerGrid.getBoundingClientRect();
    requestAnimationFrame(() => {
      moving.forEach(el => {
        let cleared = false;
        const clear = () => {
          if (cleared) return;
          cleared = true;
          el.style.transition = '';
          el.removeEventListener('transitionend', clear);
        };
        el.addEventListener('transitionend', clear, { once: true });
        setTimeout(clear, 260);
        el.style.transition = 'transform .2s cubic-bezier(.2, .8, .2, 1), box-shadow .16s, opacity .16s';
        el.style.transform = '';
      });
    });
  }

  function rerenderOrganizerAnimated() {
    const firstRects = captureOrganizerRects();
    renderOrganizer();
    animateOrganizerFrom(firstRects);
  }

  function renderOrganizer() {
    if (!organizerGrid || activeTool !== 'organize') return;
    organizerGrid.innerHTML = '';
    const count = activePageCount();
    organizerEmpty.classList.toggle('on', !state.pdfDoc || count === 0);
    organizerEmpty.textContent = state.pdfDoc
      ? 'All pages have been removed. Restore the original order to continue.'
      : 'Upload a PDF to organize pages.';
    if (!state.pdfDoc || count === 0) return;

    const isDragging = organizerDrag.active;
    const flow = buildOrganizerFlow();
    const visibleFlow = isDragging
      ? flow.filter(item => item.type !== 'page' || item.sourceIndex !== organizerDrag.sourcePageIndex)
      : flow;
    const hasInsertSlot = isDragging && organizerDrag.insertIndex != null;
    const insertIndex = hasInsertSlot
      ? Math.max(0, Math.min(organizerDrag.insertIndex, visibleFlow.length))
      : -1;

    for (let slot = 0; slot <= visibleFlow.length; slot++) {
      if (hasInsertSlot && slot === insertIndex) {
        const placeholder = document.createElement('div');
        placeholder.className = 'page-card page-placeholder';
        const marker = document.createElement('div');
        marker.className = 'page-insert-marker';
        placeholder.appendChild(marker);
        organizerGrid.appendChild(placeholder);
      }
      if (slot === visibleFlow.length) break;
      const item = visibleFlow[slot];
      if (item.type === 'split') {
        appendSplitDivider(item.splitIndex, slot);
        continue;
      }
      const sourceIndex = item.sourceIndex;
      const outputIndex = state.pageOrder.indexOf(sourceIndex);
      const card = document.createElement('div');
      card.className = 'page-card organizer-flow-item';
      card.dataset.flowIndex = slot;
      card.dataset.outputIndex = outputIndex;
      card.dataset.sourceIndex = sourceIndex;

      card.appendChild(createPageThumb(sourceIndex, 'Original page ' + (sourceIndex + 1)));

      const actions = document.createElement('div');
      actions.className = 'page-card-actions';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'page-delete';
      del.setAttribute('aria-label', 'Delete original page ' + (sourceIndex + 1));
      del.textContent = '×';
      del.addEventListener('pointerdown', e => e.stopPropagation());
      del.addEventListener('click', e => {
        e.stopPropagation();
        deleteOutputPage(outputIndex);
      });
      const canSplit = outputIndex >= 0 && outputIndex < count - 1;
      const boundary = outputIndex + 1;
      const splitExists = canSplit && state.splitPoints.includes(boundary);
      const split = document.createElement('button');
      split.type = 'button';
      split.className = 'page-split-toggle';
      split.disabled = !canSplit;
      split.textContent = 'Split';
      split.setAttribute('aria-pressed', splitExists ? 'true' : 'false');
      split.setAttribute('aria-label', canSplit
        ? (splitExists ? 'Remove split after original page ' : 'Split after original page ') + (sourceIndex + 1)
        : 'Cannot split after the final page');
      split.addEventListener('pointerdown', e => e.stopPropagation());
      split.addEventListener('click', e => {
        e.stopPropagation();
        toggleSplitAfter(outputIndex);
      });
      const num = document.createElement('div');
      num.className = 'page-number';
      num.textContent = sourceIndex + 1;
      actions.appendChild(del);
      actions.appendChild(split);
      actions.appendChild(num);
      card.appendChild(actions);

      card.addEventListener('pointerdown', e => beginOrganizerDrag(e, card, sourceIndex));

      organizerGrid.appendChild(card);
    }
  }

  function appendSplitDivider(splitIndex, flowIndex) {
    const divider = document.createElement('div');
    divider.className = 'page-split-divider organizer-flow-item';
    divider.dataset.flowIndex = flowIndex;
    divider.dataset.splitIndex = splitIndex;
    const label = document.createElement('span');
    label.className = 'page-split-label';
    label.append('Split ' + (splitIndex + 1));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'page-split-remove';
    remove.setAttribute('aria-label', 'Remove split ' + (splitIndex + 1));
    remove.textContent = '×';
    remove.addEventListener('pointerdown', e => e.stopPropagation());
    remove.addEventListener('click', e => {
      e.stopPropagation();
      removeSplit(splitIndex);
    });
    label.appendChild(remove);
    divider.appendChild(label);
    organizerGrid.appendChild(divider);
  }

  function positionPageContextMenu(x, y) {
    pageContextMenu.hidden = false;
    pageContextMenu.style.left = x + 'px';
    pageContextMenu.style.top = y + 'px';
    const rect = pageContextMenu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 10);
    const top = Math.min(y, window.innerHeight - rect.height - 10);
    pageContextMenu.style.left = Math.max(10, left) + 'px';
    pageContextMenu.style.top = Math.max(10, top) + 'px';
  }

  function hidePageContextMenu() {
    pageContextMenu.hidden = true;
    contextMenuState.outputIndex = null;
    contextMenuState.sourceIndex = null;
  }

  function showPageContextMenu(e, outputIndex, sourceIndex) {
    if (!state.pdfDoc || activeTool !== 'organize' || organizerDrag.active) return;
    e.preventDefault();
    e.stopPropagation();
    normalizeSplitState();
    contextMenuState.outputIndex = outputIndex;
    contextMenuState.sourceIndex = sourceIndex;
    const canSplit = outputIndex >= 0 && outputIndex < activePageCount() - 1;
    const boundary = outputIndex + 1;
    const splitExists = state.splitPoints.includes(boundary);
    contextSplitBtn.disabled = !canSplit;
    contextSplitBtn.textContent = canSplit
      ? (splitExists ? 'Remove split after page ' : 'Split after page ') + (sourceIndex + 1)
      : 'Cannot split after final page';
    positionPageContextMenu(e.clientX, e.clientY);
  }

  organizerGrid.addEventListener('contextmenu', e => {
    const card = e.target.closest('.page-card[data-source-index]');
    if (!card || !organizerGrid.contains(card)) return;
    showPageContextMenu(e, Number(card.dataset.outputIndex), Number(card.dataset.sourceIndex));
  }, true);

  function toggleSplitAfter(outputIndex) {
    if (!state.pdfDoc || typeof outputIndex !== 'number' || outputIndex < 0 || outputIndex >= activePageCount() - 1) return;
    normalizeSplitState();
    const boundary = outputIndex + 1;
    const existingIndex = state.splitPoints.indexOf(boundary);
    if (existingIndex >= 0) {
      state.splitPoints.splice(existingIndex, 1);
      state.splitNames.splice(existingIndex + 1, 1);
    } else {
      const insertAt = state.splitPoints.findIndex(point => point > boundary);
      const pointIndex = insertAt === -1 ? state.splitPoints.length : insertAt;
      while (state.splitNames.length < state.splitPoints.length + 1) {
        state.splitNames.push(defaultSplitName(state.splitNames.length));
      }
      state.splitPoints.splice(pointIndex, 0, boundary);
      state.splitNames.splice(pointIndex + 1, 0, defaultSplitName(pointIndex + 1));
    }
    updatePageState();
  }

  function removeSplit(splitIndex) {
    normalizeSplitState();
    if (splitIndex < 0 || splitIndex >= state.splitPoints.length) return;
    state.splitPoints.splice(splitIndex, 1);
    state.splitNames.splice(splitIndex + 1, 1);
    updatePageState();
  }

  function beginOrganizerDrag(e, card, sourceIndex) {
    if (!state.pdfDoc || organizerDrag.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('.page-delete, .page-split-toggle')) return;
    hidePageContextMenu();
    const outputIndex = state.pageOrder.indexOf(sourceIndex);
    if (outputIndex < 0) return;
    const sourceFlowIndex = buildOrganizerFlow().findIndex(item =>
      item.type === 'page' && item.sourceIndex === sourceIndex);
    const rect = card.getBoundingClientRect();
    const clone = card.cloneNode(true);
    clone.classList.add('page-drag-clone');
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    clone.querySelectorAll('button').forEach(button => button.tabIndex = -1);
    document.body.appendChild(clone);

    organizerDrag.active = true;
    organizerDrag.sourceOutputIndex = outputIndex;
    organizerDrag.sourcePageIndex = sourceIndex;
    organizerDrag.sourceFlowIndex = sourceFlowIndex;
    organizerDrag.insertIndex = null;
    organizerDrag.clone = clone;
    organizerDrag.offsetX = e.clientX - rect.left;
    organizerDrag.offsetY = e.clientY - rect.top;

    moveOrganizerClone(e.clientX, e.clientY);
    window.addEventListener('pointermove', onOrganizerPointerMove, { passive: false });
    window.addEventListener('pointerup', finishOrganizerDrag, { once: true });
    window.addEventListener('pointercancel', cancelOrganizerDrag, { once: true });
    e.preventDefault();
    rerenderOrganizerAnimated();
  }

  function moveOrganizerClone(x, y) {
    if (!organizerDrag.clone) return;
    organizerDrag.clone.style.transform = 'translate3d(' +
      (x - organizerDrag.offsetX) + 'px, ' +
      (y - organizerDrag.offsetY) + 'px, 0) scale(1.02)';
  }

  function organizerRows() {
    const items = Array.from(organizerGrid.querySelectorAll('.organizer-flow-item'));
    const rows = [];
    items.forEach(el => {
      const rect = el.getBoundingClientRect();
      const flowIndex = Number(el.dataset.flowIndex);
      const fullWidth = el.classList.contains('page-split-divider');
      let row = fullWidth ? null : rows.find(item => !item.fullWidth && Math.abs(item.top - rect.top) < 28);
      if (!row) {
        row = { top: rect.top, bottom: rect.bottom, fullWidth, items: [] };
        rows.push(row);
      }
      row.top = Math.min(row.top, rect.top);
      row.bottom = Math.max(row.bottom, rect.bottom);
      row.items.push({ index: flowIndex, rect, fullWidth });
    });
    rows.sort((a, b) => a.top - b.top);
    rows.forEach(row => row.items.sort((a, b) => a.rect.left - b.rect.left));
    return rows;
  }

  function getOrganizerInsertIndex(x, y) {
    const rows = organizerRows();
    if (!rows.length) return 0;
    if (y < rows[0].top) return 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nextRow = rows[i + 1];
      const rowBreak = nextRow ? row.bottom + ((nextRow.top - row.bottom) / 2) : Infinity;
      if (y <= rowBreak) {
        if (row.fullWidth) {
          const item = row.items[0];
          return y < item.rect.top + item.rect.height / 2 ? item.index : item.index + 1;
        }
        for (const item of row.items) {
          if (x < item.rect.left + item.rect.width / 2) return item.index;
        }
        return row.items[row.items.length - 1].index + 1;
      }
    }
    return rows[rows.length - 1].items.at(-1).index + 1;
  }

  function onOrganizerPointerMove(e) {
    if (!organizerDrag.active) return;
    e.preventDefault();
    moveOrganizerClone(e.clientX, e.clientY);
    const nextIndex = getOrganizerInsertIndex(e.clientX, e.clientY);
    if (nextIndex !== organizerDrag.insertIndex) {
      organizerDrag.insertIndex = nextIndex;
      rerenderOrganizerAnimated();
    }
  }

  function cleanupOrganizerDrag() {
    window.removeEventListener('pointermove', onOrganizerPointerMove);
    if (organizerDrag.clone) organizerDrag.clone.remove();
    organizerDrag.active = false;
    organizerDrag.sourceOutputIndex = null;
    organizerDrag.sourcePageIndex = null;
    organizerDrag.sourceFlowIndex = null;
    organizerDrag.insertIndex = null;
    organizerDrag.clone = null;
  }

  function finishOrganizerDrag() {
    if (!organizerDrag.active) return;
    const firstRects = captureOrganizerRects();
    const sourceIndex = organizerDrag.sourcePageIndex;
    const nextFlow = buildOrganizerFlow().filter(item =>
      item.type !== 'page' || item.sourceIndex !== sourceIndex);
    const insertionIndex = organizerDrag.insertIndex == null
      ? Math.max(0, Math.min(organizerDrag.sourceFlowIndex ?? 0, nextFlow.length))
      : Math.max(0, Math.min(organizerDrag.insertIndex, nextFlow.length));
    cleanupOrganizerDrag();
    nextFlow.splice(insertionIndex, 0, { type: 'page', sourceIndex });
    applyOrganizerFlow(nextFlow);
    state.curPage = state.pageOrder.indexOf(sourceIndex) + 1;
    updatePageState();
    animateOrganizerFrom(firstRects);
    if (activeTool !== 'organize') requestPreviewRender(isRasterTool(activeTool));
  }

  function cancelOrganizerDrag() {
    if (!organizerDrag.active) return;
    const firstRects = captureOrganizerRects();
    cleanupOrganizerDrag();
    renderOrganizer();
    animateOrganizerFrom(firstRects);
  }

  function deleteOutputPage(outputIndex) {
    if (!state.pdfDoc || outputIndex < 0 || outputIndex >= activePageCount()) return;
    hidePageContextMenu();
    const sourceIndex = state.pageOrder[outputIndex];
    const nextFlow = buildOrganizerFlow().filter(item =>
      item.type !== 'page' || item.sourceIndex !== sourceIndex);
    applyOrganizerFlow(nextFlow);
    if (state.curPage > activePageCount()) state.curPage = Math.max(1, activePageCount());
    updatePageState();
    if (activeTool !== 'organize') requestPreviewRender(isRasterTool(activeTool));
  }

  async function exportPageOrderAsPdf(pageOrder, fileBase) {
    if (!window.PDFLib) throw new Error('PDF library did not load. Check your connection and try again.');
    if (!state.pdfBytes) throw new Error('Original PDF data is not available.');
    if (!pageOrder.length) throw new Error('There are no pages to export.');
    const src = await PDFLib.PDFDocument.load(state.pdfBytes);
    const out = await PDFLib.PDFDocument.create();
    const copiedPages = await out.copyPages(src, pageOrder);
    copiedPages.forEach(page => out.addPage(page));
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanDownloadBase(fileBase, outputBaseName()) + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportOrganizedPdf(pageOrder = state.pageOrder, fileBase = outputBaseName() + TOOLS.organize.suffix) {
    await exportPageOrderAsPdf(pageOrder, fileBase);
  }

  function applyVectorPageEdit(page, edit) {
    const e = clonePageEdit(edit);
    const width = page.getWidth();
    const height = page.getHeight();
    const cropLeft = width * e.crop.left / 100;
    const cropRight = width * e.crop.right / 100;
    const cropTop = height * e.crop.top / 100;
    const cropBottom = height * e.crop.bottom / 100;
    const cropW = Math.max(1, width - cropLeft - cropRight);
    const cropH = Math.max(1, height - cropTop - cropBottom);
    if (e.crop.left || e.crop.top || e.crop.right || e.crop.bottom) {
      page.setCropBox(cropLeft, cropBottom, cropW, cropH);
    }
    if (e.quarterTurns) {
      const currentRotation = page.getRotation().angle || 0;
      page.setRotation(PDFLib.degrees((currentRotation + e.quarterTurns * 90) % 360));
    }
  }

  async function exportEditedPdf(pageOrder = state.pageOrder, fileBase = outputBaseName() + TOOLS.edit.suffix) {
    if (!window.PDFLib) throw new Error('PDF library did not load. Check your connection and try again.');
    if (!state.pdfBytes) throw new Error('Original PDF data is not available.');
    if (!pageOrder.length) throw new Error('There are no pages to export.');
    const src = await PDFLib.PDFDocument.load(state.pdfBytes);
    const out = await PDFLib.PDFDocument.create();
    const count = pageOrder.length;
    for (let i = 0; i < count; i++) {
      setLoader(true, 'Exporting edited page ' + (i + 1) + ' of ' + count, (i / count) * 100);
      const sourceIndex = pageOrder[i];
      const edit = clonePageEdit(state.pageEdits[sourceIndex]);
      if (hasFineRotation(edit)) {
        setLoader(true, 'Rasterizing fine rotation at ' + fineRotationExportDpi() + ' dpi · page ' + (i + 1) + ' of ' + count, (i / count) * 100);
      }
      if (!isPageEdited(edit)) {
        const [copied] = await out.copyPages(src, [sourceIndex]);
        out.addPage(copied);
        continue;
      }

      if (!hasFineRotation(edit)) {
        const [copied] = await out.copyPages(src, [sourceIndex]);
        applyVectorPageEdit(copied, edit);
        out.addPage(copied);
        continue;
      }

      const canvas = document.createElement('canvas');
      const size = await renderEditedPageImageToCanvas(sourceIndex, edit, canvas);
      const image = await out.embedPng(canvas.toDataURL('image/png'));
      const page = out.addPage([size.wPt, size.hPt]);
      page.drawImage(image, { x: 0, y: 0, width: size.wPt, height: size.hPt });
      await new Promise(r => setTimeout(r, 0));
    }
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanDownloadBase(fileBase, outputBaseName()) + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportSplitPart(partIndex) {
    const part = splitParts()[partIndex];
    if (!part || !part.pageOrder.length) return;
    splitPartsList.querySelectorAll('button').forEach(button => { button.disabled = true; });
    setLoader(true, 'Exporting part ' + (partIndex + 1) + '…', 35);
    try {
      await exportPageOrderAsPdf(part.pageOrder, part.name || defaultSplitName(partIndex));
      setLoader(false);
    } catch (err) {
      console.error(err);
      showError('Split export failed: ' + (err.message || err));
      setLoader(false);
    } finally {
      updatePageState();
    }
  }

  // ── Threshold controls ──
  threshSlider.addEventListener('input', e => {
    const v = +e.target.value;
    state.threshold = v;
    threshNum.textContent = v;
    threshPct.textContent = Math.round((v / 255) * 100) + '%';
    threshHint.textContent = threshHintText(v);
    threshNeedle.style.left = ((v / 255) * 100) + '%';
    if (state.pdfDoc) requestPreviewRender(false);
  });
  invertToggle.addEventListener('click', () => {
    state.invert = !state.invert;
    setTogglePressed(invertToggle, state.invert);
    if (state.pdfDoc) requestPreviewRender(false);
  });

  // ── Greyscale controls ──
  brightSlider.addEventListener('input', e => {
    const v = +e.target.value;
    state.brightness = v;
    brightNum.textContent = v > 0 ? '+' + v : String(v);
    brightTag.textContent = v < -50 ? 'dark' : v < -10 ? 'reduced' : v <= 10 ? 'neutral' : v <= 50 ? 'bright' : 'maximum';
    $('greyHint').textContent = greyHintText();
    if (state.pdfDoc) requestPreviewRender(false);
  });
  contrastSlider.addEventListener('input', e => {
    const v = +e.target.value;
    state.contrast = v;
    contrastNum.textContent = v;
    contrastTag.textContent = contrastHintText(v);
    $('greyHint').textContent = greyHintText();
    if (state.pdfDoc) requestPreviewRender(false);
  });
  greyInvertToggle.addEventListener('click', () => {
    state.greyInvert = !state.greyInvert;
    setTogglePressed(greyInvertToggle, state.greyInvert);
    $('greyHint').textContent = greyHintText();
    if (state.pdfDoc) requestPreviewRender(false);
  });
  sepiaToggle.addEventListener('click', () => {
    state.sepia = !state.sepia;
    setTogglePressed(sepiaToggle, state.sepia);
    $('greyHint').textContent = greyHintText();
    if (state.pdfDoc) requestPreviewRender(false);
  });

  function setFineRotation(value) {
    if (!state.pdfDoc) return;
    const edit = currentPageEdit();
    edit.fineRotation = Math.round((+value || 0) * 10) / 10;
    syncEditControls();
    requestEditedPreviewRender();
  }

  function rotateSelectedPage90(delta) {
    if (!state.pdfDoc) return;
    const edit = currentPageEdit();
    edit.quarterTurns = (edit.quarterTurns + delta + 4) % 4;
    syncEditControls();
    renderPageEditor();
    drawEditedPagePreview();
  }

  editRotateSlider.addEventListener('input', e => setFineRotation(e.target.value));
  bottomRotateSlider.addEventListener('input', e => setFineRotation(e.target.value));

  rotateLeftBtn.addEventListener('click', () => rotateSelectedPage90(-1));
  bottomRotateLeftBtn.addEventListener('click', () => rotateSelectedPage90(-1));

  rotateRightBtn.addEventListener('click', () => rotateSelectedPage90(1));
  bottomRotateRightBtn.addEventListener('click', () => rotateSelectedPage90(1));

  cropOverlay.addEventListener('pointerdown', beginCropDrag);
  cropOverlay.addEventListener('pointermove', e => {
    if (!cropDrag.active || e.pointerId !== cropDrag.pointerId) return;
    updateCropDrag(e);
    e.preventDefault();
    e.stopPropagation();
  });
  cropOverlay.addEventListener('pointerup', finishCropDrag);
  cropOverlay.addEventListener('pointercancel', finishCropDrag);

  fineQualityToggle.addEventListener('click', () => {
    state.fineRotationQuality = state.fineRotationQuality === 'ultra' ? 'high' : 'ultra';
    syncFineQualityToggle();
  });

  resetEditBtn.addEventListener('click', () => {
    const sourceIndex = currentSourceIndex();
    if (sourceIndex == null) return;
    state.pageEdits[sourceIndex] = defaultPageEdit();
    syncEditControls();
    renderPageEditor();
    drawEditedPagePreview();
  });

  contextSplitBtn.addEventListener('click', () => {
    const outputIndex = contextMenuState.outputIndex;
    hidePageContextMenu();
    toggleSplitAfter(outputIndex);
  });

  clearSplitBtn.addEventListener('click', () => {
    state.splitPoints = [];
    state.splitNames = [];
    updatePageState();
  });

  document.addEventListener('click', e => {
    if (!pageContextMenu.hidden && !pageContextMenu.contains(e.target)) hidePageContextMenu();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hidePageContextMenu();
  });

  window.addEventListener('scroll', hidePageContextMenu, true);

  resetPagesBtn.addEventListener('click', () => {
    if (!state.pdfDoc) return;
    hidePageContextMenu();
    state.pageOrder = Array.from({ length: state.numPages }, (_, i) => i);
    state.curPage = 1;
    updatePageState();
    if (activeTool === 'edit') { syncEditControls(); requestEditedPreviewRender(); }
    else if (activeTool !== 'organize') requestPreviewRender(isRasterTool(activeTool));
  });

  // ── Resolution toggles ──
  const resButtons = { fast: $('resFast'), '300': $('res300'), '600': $('res600') };
  const resLabels  = { fast: 'Rendering page ', '300': 'Rendering at 300 dpi · page ', '600': 'Rendering at 600 dpi · page ' };

  function syncResolutionToggles() {
    Object.entries(resButtons).forEach(([key, btn]) => setTogglePressed(btn, state.resolution === key));
  }

  Object.entries(resButtons).forEach(([key, btn]) => {
    btn.addEventListener('click', async () => {
      if (state.resolution === key) return;
      state.resolution = key;
      syncResolutionToggles();
      if (!state.pdfDoc) return;
      if (state.largePdfSafeMode) {
        forgetFullPageData();
        setLoader(true, 'Resolution set · rendering current page…', 35);
        if (isRasterTool(activeTool)) {
          await ensureRasterPreviewData(currentSourceIndex());
        } else if (activeTool === 'edit') {
          await ensurePageData(currentSourceIndex());
        }
      } else {
        state.pages = new Array(state.numPages).fill(null);
        for (let i = 1; i <= state.numPages; i++) {
          setLoader(true, resLabels[key] + i + ' / ' + state.numPages, ((i - 1) / state.numPages) * 100);
          await renderPageToLuminance(i);
        }
      }
      updatePageState();
      if (activeTool === 'edit') { syncEditControls(); requestEditedPreviewRender(); }
      else if (activeTool !== 'organize') requestPreviewRender(isRasterTool(activeTool));
      setLoader(false);
    });
  });

  // ── Page nav ──
  function updatePageButtons() {
    updatePageState();
  }
  prevBtn.addEventListener('click', () => {
    if (state.curPage > 1) {
      state.curPage--;
      updatePageButtons();
      if (activeTool === 'edit') { syncEditControls(); requestEditedPreviewRender(); }
      else requestPreviewRender(isRasterTool(activeTool));
    }
  });
  nextBtn.addEventListener('click', () => {
    if (state.curPage < activePageCount()) {
      state.curPage++;
      updatePageButtons();
      if (activeTool === 'edit') { syncEditControls(); requestEditedPreviewRender(); }
      else requestPreviewRender(isRasterTool(activeTool));
    }
  });

  // ── Download ──
  downloadBtn.addEventListener('click', async () => {
    if (activeTool === 'preview') return;
    if (activeTool === 'merge') {
      await mergeSelectedPdfs();
      return;
    }
    if (!state.pdfDoc || activePageCount() === 0) return;
    if (advancedPasswordToggle.checked && canPasswordProtectExport() && !advancedPasswordValue()) {
      showError('Enter a password before exporting a locked PDF.');
      advancedPasswordInput.focus();
      return;
    }
    const exportOrder = selectedExportPageOrder();
    if (!exportOrder.length) return;
    downloadBtn.disabled = true;
    setLoader(true, 'Exporting pages…', 0);
    try {
      if (activeTool === 'organize') {
        setLoader(true, 'Exporting original pages…', 35);
        await exportOrganizedPdf(exportOrder, exportBaseNameForTool('organize'));
        setLoader(false);
        return;
      }
      if (activeTool === 'edit') {
        setLoader(true, 'Exporting page edits…', 15);
        await exportEditedPdf(exportOrder, exportBaseNameForTool('edit'));
        setLoader(false);
        return;
      }
      const { jsPDF } = window.jspdf;
      const tmp = document.createElement('canvas');
      let pdf = null;
      const count = exportOrder.length;
      for (let i = 0; i < count; i++) {
        setLoader(true, 'Exporting page ' + (i + 1) + ' of ' + count, (i / count) * 100);
        const pd = await ensurePageData(exportOrder[i]);
        if (!pd) throw new Error('Could not render page ' + (i + 1));
        if (processTool === 'threshold') applyThresholdToCanvas(pd, tmp);
        else applyGreyscaleToCanvas(pd, tmp);
        const wPt = pd.w / pd.scale;
        const hPt = pd.h / pd.scale;
        const orient = wPt > hPt ? 'l' : 'p';
        const dataUrl = tmp.toDataURL('image/png');
        if (i === 0) pdf = new jsPDF(jsPdfExportOptions({ orientation: orient, unit: 'pt', format: [wPt, hPt] }));
        else pdf.addPage([wPt, hPt], orient);
        pdf.addImage(dataUrl, 'PNG', 0, 0, wPt, hPt, undefined, 'FAST');
        tmp.width = 0;
        tmp.height = 0;
        await new Promise(r => setTimeout(r, 0));
      }
      pdf.save(cleanDownloadBase(exportBaseNameForTool(activeTool), outputBaseName()) + '.pdf');
      setLoader(false);
    } catch (err) {
      console.error(err);
      showError('Render failed: ' + (err.message || err));
      setLoader(false);
    } finally {
      updatePageState();
    }
  });

  // ── Zoom ──
  const ZOOM_MIN = 0.25, ZOOM_MAX = 8, ZOOM_STEP = 1.25;
  let zoomLevel = 1; // 1 = largest fit without preview scrollbars

  function setZoom(z, opts) {
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    applyZoom(opts);
  }
  let previewHeightRaf = null;
  const panState = { active: false, pointerId: null, x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };

  function syncPreviewStageHeight() {
    if (previewHeightRaf) cancelAnimationFrame(previewHeightRaf);
    previewHeightRaf = requestAnimationFrame(() => {
      previewHeightRaf = null;
      const minHeight = window.matchMedia('(max-width: 900px)').matches ? 520 : 620;
      const maxHeight = window.matchMedia('(max-width: 900px)').matches ? 820 : 1100;
      const mainPanel = previewStage.closest('main');
      const stageRect = previewStage.getBoundingClientRect();
      const mainRect = mainPanel ? mainPanel.getBoundingClientRect() : null;
      const panelStyle = getComputedStyle(previewStage.parentElement);
      const panelBottomInset = parseFloat(panelStyle.paddingBottom) || 0;
      const panelBottom = mainRect ? Math.max(0, mainRect.bottom - stageRect.top - panelBottomInset) : 0;
      const viewportHeight = window.innerHeight * 0.82;
      const targetHeight = Math.max(minHeight, Math.min(maxHeight, Math.max(viewportHeight, panelBottom)));
      previewStage.style.setProperty('--preview-stage-height', Math.round(targetHeight) + 'px');
      if (state.pdfDoc) applyZoom();
    });
  }

  function getStagePadding() {
    const cs = getComputedStyle(previewStage);
    return {
      x: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
      y: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom),
    };
  }

  function getFitCanvasWidth(pd) {
    const pad = getStagePadding();
    const stageW = Math.max(1, previewStage.clientWidth - pad.x - 1);
    const stageH = Math.max(1, previewStage.clientHeight - pad.y - 1);
    const heightFitWidth = stageH * (pd.w / pd.h);
    return Math.max(1, Math.min(stageW, heightFitWidth, pd.w));
  }

  function getScrollCenter() {
    return {
      x: previewStage.scrollWidth ? (previewStage.scrollLeft + previewStage.clientWidth / 2) / previewStage.scrollWidth : 0.5,
      y: previewStage.scrollHeight ? (previewStage.scrollTop + previewStage.clientHeight / 2) / previewStage.scrollHeight : 0.5,
    };
  }

  function restoreScrollCenter(center) {
    const maxLeft = Math.max(0, previewStage.scrollWidth - previewStage.clientWidth);
    const maxTop = Math.max(0, previewStage.scrollHeight - previewStage.clientHeight);
    previewStage.scrollLeft = Math.max(0, Math.min(maxLeft, previewStage.scrollWidth * center.x - previewStage.clientWidth / 2));
    previewStage.scrollTop = Math.max(0, Math.min(maxTop, previewStage.scrollHeight * center.y - previewStage.clientHeight / 2));
  }

  function getEditorScrollCenter() {
    return {
      x: pageEditorMain.scrollWidth ? (pageEditorMain.scrollLeft + pageEditorMain.clientWidth / 2) / pageEditorMain.scrollWidth : 0.5,
      y: pageEditorMain.scrollHeight ? (pageEditorMain.scrollTop + pageEditorMain.clientHeight / 2) / pageEditorMain.scrollHeight : 0.5,
    };
  }

  function restoreEditorScrollCenter(center) {
    const maxLeft = Math.max(0, pageEditorMain.scrollWidth - pageEditorMain.clientWidth);
    const maxTop = Math.max(0, pageEditorMain.scrollHeight - pageEditorMain.clientHeight);
    pageEditorMain.scrollLeft = Math.max(0, Math.min(maxLeft, pageEditorMain.scrollWidth * center.x - pageEditorMain.clientWidth / 2));
    pageEditorMain.scrollTop = Math.max(0, Math.min(maxTop, pageEditorMain.scrollHeight * center.y - pageEditorMain.clientHeight / 2));
  }

  function getEditorFitCanvasWidth() {
    const cs = getComputedStyle(pageEditorMain);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const bottomH = pageEditorBottom.offsetHeight || 0;
    const gap = parseFloat(cs.gap) || 0;
    const viewW = Math.max(1, pageEditorMain.clientWidth - padX - 1);
    const viewH = Math.max(1, pageEditorMain.clientHeight - padY - bottomH - gap - 1);
    const naturalW = pageEditorCanvas.width || 1;
    const naturalH = pageEditorCanvas.height || 1;
    const heightFitWidth = viewH * (naturalW / naturalH);
    return Math.max(1, Math.min(viewW, heightFitWidth, naturalW));
  }

  function canPanPreview() {
    return zoomLevel > 1.001 &&
      (previewStage.scrollWidth > previewStage.clientWidth + 1 ||
       previewStage.scrollHeight > previewStage.clientHeight + 1);
  }

  function updatePanCursor() {
    const canPan = state.pdfDoc && canPanPreview();
    previewStage.classList.toggle('pannable', canPan);
    if (!canPan) previewStage.classList.remove('panning');
  }

  function applyZoom(opts = {}) {
    if (activeTool === 'organize') {
      canvasWrap.classList.remove('zoomed');
      pageEditorCanvasWrap.classList.remove('zoomed');
      previewStage.classList.remove('zoomed', 'pannable', 'panning');
      zoomOutBtn.disabled = true;
      zoomInBtn.disabled = true;
      zoomValEl.textContent = 'fit';
      return;
    }
    const preserveCenter = opts.preserveCenter !== false;
    const pd = currentPageData();
    const z = zoomLevel;
    const isZoomedIn = z > 1.001;

    zoomOutBtn.disabled = !state.pdfDoc || z <= ZOOM_MIN + 0.001;
    zoomInBtn.disabled  = !state.pdfDoc || z >= ZOOM_MAX - 0.001;
    zoomValEl.textContent = Math.round(z * 100) + '%';

    if (activeTool === 'edit') {
      const center = preserveCenter ? getEditorScrollCenter() : { x: 0.5, y: 0.5 };
      if (!pd || !pageEditorCanvas.width) {
        pageEditorCanvasWrap.classList.remove('zoomed');
        pageEditorCanvas.style.width = '';
        pageEditorCanvas.style.height = '';
        return;
      }
      pageEditorCanvasWrap.classList.toggle('zoomed', isZoomedIn);
      pageEditorCanvas.style.width = (getEditorFitCanvasWidth() * z) + 'px';
      pageEditorCanvas.style.height = 'auto';
      updateCropOverlay();
      requestAnimationFrame(() => {
        if (isZoomedIn) restoreEditorScrollCenter(center);
        else { pageEditorMain.scrollLeft = 0; pageEditorMain.scrollTop = 0; }
        updateCropOverlay();
      });
      return;
    }

    const center = preserveCenter ? getScrollCenter() : { x: 0.5, y: 0.5 };

    if (!pd) {
      canvasWrap.classList.remove('zoomed');
      previewStage.classList.remove('zoomed', 'pannable', 'panning');
      previewCanvas.style.width = '';
      previewCanvas.style.height = '';
      return;
    }

    canvasWrap.classList.toggle('zoomed', isZoomedIn);
    previewStage.classList.toggle('zoomed', isZoomedIn);
    previewCanvas.style.width = (getFitCanvasWidth(pd) * z) + 'px';
    previewCanvas.style.height = 'auto';

    requestAnimationFrame(() => {
      if (isZoomedIn) restoreScrollCenter(center);
      else { previewStage.scrollLeft = 0; previewStage.scrollTop = 0; }
      updatePanCursor();
    });
  }

  zoomInBtn.addEventListener('click', () => setZoom(zoomLevel * ZOOM_STEP));
  zoomOutBtn.addEventListener('click', () => setZoom(zoomLevel / ZOOM_STEP));

  // click the % readout to type any zoom level (Enter commits, Esc cancels, "fit" = calibrated 100%)
  zoomValEl.addEventListener('click', () => {
    if (!state.pdfDoc || zoomValEl.querySelector('input')) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = Math.round(zoomLevel * 100);
    input.style.cssText = 'width:100%;height:100%;border:none;background:transparent;font:inherit;letter-spacing:inherit;color:inherit;text-align:center;outline:none;padding:0';
    zoomValEl.textContent = '';
    zoomValEl.appendChild(input);
    input.focus(); input.select();
    let done = false;
    const finish = commit => {
      if (done) return; done = true;
      const raw = input.value.trim().toLowerCase().replace('%', '');
      if (commit && raw === 'fit') setZoom(1, { preserveCenter: false });
      else if (commit && raw !== '' && !isNaN(+raw) && +raw > 0) setZoom(+raw / 100);
      else applyZoom(); // restore readout
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  });

  // ctrl/cmd + scroll (or trackpad pinch) = continuous zoom
  previewStage.addEventListener('wheel', e => {
    const canZoomTool = activeTool === 'preview' || activeTool === 'merge' || isRasterTool(activeTool) || activeTool === 'edit';
    const overPdf = e.target.closest('.preview-canvas-wrap, .page-editor-canvas-wrap');
    if (!state.pdfDoc || !canZoomTool || !overPdf || (!e.ctrlKey && !e.metaKey)) return;
    e.preventDefault();
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 100 : 1);
    let z = zoomLevel * Math.exp(-dy * 0.0015);
    if (Math.abs(z - 1) < 0.02) z = 1; // gentle snap back to fit
    setZoom(z);
  }, { passive: false });

  previewStage.addEventListener('pointerdown', e => {
    if (!canPanPreview() || e.button !== 0 || loader.classList.contains('on')) return;
    panState.active = true;
    panState.pointerId = e.pointerId;
    panState.x = e.clientX;
    panState.y = e.clientY;
    panState.scrollLeft = previewStage.scrollLeft;
    panState.scrollTop = previewStage.scrollTop;
    previewStage.classList.add('panning');
    previewStage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  previewStage.addEventListener('pointermove', e => {
    if (!panState.active || e.pointerId !== panState.pointerId) return;
    previewStage.scrollLeft = panState.scrollLeft - (e.clientX - panState.x);
    previewStage.scrollTop = panState.scrollTop - (e.clientY - panState.y);
    e.preventDefault();
  });

  function stopPanning(e) {
    if (!panState.active || e.pointerId !== panState.pointerId) return;
    panState.active = false;
    previewStage.classList.remove('panning');
    if (previewStage.hasPointerCapture(e.pointerId)) previewStage.releasePointerCapture(e.pointerId);
  }

  previewStage.addEventListener('pointerup', stopPanning);
  previewStage.addEventListener('pointercancel', stopPanning);
  previewStage.addEventListener('lostpointercapture', () => {
    panState.active = false;
    previewStage.classList.remove('panning');
  });
  previewStage.addEventListener('scroll', updatePanCursor);
  window.addEventListener('resize', () => {
    syncPreviewStageHeight();
    updateToolIndicator();
  });
  document.querySelector('.tool-nav').addEventListener('scroll', updateToolIndicator);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncPreviewStageHeight);
  }
  setTimeout(() => {
    document.body.classList.add('title-condensed');
    syncPreviewStageHeight();
  }, 1000);
  setDarkMode(readSavedTheme() === 'dark');
  syncPreviewStageHeight();
  syncToolTabA11y();
  updateSourceDropMode();
  resolutionOptions.classList.toggle('hidden', !isRasterTool(activeTool));
  downloadBtn.parentElement.style.display = activeTool === 'preview' ? 'none' : '';
  syncAdvancedOptions();
  updateMergeState();
  setTogglePressed(invertToggle, state.invert);
  setTogglePressed(greyInvertToggle, state.greyInvert);
  setTogglePressed(sepiaToggle, state.sepia);
  syncResolutionToggles();
  syncFineQualityToggle();
  syncEditControls();
  updatePreviewMode();
  updateToolIndicator();

  // init display
  threshNum.textContent = '128';
  threshPct.textContent = '50%';
  threshNeedle.style.left = '50%';
  brightNum.textContent = '0';
