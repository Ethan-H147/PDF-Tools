  // SPDX-License-Identifier: AGPL-3.0-or-later

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // ── Tool registry: add a new entry here to add a new tool ──
  const FINE_ROTATION_EXPORT_DPI = { high: 600, ultra: 900 };
  const LARGE_PDF_SAFE_MODE_BYTES = 35 * 1024 * 1024;
  const LARGE_PDF_SAFE_MODE_PAGES = 80;
  const SAFE_FULL_PAGE_CACHE_LIMIT = (navigator.deviceMemory && navigator.deviceMemory >= 6) ? 4 : 3;
  const RASTER_PREVIEW_MAX_PIXELS = (navigator.deviceMemory && navigator.deviceMemory >= 6) ? 4200000 : 2200000;
  const ORIGINAL_PREVIEW_MAX_PIXELS = (navigator.deviceMemory && navigator.deviceMemory >= 8)
    ? 36000000
    : (navigator.deviceMemory && navigator.deviceMemory >= 4)
      ? 22000000
      : 12000000;
  const RASTER_PREVIEW_KEY = 'preview-raster';
  const PREVIEW_META_KEY = 'preview-meta';
  const PDF_LIB_SCRIPT_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  ];
  const JSPDF_SCRIPT_URLS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js',
  ];
  const COMPRESSION_PRESETS = {
    original: {
      hint: 'original',
      summary: 'Compact the PDF while keeping original page content.',
      rasterize: false,
    },
    balanced: {
      hint: 'balanced',
      summary: 'Create a smaller color PDF with balanced quality.',
      rasterize: true,
      dpi: 160,
      jpegQuality: 0.78,
      maxDimension: 2600,
    },
    small: {
      hint: 'small',
      summary: 'Create the smallest PDF with lighter page images.',
      rasterize: true,
      dpi: 110,
      jpegQuality: 0.58,
      maxDimension: 1800,
    },
  };

  let lastSingleTapAt = 0;
  let lastSingleTapX = 0;
  let lastSingleTapY = 0;
  let touchStartedWithMultipleFingers = false;

  document.addEventListener('touchstart', e => {
    touchStartedWithMultipleFingers = e.touches.length > 1;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (touchStartedWithMultipleFingers || e.changedTouches.length !== 1) return;
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const touch = e.changedTouches[0];
    const now = Date.now();
    const deltaT = now - lastSingleTapAt;
    const deltaX = Math.abs(touch.clientX - lastSingleTapX);
    const deltaY = Math.abs(touch.clientY - lastSingleTapY);
    if (deltaT > 0 && deltaT < 330 && deltaX < 28 && deltaY < 28) {
      e.preventDefault();
      lastSingleTapAt = 0;
      return;
    }
    lastSingleTapAt = now;
    lastSingleTapX = touch.clientX;
    lastSingleTapY = touch.clientY;
  }, { passive: false });

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
    sign: {
      lede: 'Draw a signature and place it directly on a PDF page.',
      meta: 'Draw your signature locally<br/>Drag it onto the page preview<br/>Export without rasterizing the PDF',
      downloadLabel: 'Export Signed PDF',
      downloadSub: 'stamp the signature onto the PDF',
      suffix: '_signed',
    },
    merge: {
      lede: 'Merge multiple PDFs into one organized document.',
      meta: 'Select any number of PDFs<br/>Reorder files before merging<br/>Merged output opens in Organize',
      downloadLabel: 'Merge PDFs',
      downloadSub: 'combine selected files into organize',
      suffix: '_merged',
    },
    compress: {
      lede: 'Reduce PDF file size with simple quality choices.',
      meta: 'Original mode preserves page content<br/>Balanced and Small create lighter page images<br/>Password lock still works',
      downloadLabel: 'Export Compressed PDF',
      downloadSub: 'reduce file size',
      suffix: '_compressed',
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
  let currentLocale = 'en';

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
    compressMode: 'original',
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
  const lazyScriptLoads = new Map();

  const $ = id => document.getElementById(id);

  // element refs
  const dropZone      = $('dropZone');
  const dropGlyph     = $('dropGlyph');
  const dropLabel     = $('dropLabel');
  const dropSub       = $('dropSub');
  const fileInput     = $('fileInput');
  const fileCard      = $('fileCard');
  const fileNameEl    = $('fileName');
  const fileRemoveBtn = $('fileRemoveBtn');
  const pageCountEl   = $('pageCount');
  const fileSizeEl    = $('fileSize');
  const fileStatusEl  = $('fileStatus');
  const errBox        = $('errBox');
  const threshSlider  = $('threshSlider');
  const thresholdResetBtn = $('thresholdResetBtn');
  const threshNum     = $('threshNum');
  const threshPct     = $('threshPct');
  const threshHint    = $('threshHint');
  const threshNeedle  = $('threshNeedle');
  const histoCanvas   = $('histoCanvas');
  const invertToggle  = $('invertToggle');
  const brightSlider  = $('brightSlider');
  const brightnessResetBtn = $('brightnessResetBtn');
  const brightNum     = $('brightNum');
  const brightTag     = $('brightTag');
  const contrastSlider= $('contrastSlider');
  const contrastResetBtn = $('contrastResetBtn');
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
  const advancedRangeRow = $('advancedRangeRow');
  const advancedRangeToggle = $('advancedRangeToggle');
  const advancedRangeInput = $('advancedRangeInput');
  const advancedPasswordRow = $('advancedPasswordRow');
  const advancedPasswordToggle = $('advancedPasswordToggle');
  const advancedPasswordInput = $('advancedPasswordInput');
  const resetPagesBtn = $('resetPagesBtn');
  const mergeHint     = $('mergeHint');
  const mergeSummary  = $('mergeSummary');
  const mergeList     = $('mergeList');
  const mergeClearBtn = $('mergeClearBtn');
  const mergeRunBtn   = $('mergeRunBtn');
  const compressHint  = $('compressHint');
  const compressSummary = $('compressSummary');
  const compressOriginal = $('compressOriginal');
  const compressBalanced = $('compressBalanced');
  const compressSmall = $('compressSmall');
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
  const signHint      = $('signHint');
  const signaturePad  = $('signaturePad');
  const signatureClearBtn = $('signatureClearBtn');
  const signatureRemoveBtn = $('signatureRemoveBtn');
  const signatureDragSource = $('signatureDragSource');
  const signatureDragPreview = $('signatureDragPreview');
  const signatureDragLabel = $('signatureDragLabel');
  const signSummary   = $('signSummary');
  const signatureOverlay = $('signatureOverlay');
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
  const signatureState = {
    hasInk: false,
    dataUrl: '',
    ratio: 3,
    stamps: [],
    selectedId: null,
    nextId: 1,
    padDrawing: false,
    padPointerId: null,
    lastPadPoint: null,
    drag: null,
  };

  let errorHideTimer = null;
  const toolTabs = Array.from(document.querySelectorAll('.tool-tab'));
  const toolPanels = Array.from(document.querySelectorAll('.tool-panel'));
  const languageSwitcher = $('languageSwitcher');

  function readSavedLocale() {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      return LOCALES[saved] ? saved : DEFAULT_LOCALE;
    } catch {
      return DEFAULT_LOCALE;
    }
  }

  function saveLocale(locale) {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Language changes still work for the current session if storage is blocked.
    }
  }

  function t(key, vars = {}) {
    const dict = LOCALES[currentLocale] || LOCALES[DEFAULT_LOCALE];
    const fallback = LOCALES[DEFAULT_LOCALE] || {};
    const template = dict[key] ?? fallback[key] ?? key;
    return String(template).replace(/\{(\w+)\}/g, (_, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : '');
  }

  function toolText(toolId, key) {
    const value = t('tool.' + toolId + '.' + key);
    if (!value || value === 'tool.' + toolId + '.' + key) return TOOLS[toolId]?.[key] || '';
    return value;
  }

  function setElementHtml(el, html) {
    if (el) el.innerHTML = html;
  }

  function applyStaticLocale() {
    document.documentElement.lang = currentLocale;
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });
    document.querySelectorAll('[data-tool-label]').forEach(el => {
      el.textContent = toolText(el.dataset.toolLabel, 'label');
    });
    if (languageSwitcher) {
      languageSwitcher.setAttribute('aria-label', 'Language');
      languageSwitcher.querySelectorAll('button[data-lang]').forEach(button => {
        const selected = button.dataset.lang === currentLocale;
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.textContent = LOCALE_NAMES[button.dataset.lang] || button.dataset.lang;
      });
    }
    syncZoomReadout();
  }

  function applyToolLocale() {
    const tool = TOOLS[activeTool];
    if (!tool) return;
    const meta = toolText(activeTool, 'meta');
    setElementHtml($('masterLede'), toolText(activeTool, 'lede'));
    $('masterMeta').dataset.tooltip = toolTipText(meta);
    $('masterMeta').setAttribute('aria-label', toolTipText(meta));
    setElementHtml(downloadLabel, toolText(activeTool, 'downloadLabel'));
    setElementHtml(downloadSub, toolText(activeTool, 'downloadSub'));
  }

  function setLocale(locale, persist = false) {
    if (!LOCALES[locale]) locale = DEFAULT_LOCALE;
    currentLocale = locale;
    if (persist) saveLocale(locale);
    applyStaticLocale();
    applyToolLocale();
    setDarkMode(document.body.classList.contains('dark-mode'));
    updateSourceDropMode();
    syncAdvancedOptions();
    syncCompressControls();
    syncFineQualityToggle();
    syncToneLabels();
    updateMergeState();
    updatePageState();
    syncEditControls();
    updatePreviewMode();
    updateToolIndicator();
  }

  function brightnessHintText(v = state.brightness) {
    return v < -50 ? t('hint.dark') : v < -10 ? t('hint.reduced') : v <= 10 ? t('hint.neutral') : v <= 50 ? t('hint.bright') : t('hint.maximum');
  }

  function syncToneLabels() {
    threshHint.textContent = threshHintText(state.threshold);
    brightTag.textContent = brightnessHintText();
    contrastTag.textContent = contrastHintText(state.contrast);
    $('greyHint').textContent = greyHintText();
    if (!state.pdfDoc) fileStatusEl.textContent = t('status.ready');
  }

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
    themeToggle.setAttribute('aria-label', enabled ? t('theme.offAria') : t('theme.onAria'));
    themeToggleText.textContent = enabled ? t('theme.light') : t('theme.dark');
    if (persist) saveTheme(enabled ? 'dark' : 'light');
    syncPreviewStageHeight();
    updateToolIndicator();
  }

  themeToggle.addEventListener('click', () => {
    setDarkMode(!document.body.classList.contains('dark-mode'), true);
  });

  if (languageSwitcher) {
    languageSwitcher.addEventListener('click', e => {
      const button = e.target.closest('button[data-lang]');
      if (!button) return;
      setLocale(button.dataset.lang, true);
    });
  }

  advancedToggle.addEventListener('click', () => {
    const expanded = advancedToggle.getAttribute('aria-expanded') === 'true';
    advancedToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    advancedPanel.hidden = expanded;
  });
  advancedCurrentOnly.addEventListener('change', () => {
    if (advancedCurrentOnly.checked) advancedRangeToggle.checked = false;
    syncAdvancedOptions();
    updatePageState();
  });
  advancedRangeToggle.addEventListener('change', () => {
    if (advancedRangeToggle.checked) advancedCurrentOnly.checked = false;
    syncAdvancedOptions();
    updatePageState();
    if (!advancedRangeInput.disabled) advancedRangeInput.focus();
  });
  advancedRangeInput.addEventListener('input', updatePageState);
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
    applyToolLocale();
    resolutionOptions.classList.toggle('hidden', !isRasterTool(id));
    downloadBtn.parentElement.style.display = id === 'preview' ? 'none' : '';
    syncAdvancedOptions();
    updateSourceDropMode();
    if (id === 'merge') {
      seedCurrentPdfInMergeList();
      updateMergeState();
    }
    else updatePageState();
    updatePreviewMode();
    updateToolIndicator();
    syncPreviewStageHeight();
    if (id === 'sign') syncSignatureControls();
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
      ? t('preview.titleOrganize')
      : editing
        ? t('preview.titleEdit')
        : activeTool === 'sign'
          ? t('preview.titleSign')
          : activeTool === 'preview'
          ? t('preview.titleOriginal')
          : activeTool === 'compress'
            ? t('preview.titleCompress')
            : t('preview.titleProcessed');
    organizer.style.display = organizing ? 'block' : 'none';
    pageEditor.style.display = editing ? 'flex' : 'none';
    if (!editing) cropOverlay.hidden = true;
    if (organizing) {
      emptyState.style.display = 'none';
      canvasWrap.style.display = 'none';
      pageEditor.style.display = 'none';
      renderOrganizer();
      updateSignatureOverlay();
      return;
    }
    if (editing) {
      emptyState.style.display = 'none';
      canvasWrap.style.display = 'none';
      renderPageEditor();
      updateSignatureOverlay();
      return;
    }
    const hasPages = state.pdfDoc && activePageCount() > 0;
    emptyState.style.display = hasPages ? 'none' : 'block';
    canvasWrap.style.display = hasPages ? 'block' : 'none';
    updateSignatureOverlay();
  }

  function updateSourceDropMode() {
    const merging = activeTool === 'merge';
    const hasCurrentPdf = !!state.pdfBytes || !!state.pdfDoc;
    const collapseDrop = hasCurrentPdf && !merging;
    fileInput.multiple = merging;
    dropZone.classList.toggle('is-collapsed', collapseDrop);
    dropZone.setAttribute('aria-hidden', collapseDrop ? 'true' : 'false');
    dropZone.tabIndex = collapseDrop ? -1 : 0;
    dropGlyph.textContent = merging ? '∑' : '¶';
    dropLabel.textContent = merging ? t('drop.uploadPdfs') : t('drop.uploadPdf');
    dropSub.textContent = merging ? t('drop.multiSub') : t('drop.singleSub');
    dropZone.setAttribute('aria-label', merging ? t('drop.multiAria') : t('drop.singleAria'));
    fileRemoveBtn.disabled = !hasCurrentPdf;
    fileRemoveBtn.hidden = !hasCurrentPdf;
    fileRemoveBtn.setAttribute('aria-label', t('file.removeAria', { name: state.fileName || 'PDF' }));
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

  function loadScriptOnce(id, urls) {
    if (lazyScriptLoads.has(id)) return lazyScriptLoads.get(id);
    let index = 0;
    const loadNext = () => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = urls[index];
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        index += 1;
        if (index < urls.length) loadNext().then(resolve, reject);
        else reject(new Error(id + ' library did not load. Check your connection and try again.'));
      };
      document.head.appendChild(script);
    });
    const promise = loadNext().catch(err => {
      lazyScriptLoads.delete(id);
      throw err;
    });
    lazyScriptLoads.set(id, promise);
    return promise;
  }

  async function ensurePdfLib() {
    if (window.PDFLib) return window.PDFLib;
    await loadScriptOnce('PDF', PDF_LIB_SCRIPT_URLS);
    if (!window.PDFLib) throw new Error('PDF library did not load. Check your connection and try again.');
    return window.PDFLib;
  }

  async function ensureJsPdf() {
    if (window.jspdf?.jsPDF) return window.jspdf;
    await loadScriptOnce('Rendered PDF', JSPDF_SCRIPT_URLS);
    if (!window.jspdf?.jsPDF) throw new Error('Rendered PDF library did not load. Check your connection and try again.');
    return window.jspdf;
  }

  function normalizePdfBytes(bytes) {
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    throw new Error('Export did not produce PDF bytes.');
  }

  function createPdfArtifact(bytes, fileBase, meta = {}) {
    return {
      bytes: normalizePdfBytes(bytes),
      fileBase: cleanDownloadBase(fileBase, outputBaseName()),
      mimeType: 'application/pdf',
      meta: {
        processors: [],
        ...meta,
      },
    };
  }

  function clonePdfArtifact(artifact, updates = {}) {
    return {
      ...artifact,
      ...updates,
      meta: {
        ...(artifact.meta || {}),
        ...(updates.meta || {}),
      },
    };
  }

  function downloadPdfArtifact(artifact) {
    const blob = new Blob([normalizePdfBytes(artifact.bytes)], { type: artifact.mimeType || 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cleanDownloadBase(artifact.fileBase, outputBaseName()) + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function createExportContext(toolId, pageOrder, fileBase, options = {}) {
    const useCurrentOnly = options.useCurrentOnly !== false;
    const usePassword = options.usePassword !== false;
    const password = usePassword ? advancedPasswordValue() : '';
    return {
      toolId,
      pageOrder: pageOrder.slice(),
      fileBase,
      advanced: {
        currentOnly: useCurrentOnly && advancedCurrentOnly.checked,
        password,
      },
    };
  }

  function buildAdvancedExportProcessors(context, artifact) {
    const processors = [];
    if (context.advanced.password && !artifact.meta?.passwordProtected) {
      processors.push({
        id: 'password',
        label: t('progress.lockingPdf'),
        progress: 100,
        apply: applyPasswordProcessor,
      });
    }
    return processors;
  }

  async function loadNoRasterPdfEncryptionEngine() {
    return noRasterPdfEncryptionEngine;
  }

  async function applyPasswordProcessor(artifact, context) {
    const engine = await loadNoRasterPdfEncryptionEngine();
    const encryptedBytes = await engine.encrypt({
      bytes: artifact.bytes,
      userPassword: context.advanced.password,
      ownerPassword: context.advanced.password,
    });
    return clonePdfArtifact(artifact, {
      bytes: encryptedBytes,
      meta: {
        passwordProtected: true,
        processors: [...(artifact.meta?.processors || []), 'password'],
      },
    });
  }

  const PDF_PASSWORD_PADDING = Uint8Array.from([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
    0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
    0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
    0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
  ]);

  const noRasterPdfEncryptionEngine = {
    encrypt({ bytes, userPassword, ownerPassword }) {
      return encryptPdfBytesNoRaster(normalizePdfBytes(bytes), userPassword, ownerPassword || userPassword);
    },
  };

  const LOCALE_STORAGE_KEY = 'pdf-atelier-language';
  const DEFAULT_LOCALE = 'en';
  const LOCALE_NAMES = {
    en: 'English',
    'zh-Hans': '简体中文',
    'zh-Hant-TW': '繁體中文（台灣）',
    ko: '한국어',
    ja: '日本語',
    es: 'Español',
    fr: 'Français',
  };
  const LOCALES = {
    en: {
      'brand.subtitle': 'PDF Tools',
      'nav.tools': 'Tools',
      'nav.toolsAria': 'PDF tools',
      'sections.source': 'I. Source PDF',
      'sections.organize': 'II. Organize Pages',
      'sections.cropRotate': 'II. Crop & Rotate',
      'sections.merge': 'II. Merge PDFs',
      'sections.compress': 'II. Compress PDF',
      'sections.threshold': 'II. Threshold',
      'sections.greyscale': 'II. Grayscale',
      'sections.pages': 'III. Pages',
      'file.pages': 'Pages',
      'file.page': 'Page',
      'file.pagePrefix': 'Page ',
      'file.pageSuffix': '',
      'file.size': 'Size',
      'file.status': 'Status',
      'file.renameTitle': 'Click to rename',
      'file.removeAria': 'Remove {name}',
      'status.ready': 'ready',
      'status.readySafe': 'ready · safe',
      'status.loading': 'loading',
      'status.error': 'error',
      'drop.uploadPdf': 'Upload PDF',
      'drop.uploadPdfs': 'Upload PDFs',
      'drop.singleSub': 'PDF · click or drop',
      'drop.multiSub': 'Multiple PDFs · click or drop',
      'drop.singleAria': 'Upload a PDF',
      'drop.multiAria': 'Upload one or more PDFs',
      'actions.clear': 'Clear',
      'actions.clearList': 'Clear list',
      'actions.restoreOrder': 'Restore original order',
      'actions.resetSelectedPage': 'Reset selected page',
      'actions.reset': 'Reset',
      'actions.resetThreshold': 'Reset threshold',
      'actions.resetBrightness': 'Reset brightness',
      'actions.resetContrast': 'Reset contrast',
      'actions.mergeIntoOrganize': 'Merge into Organize',
      'actions.invert': 'Invert',
      'actions.sepia': 'Sepia',
      'advanced.title': 'Advanced options',
      'advanced.currentOnly': 'Current page only',
      'advanced.currentOnlySub': 'Export just the selected page.',
      'advanced.pageRange': 'Page range',
      'advanced.passwordLock': 'Password lock',
      'advanced.passwordPlaceholder': 'Password',
      'split.title': 'Split Export',
      'split.useButton': 'Use a page Split button in Organize to create a split.',
      'split.summary': '{parts} PDFs from {points} split {pointWord}.',
      'split.pointOne': 'point',
      'split.pointMany': 'points',
      'split.part': 'Part {num}',
      'split.pagesOne': 'Page {start}',
      'split.pagesMany': 'Pages {start}-{end}',
      'split.nameAria': 'Name for part {num}',
      'split.exportPart': 'Export part {num}',
      'split.button': 'Split',
      'split.removeAria': 'Remove split {num}',
      'split.afterPage': 'Split after page {num}',
      'split.removeAfterPage': 'Remove split after page {num}',
      'split.afterOriginal': 'Split after original page {num}',
      'split.removeAfterOriginal': 'Remove split after original page {num}',
      'split.cannotFinal': 'Cannot split after the final page',
      'edit.fineRotation': 'Fine Rotation',
      'edit.cropFrame': 'Crop Frame',
      'edit.fineRotationQuality': 'Fine Rotation Quality',
      'edit.fineQualityAria': 'Use ultra 900 dpi for fine rotation export',
      'edit.qualityHigh': 'High · 600 dpi',
      'edit.qualityUltra': 'Ultra · 900 dpi',
      'edit.selectPage': 'select page',
      'edit.pageHint': 'page {page}',
      'edit.summaryEmpty': 'Upload a PDF, then choose a page from the editor to crop or rotate it.',
      'edit.summaryActive': 'Editing page {page} of {count}. Changes apply only to this page.',
      'edit.fullPage': 'Full page',
      'edit.cropKept': '{w}% × {h}% kept',
      'edit.cropTotal': '{total}% total',
      'merge.summaryEmpty': 'Choose multiple PDFs, arrange their order, then merge into the organizer.',
      'merge.summaryActive': '{count} {pdfWord} selected · {size}. Arrange the list, then merge into Organize.',
      'merge.pdfOne': 'PDF',
      'merge.pdfMany': 'PDFs',
      'merge.moveUp': 'Move {name} up',
      'merge.moveDown': 'Move {name} down',
      'merge.remove': 'Remove {name}',
      'compress.original': 'Original',
      'compress.balanced': 'Balanced',
      'compress.small': 'Small',
      'compress.hintOriginal': 'original',
      'compress.hintBalanced': 'balanced',
      'compress.hintSmall': 'small',
      'compress.summaryOriginal': 'Compact the PDF while keeping original page content.',
      'compress.summaryBalanced': 'Create a smaller color PDF with balanced quality.',
      'compress.summarySmall': 'Create the smallest PDF with lighter page images.',
      'resolution.fast': 'Fast',
      'resolution.900Warning': '900 dpi can make the exported PDF extremely large and make rendering/exporting take a very long time. Continue?',
      'threshold.whiteTag': '0 · white',
      'threshold.blackTag': '255 · black',
      'greyscale.brightness': 'brightness',
      'greyscale.darkTag': '−100 · dark',
      'greyscale.lightTag': '+100 · light',
      'greyscale.lowTag': '50% · low',
      'greyscale.highTag': '200% · high',
      'hint.ready': 'ready',
      'hint.low': 'low',
      'hint.soft': 'soft',
      'hint.midRange': 'mid range',
      'hint.darkRange': 'dark range',
      'hint.lightRange': 'light range',
      'hint.high': 'high',
      'hint.neutral': 'neutral',
      'hint.normal': 'normal',
      'hint.dark': 'dark',
      'hint.reduced': 'reduced',
      'hint.bright': 'bright',
      'hint.maximum': 'maximum',
      'hint.sepia': 'sepia',
      'hint.inverted': 'inverted',
      'hint.lowContrast': 'low contrast',
      'hint.highContrast': 'high contrast',
      'empty.noPreview': 'No preview yet',
      'empty.uploadToBegin': 'Upload a PDF to begin',
      'empty.organize': 'Upload a PDF to organize pages.',
      'empty.organizeRemoved': 'All pages have been removed. Restore the original order to continue.',
      'empty.edit': 'Upload a PDF to crop or rotate pages.',
      'preview.titleOrganize': 'Rearrange <em>— drag pages to reorder</em>',
      'preview.titleEdit': 'Crop & Rotate <em>— select one page</em>',
      'preview.titleOriginal': 'Preview <em>— original PDF</em>',
      'preview.titleCompress': 'Preview <em>— compressed export</em>',
      'preview.titleProcessed': 'Preview <em>— processed output</em>',
      'proof.awaiting': 'awaiting PDF',
      'zoom.fit': 'fit',
      'zoom.fitTitle': 'Click to fit',
      'proof.outputPages': '{count} pages in output',
      'proof.noPages': 'no pages selected',
      'proof.pagePixels': '{w} × {h} px · page {page}/{count}',
      'proof.editPage': 'page {page}/{count} · {edit}',
      'proof.mergedPages': '{count} merged pages',
      'progress.lockingPdf': 'Locking PDF…',
      'progress.loadingPdf': 'Loading PDF…',
      'progress.openingPdf': 'Opening PDF…',
      'progress.openingLargePdf': 'Opening large PDF safely…',
      'progress.renderingPage': 'Rendering page {page} of {count}',
      'progress.renderingAtDpi': 'Rendering at {dpi} dpi · page {page} / {count}',
      'progress.resolutionCurrentPage': 'Resolution set · rendering current page…',
      'progress.mergingPdfs': 'Merging PDFs…',
      'progress.mergingFile': 'Merging {name}',
      'progress.renderingMergedPdf': 'Rendering merged PDF…',
      'progress.exportingPages': 'Exporting pages…',
      'progress.exportingOriginalPages': 'Exporting original pages…',
      'progress.exportingPageEdits': 'Exporting page edits…',
      'progress.compressingPdf': 'Compressing PDF…',
      'progress.exportingEditedPage': 'Exporting edited page {page} of {count}',
      'progress.rasterizingFineRotation': 'Rasterizing fine rotation at {dpi} dpi · page {page} of {count}',
      'progress.exportingPart': 'Exporting part {part}…',
      'progress.exportingPage': 'Exporting page {page} of {count}',
      'progress.compressingPage': 'Compressing page {page} of {count}',
      'errors.rangeRequired': 'Enter a page range before exporting.',
      'errors.rangeFormat': 'Use page ranges like 1-3, 8, 12-15.',
      'errors.rangeBounds': 'Page range must stay between 1 and {count}.',
      'errors.rangeOrder': 'Page ranges must go from low to high.',
      'errors.rangeEmpty': 'Enter at least one page to export.',
      'errors.readPdfFailed': 'Could not read this PDF: {error}',
      'errors.mergeFailed': 'Merge failed: {error}',
      'errors.splitExportFailed': 'Split export failed: {error}',
      'errors.exportFailed': 'Export failed: {error}',
      'errors.previewFailed': 'Preview failed: {error}',
      'errors.originalMissing': 'Original PDF data is not available.',
      'errors.noPagesExport': 'There are no pages to export.',
      'errors.renderPageFailed': 'Could not render page {page}.',
      'organize.summaryEmpty': 'Upload a PDF to reorder or remove pages.',
      'organize.summarySplit': '{parts} PDFs are ready. Edit names and export each part from the split panel.',
      'organize.summaryPages': '{count} of {total} original pages will be included in export. Use Split on a page to divide the PDF.',
      'organize.splits': '{count} splits',
      'organize.pages': '{count} pages',
      'theme.dark': 'Dark mode',
      'theme.light': 'Light mode',
      'theme.onAria': 'Turn on dark mode',
      'theme.offAria': 'Turn off dark mode',
      'footer.type': 'Set in SF Pro / Inter',
      'footer.clientSide': 'Client-side PDF processing',
      'footer.local': 'Runs entirely in your browser',
      'errors.chooseMerge': 'Choose one or more PDF files to merge.',
      'errors.password': 'Enter a password before exporting a locked PDF.',
      'errors.notPdf': 'That doesn’t look like a PDF.',
      'tool.preview.label': 'Preview',
      'tool.preview.lede': 'View a PDF cleanly with fast page navigation and zoom.',
      'tool.preview.meta': 'Open a PDF for viewing<br/>Use page navigation<br/>Zoom without changing the file',
      'tool.preview.downloadLabel': 'Preview Only',
      'tool.preview.downloadSub': 'view and zoom without exporting',
      'tool.organize.label': 'Organize',
      'tool.organize.lede': 'Reorder or remove pages before export.',
      'tool.organize.meta': 'Drag pages to reorder<br/>Click × to remove a page<br/>Use Split to divide after a page<br/>Drag pages across split lines freely<br/>Click a split × to remove it<br/>Name and export each part separately<br/>Original PDF pages are preserved',
      'tool.organize.downloadLabel': 'Export Organized PDF',
      'tool.organize.downloadSub': 'preserve original page content',
      'tool.edit.label': 'Crop/Rotate',
      'tool.edit.lede': 'Crop and rotate individual pages before export.',
      'tool.edit.meta': 'Select one page at a time<br/>Drag the crop frame on the page<br/>Fine rotate with a low-sensitivity slider<br/>Use 90° rotate buttons for page turns',
      'tool.edit.downloadLabel': 'Export Edited PDF',
      'tool.edit.downloadSub': 'apply page crops and rotations',
      'tool.merge.label': 'Merge',
      'tool.merge.lede': 'Merge multiple PDFs into one organized document.',
      'tool.merge.meta': 'Select any number of PDFs<br/>Reorder files before merging<br/>Merged output opens in Organize',
      'tool.merge.downloadLabel': 'Merge PDFs',
      'tool.merge.downloadSub': 'combine selected files into organize',
      'tool.compress.label': 'Compress',
      'tool.compress.lede': 'Reduce PDF file size with simple quality choices.',
      'tool.compress.meta': 'Original mode preserves page content<br/>Balanced and Small create lighter page images<br/>Password lock still works',
      'tool.compress.downloadLabel': 'Export Compressed PDF',
      'tool.compress.downloadSub': 'reduce file size',
      'tool.threshold.label': 'Threshold',
      'tool.threshold.lede': 'Convert PDFs to black and white with threshold control.',
      'tool.threshold.meta': 'Black and white output<br/>Client-side only · no upload<br/>Threshold · 0 → 255',
      'tool.threshold.downloadLabel': 'Export PDF',
      'tool.threshold.downloadSub': 'render and download all pages',
      'tool.greyscale.label': 'Grayscale',
      'tool.greyscale.lede': 'Convert PDFs to grayscale with brightness and contrast.',
      'tool.greyscale.meta': 'Grayscale output<br/>Client-side only · no upload<br/>Brightness &amp; contrast',
      'tool.greyscale.downloadLabel': 'Export Grayscale PDF',
      'tool.greyscale.downloadSub': 'render and download all pages',
    },
  };

  Object.assign(LOCALES, {
    'zh-Hans': {
      'brand.subtitle': 'PDF 工具',
      'nav.tools': '工具',
      'nav.toolsAria': 'PDF 工具',
      'sections.source': 'I. 原始 PDF',
      'sections.organize': 'II. 整理页面',
      'sections.cropRotate': 'II. 裁剪与旋转',
      'sections.merge': 'II. 合并 PDF',
      'sections.compress': 'II. 压缩 PDF',
      'sections.threshold': 'II. 黑白阈值',
      'sections.greyscale': 'II. 灰度',
      'sections.pages': 'III. 页面',
      'file.pages': '页数',
      'file.page': '页',
      'file.pagePrefix': '第',
      'file.pageSuffix': '页',
      'file.size': '大小',
      'file.status': '状态',
      'file.renameTitle': '点击重命名',
      'file.removeAria': '移除 {name}',
      'status.ready': '就绪',
      'status.readySafe': '就绪 · 安全',
      'status.loading': '加载中',
      'status.error': '错误',
      'drop.uploadPdf': '选择 PDF',
      'drop.uploadPdfs': '选择多个 PDF',
      'drop.singleSub': 'PDF · 点击或拖入',
      'drop.multiSub': '多个 PDF · 点击或拖入',
      'drop.singleAria': '选择 PDF',
      'drop.multiAria': '选择一个或多个 PDF',
      'actions.clear': '清除',
      'actions.clearList': '清空列表',
      'actions.restoreOrder': '恢复原顺序',
      'actions.resetSelectedPage': '重置所选页面',
      'actions.reset': '重置',
      'actions.resetThreshold': '重置阈值',
      'actions.resetBrightness': '重置亮度',
      'actions.resetContrast': '重置对比度',
      'actions.mergeIntoOrganize': '合并到整理页',
      'actions.invert': '反相',
      'actions.sepia': '暖色',
      'advanced.title': '高级选项',
      'advanced.currentOnly': '仅当前页',
      'advanced.currentOnlySub': '只导出当前选中的页面。',
      'advanced.pageRange': '页面范围',
      'advanced.passwordLock': '密码锁定',
      'advanced.passwordPlaceholder': '密码',
      'split.title': '拆分导出',
      'split.useButton': '在页面上点“拆分”来添加拆分点。',
      'split.summary': '{parts} 份 PDF，{points} 个拆分点。',
      'split.pointOne': '拆分点',
      'split.pointMany': '拆分点',
      'split.part': '第 {num} 份',
      'split.pagesOne': '第 {start} 页',
      'split.pagesMany': '第 {start}-{end} 页',
      'split.nameAria': '第 {num} 份的名称',
      'split.exportPart': '导出第 {num} 份',
      'split.button': '拆分',
      'edit.fineRotation': '旋转微调',
      'edit.cropFrame': '裁剪框',
      'edit.fineRotationQuality': '旋转导出质量',
      'edit.fineQualityAria': '旋转微调导出使用超清 900 dpi',
      'edit.qualityHigh': '高 · 600 dpi',
      'edit.qualityUltra': '超清 · 900 dpi',
      'edit.selectPage': '选择页面',
      'edit.pageHint': '第 {page} 页',
      'edit.summaryEmpty': '上传 PDF 后，选择要裁剪或旋转的页面。',
      'edit.summaryActive': '正在编辑第 {page}/{count} 页。改动只会应用到这一页。',
      'edit.fullPage': '完整页面',
      'edit.cropKept': '保留 {w}% × {h}%',
      'edit.cropTotal': '共 {total}%',
      'merge.summaryEmpty': '选择多个 PDF，调整顺序后合并。',
      'merge.summaryActive': '已选择 {count} 个 {pdfWord} · {size}。调整顺序后合并到整理页。',
      'merge.pdfOne': 'PDF',
      'merge.pdfMany': 'PDF',
      'compress.original': '原画质',
      'compress.balanced': '均衡',
      'compress.small': '小体积',
      'compress.hintOriginal': '原画质',
      'compress.hintBalanced': '平衡',
      'compress.hintSmall': '小体积',
      'compress.summaryOriginal': '尽量保持原始内容，只重新整理 PDF 结构。',
      'compress.summaryBalanced': '压缩为较小的彩色 PDF，兼顾清晰度。',
      'compress.summarySmall': '优先减小体积，适合快速分享。',
      'resolution.fast': '快速',
      'threshold.whiteTag': '0 · 白',
      'threshold.blackTag': '255 · 黑',
      'greyscale.brightness': '亮度',
      'greyscale.darkTag': '−100 · 暗',
      'greyscale.lightTag': '+100 · 亮',
      'greyscale.lowTag': '50% · 低',
      'greyscale.highTag': '200% · 高',
      'hint.ready': '就绪',
      'hint.low': '低',
      'hint.soft': '柔和',
      'hint.midRange': '中间',
      'hint.darkRange': '偏暗范围',
      'hint.lightRange': '偏亮范围',
      'hint.high': '高',
      'hint.neutral': '默认',
      'hint.normal': '正常',
      'hint.dark': '暗',
      'hint.reduced': '偏暗',
      'hint.bright': '偏亮',
      'hint.maximum': '最高',
      'hint.sepia': '暖色',
      'hint.inverted': '反相',
      'hint.lowContrast': '低对比度',
      'hint.highContrast': '高对比度',
      'empty.noPreview': '暂无预览',
      'empty.uploadToBegin': '上传 PDF 后开始',
      'empty.organize': '上传 PDF 后整理页面。',
      'empty.organizeRemoved': '页面已全部移除。恢复原顺序后继续。',
      'empty.edit': '上传 PDF 后裁剪或旋转页面。',
      'preview.titleOrganize': '整理 <em>— 拖动页面调整顺序</em>',
      'preview.titleEdit': '裁剪/旋转 <em>— 选择一个页面</em>',
      'preview.titleOriginal': '预览 <em>— 原始 PDF</em>',
      'preview.titleCompress': '预览 <em>— 压缩导出</em>',
      'preview.titleProcessed': '预览 <em>— 处理结果</em>',
      'proof.awaiting': '等待上传 PDF',
      'zoom.fit': '适应',
      'zoom.fitTitle': '点击适应窗口',
      'proof.outputPages': '输出 {count} 页',
      'proof.noPages': '未选择页面',
      'proof.pagePixels': '{w} × {h} px · 第 {page}/{count} 页',
      'proof.editPage': '第 {page}/{count} 页 · {edit}',
      'proof.mergedPages': '已合并 {count} 页',
      'progress.lockingPdf': '正在加密 PDF…',
      'progress.loadingPdf': '正在加载 PDF…',
      'progress.openingPdf': '正在打开 PDF…',
      'progress.openingLargePdf': '正在安全打开大型 PDF…',
      'progress.renderingPage': '正在渲染第 {page}/{count} 页',
      'progress.renderingAtDpi': '正在以 {dpi} dpi 渲染 · 第 {page}/{count} 页',
      'progress.resolutionCurrentPage': '分辨率已设置，正在渲染当前页…',
      'progress.mergingPdfs': '正在合并 PDF…',
      'progress.mergingFile': '正在合并 {name}',
      'progress.renderingMergedPdf': '正在渲染合并后的 PDF…',
      'progress.exportingPages': '正在导出页面…',
      'progress.exportingOriginalPages': '正在导出原始页面…',
      'progress.exportingPageEdits': '正在导出页面编辑…',
      'progress.compressingPdf': '正在压缩 PDF…',
      'progress.exportingEditedPage': '正在导出编辑后的第 {page}/{count} 页',
      'progress.rasterizingFineRotation': '正在以 {dpi} dpi 栅格化细微旋转 · 第 {page}/{count} 页',
      'progress.exportingPart': '正在导出第 {part} 部分…',
      'progress.exportingPage': '正在导出第 {page}/{count} 页',
      'progress.compressingPage': '正在压缩第 {page}/{count} 页',
      'errors.rangeRequired': '导出前请输入页码范围。',
      'errors.rangeFormat': '请使用 1-3、8、12-15 这样的页码范围。',
      'errors.rangeBounds': '页码范围必须在 1 到 {count} 之间。',
      'errors.rangeOrder': '页码范围必须从小到大。',
      'errors.rangeEmpty': '请至少选择一页进行导出。',
      'errors.readPdfFailed': '无法读取此 PDF：{error}',
      'errors.mergeFailed': '合并失败：{error}',
      'errors.splitExportFailed': '分割导出失败：{error}',
      'errors.exportFailed': '导出失败：{error}',
      'errors.previewFailed': '预览失败：{error}',
      'errors.originalMissing': '原始 PDF 数据不可用。',
      'errors.noPagesExport': '没有可导出的页面。',
      'errors.renderPageFailed': '无法渲染第 {page} 页。',
      'errors.chooseMerge': '请选择一个或多个要合并的 PDF 文件。',
      'errors.password': '导出加密 PDF 前请输入密码。',
      'errors.notPdf': '这看起来不是 PDF 文件。',
      'organize.summaryEmpty': '上传 PDF 后调整页面顺序或删除页面。',
      'organize.summarySplit': '{parts} 份 PDF 已准备好。可以改名后分别导出。',
      'organize.summaryPages': '将导出 {count}/{total} 页。点击页面上的“拆分”可拆成多份 PDF。',
      'organize.splits': '{count} 个拆分',
      'organize.pages': '{count} 页',
      'theme.dark': '深色模式',
      'theme.light': '浅色模式',
      'theme.onAria': '开启深色模式',
      'theme.offAria': '关闭深色模式',
      'footer.type': '字体 SF Pro / Inter',
      'footer.clientSide': '本地处理 PDF',
      'footer.local': '全程在浏览器内完成',
      'tool.preview.label': '预览',
      'tool.preview.lede': '查看 PDF，支持快速翻页和缩放。',
      'tool.preview.meta': '打开 PDF 查看<br/>快速切换页面<br/>缩放不会改动文件',
      'tool.preview.downloadLabel': '仅预览',
      'tool.preview.downloadSub': '仅查看和缩放，不导出',
      'tool.organize.label': '整理',
      'tool.organize.lede': '导出前调整页面顺序或删除页面。',
      'tool.organize.downloadLabel': '导出整理版 PDF',
      'tool.organize.downloadSub': '保留原始页面内容',
      'tool.edit.label': '裁剪/旋转',
      'tool.edit.lede': '导出前裁剪或旋转指定页面。',
      'tool.edit.downloadLabel': '导出编辑后的 PDF',
      'tool.edit.downloadSub': '应用页面裁剪和旋转',
      'tool.merge.label': '合并',
      'tool.merge.lede': '把多个 PDF 合并成一个文件。',
      'tool.merge.downloadLabel': '合并 PDF',
      'tool.merge.downloadSub': '合并所选文件',
      'tool.compress.label': '压缩',
      'tool.compress.lede': '用简单选项减小 PDF 体积。',
      'tool.compress.downloadLabel': '导出压缩 PDF',
      'tool.compress.downloadSub': '压缩文件体积',
      'tool.threshold.label': '黑白',
      'tool.threshold.lede': '用阈值把 PDF 转成黑白。',
      'tool.threshold.downloadLabel': '导出 PDF',
      'tool.threshold.downloadSub': '渲染并下载所有页面',
      'tool.greyscale.label': '灰度',
      'tool.greyscale.lede': '使用亮度和对比度将 PDF 转为灰度。',
      'tool.greyscale.downloadLabel': '导出灰度 PDF',
      'tool.greyscale.downloadSub': '渲染并下载所有页面',
    },
    'zh-Hant-TW': {
      'brand.subtitle': 'PDF 工具',
      'nav.tools': '工具',
      'nav.toolsAria': 'PDF 工具',
      'sections.source': 'I. 原始 PDF',
      'sections.organize': 'II. 整理頁面',
      'sections.cropRotate': 'II. 裁切與旋轉',
      'sections.merge': 'II. 合併 PDF',
      'sections.compress': 'II. 壓縮 PDF',
      'sections.threshold': 'II. 黑白閾值',
      'sections.greyscale': 'II. 灰階',
      'sections.pages': 'III. 頁面',
      'file.pages': '頁數',
      'file.page': '頁',
      'file.pagePrefix': '第',
      'file.pageSuffix': '頁',
      'file.size': '大小',
      'file.status': '狀態',
      'file.renameTitle': '點擊重新命名',
      'file.removeAria': '移除 {name}',
      'status.ready': '就緒',
      'status.readySafe': '就緒 · 安全',
      'status.loading': '載入中',
      'status.error': '錯誤',
      'drop.uploadPdf': '選擇 PDF',
      'drop.uploadPdfs': '選擇多個 PDF',
      'drop.singleSub': 'PDF · 點擊或拖入',
      'drop.multiSub': '多個 PDF · 點擊或拖入',
      'drop.singleAria': '選擇 PDF',
      'drop.multiAria': '選擇一個或多個 PDF',
      'actions.clear': '清除',
      'actions.clearList': '清空列表',
      'actions.restoreOrder': '還原原順序',
      'actions.resetSelectedPage': '重設所選頁面',
      'actions.reset': '重設',
      'actions.resetThreshold': '重設閾值',
      'actions.resetBrightness': '重設亮度',
      'actions.resetContrast': '重設對比',
      'actions.mergeIntoOrganize': '合併到整理頁',
      'actions.invert': '反相',
      'actions.sepia': '暖色',
      'advanced.title': '進階選項',
      'advanced.currentOnly': '僅目前頁面',
      'advanced.currentOnlySub': '只匯出目前選取的頁面。',
      'advanced.pageRange': '頁面範圍',
      'advanced.passwordLock': '密碼鎖定',
      'advanced.passwordPlaceholder': '密碼',
      'split.title': '分割匯出',
      'split.useButton': '在頁面上點「分割」來新增分割點。',
      'split.summary': '{parts} 份 PDF，{points} 個分割點。',
      'split.pointOne': '分割點',
      'split.pointMany': '分割點',
      'split.part': '第 {num} 份',
      'split.pagesOne': '第 {start} 頁',
      'split.pagesMany': '第 {start}-{end} 頁',
      'split.nameAria': '第 {num} 份的名稱',
      'split.exportPart': '匯出第 {num} 份',
      'split.button': '分割',
      'split.removeAria': '移除第 {num} 個分割點',
      'split.afterPage': '在第 {num} 頁後分割',
      'split.removeAfterPage': '移除第 {num} 頁後的分割',
      'split.afterOriginal': '在原始第 {num} 頁後分割',
      'split.removeAfterOriginal': '移除原始第 {num} 頁後的分割',
      'split.cannotFinal': '最後一頁後不能分割',
      'edit.fineRotation': '旋轉微調',
      'edit.cropFrame': '裁切框',
      'edit.fineRotationQuality': '旋轉匯出品質',
      'edit.fineQualityAria': '旋轉微調匯出使用超高 900 dpi',
      'edit.qualityHigh': '高 · 600 dpi',
      'edit.qualityUltra': '超高 · 900 dpi',
      'edit.selectPage': '選擇頁面',
      'edit.pageHint': '第 {page} 頁',
      'edit.summaryEmpty': '上傳 PDF 後，選擇要裁切或旋轉的頁面。',
      'edit.summaryActive': '正在編輯第 {page}/{count} 頁。變更只會套用到這一頁。',
      'edit.fullPage': '完整頁面',
      'edit.cropKept': '保留 {w}% × {h}%',
      'edit.cropTotal': '共 {total}%',
      'merge.summaryEmpty': '選擇多個 PDF，調整順序後合併。',
      'merge.summaryActive': '已選擇 {count} 個 {pdfWord} · {size}。調整順序後合併到整理頁。',
      'merge.pdfOne': 'PDF',
      'merge.pdfMany': 'PDF',
      'merge.moveUp': '將 {name} 往上移',
      'merge.moveDown': '將 {name} 往下移',
      'merge.remove': '移除 {name}',
      'compress.original': '原畫質',
      'compress.balanced': '均衡',
      'compress.small': '小體積',
      'compress.hintOriginal': '原畫質',
      'compress.hintBalanced': '平衡',
      'compress.hintSmall': '小體積',
      'compress.summaryOriginal': '盡量保留原始內容，只重新整理 PDF 結構。',
      'compress.summaryBalanced': '壓縮成較小的彩色 PDF，同時保留清晰度。',
      'compress.summarySmall': '優先縮小檔案，適合快速分享。',
      'resolution.fast': '快速',
      'threshold.whiteTag': '0 · 白',
      'threshold.blackTag': '255 · 黑',
      'greyscale.brightness': '亮度',
      'greyscale.darkTag': '−100 · 暗',
      'greyscale.lightTag': '+100 · 亮',
      'greyscale.lowTag': '50% · 低',
      'greyscale.highTag': '200% · 高',
      'hint.ready': '就緒',
      'hint.low': '低',
      'hint.soft': '柔和',
      'hint.midRange': '中間',
      'hint.darkRange': '偏暗',
      'hint.lightRange': '偏亮',
      'hint.high': '高',
      'hint.neutral': '預設',
      'hint.normal': '正常',
      'hint.dark': '暗',
      'hint.reduced': '偏暗',
      'hint.bright': '偏亮',
      'hint.maximum': '最高',
      'hint.sepia': '暖色',
      'hint.inverted': '反相',
      'hint.lowContrast': '低對比',
      'hint.highContrast': '高對比',
      'empty.noPreview': '尚無預覽',
      'empty.uploadToBegin': '上傳 PDF 後開始',
      'empty.organize': '上傳 PDF 後整理頁面。',
      'empty.organizeRemoved': '頁面已全部移除。還原原順序後繼續。',
      'empty.edit': '上傳 PDF 後裁切或旋轉頁面。',
      'preview.titleOrganize': '整理 <em>— 拖曳頁面調整順序</em>',
      'preview.titleEdit': '裁切/旋轉 <em>— 選擇一個頁面</em>',
      'preview.titleOriginal': '預覽 <em>— 原始 PDF</em>',
      'preview.titleCompress': '預覽 <em>— 壓縮匯出</em>',
      'preview.titleProcessed': '預覽 <em>— 處理結果</em>',
      'proof.awaiting': '等待上傳 PDF',
      'zoom.fit': '適應',
      'zoom.fitTitle': '點擊適應視窗',
      'proof.outputPages': '輸出 {count} 頁',
      'proof.noPages': '未選擇頁面',
      'proof.pagePixels': '{w} × {h} px · 第 {page}/{count} 頁',
      'proof.editPage': '第 {page}/{count} 頁 · {edit}',
      'proof.mergedPages': '已合併 {count} 頁',
      'progress.lockingPdf': '正在加密 PDF…',
      'progress.loadingPdf': '正在載入 PDF…',
      'progress.openingPdf': '正在開啟 PDF…',
      'progress.openingLargePdf': '正在安全開啟大型 PDF…',
      'progress.renderingPage': '正在算繪第 {page}/{count} 頁',
      'progress.renderingAtDpi': '正在以 {dpi} dpi 算繪 · 第 {page}/{count} 頁',
      'progress.resolutionCurrentPage': '解析度已設定，正在算繪目前頁面…',
      'progress.mergingPdfs': '正在合併 PDF…',
      'progress.mergingFile': '正在合併 {name}',
      'progress.renderingMergedPdf': '正在算繪合併後的 PDF…',
      'progress.exportingPages': '正在匯出頁面…',
      'progress.exportingOriginalPages': '正在匯出原始頁面…',
      'progress.exportingPageEdits': '正在匯出頁面編輯…',
      'progress.compressingPdf': '正在壓縮 PDF…',
      'progress.exportingEditedPage': '正在匯出編輯後的第 {page}/{count} 頁',
      'progress.rasterizingFineRotation': '正在以 {dpi} dpi 光柵化細微旋轉 · 第 {page}/{count} 頁',
      'progress.exportingPart': '正在匯出第 {part} 部分…',
      'progress.exportingPage': '正在匯出第 {page}/{count} 頁',
      'progress.compressingPage': '正在壓縮第 {page}/{count} 頁',
      'errors.rangeRequired': '匯出前請輸入頁碼範圍。',
      'errors.rangeFormat': '請使用 1-3、8、12-15 這樣的頁碼範圍。',
      'errors.rangeBounds': '頁碼範圍必須在 1 到 {count} 之間。',
      'errors.rangeOrder': '頁碼範圍必須由小到大。',
      'errors.rangeEmpty': '請至少選擇一頁進行匯出。',
      'errors.readPdfFailed': '無法讀取此 PDF：{error}',
      'errors.mergeFailed': '合併失敗：{error}',
      'errors.splitExportFailed': '分割匯出失敗：{error}',
      'errors.exportFailed': '匯出失敗：{error}',
      'errors.previewFailed': '預覽失敗：{error}',
      'errors.originalMissing': '原始 PDF 資料不可用。',
      'errors.noPagesExport': '沒有可匯出的頁面。',
      'errors.renderPageFailed': '無法算繪第 {page} 頁。',
      'errors.chooseMerge': '請選擇一個或多個要合併的 PDF 檔案。',
      'errors.password': '匯出加密 PDF 前請輸入密碼。',
      'errors.notPdf': '這看起來不是 PDF 檔案。',
      'organize.summaryEmpty': '上傳 PDF 後調整頁面順序或刪除頁面。',
      'organize.summarySplit': '{parts} 份 PDF 已準備好。可以改名後分別匯出。',
      'organize.summaryPages': '將匯出 {count}/{total} 頁。點頁面上的「分割」可拆成多份 PDF。',
      'organize.splits': '{count} 個分割',
      'organize.pages': '{count} 頁',
      'theme.dark': '深色模式',
      'theme.light': '淺色模式',
      'theme.onAria': '開啟深色模式',
      'theme.offAria': '關閉深色模式',
      'footer.type': '字體 SF Pro / Inter',
      'footer.clientSide': '本機處理 PDF',
      'footer.local': '全程在瀏覽器內完成',
      'tool.preview.label': '預覽',
      'tool.preview.lede': '查看 PDF，支援快速翻頁與縮放。',
      'tool.preview.meta': '開啟 PDF 查看<br/>快速切換頁面<br/>縮放不會改動檔案',
      'tool.preview.downloadLabel': '僅預覽',
      'tool.preview.downloadSub': '僅查看和縮放，不匯出',
      'tool.organize.label': '整理',
      'tool.organize.lede': '匯出前調整頁面順序或刪除頁面。',
      'tool.organize.meta': '拖曳頁面調整順序<br/>點 × 刪除頁面<br/>使用分割把 PDF 拆成多份<br/>原始頁面內容會保留',
      'tool.organize.downloadLabel': '匯出整理版 PDF',
      'tool.organize.downloadSub': '保留原始頁面內容',
      'tool.edit.label': '裁切/旋轉',
      'tool.edit.lede': '匯出前裁切或旋轉指定頁面。',
      'tool.edit.meta': '一次編輯一頁<br/>拖曳裁切框<br/>用低敏感度滑桿微調旋轉<br/>也可用 90° 按鈕旋轉頁面',
      'tool.edit.downloadLabel': '匯出編輯後的 PDF',
      'tool.edit.downloadSub': '套用頁面裁切和旋轉',
      'tool.merge.label': '合併',
      'tool.merge.lede': '把多個 PDF 合併成一個檔案。',
      'tool.merge.meta': '可選擇多個 PDF<br/>合併前可調整順序<br/>合併結果會進入整理頁',
      'tool.merge.downloadLabel': '合併 PDF',
      'tool.merge.downloadSub': '合併所選檔案',
      'tool.compress.label': '壓縮',
      'tool.compress.lede': '用簡單選項縮小 PDF 檔案。',
      'tool.compress.meta': '原畫質模式保留頁面內容<br/>平衡和小體積會輸出較輕的頁面圖片<br/>仍可加上密碼鎖定',
      'tool.compress.downloadLabel': '匯出壓縮 PDF',
      'tool.compress.downloadSub': '縮小檔案體積',
      'tool.threshold.label': '黑白',
      'tool.threshold.lede': '用閾值把 PDF 轉成黑白。',
      'tool.threshold.meta': '黑白輸出<br/>全程在本機處理<br/>閾值 · 0 → 255',
      'tool.threshold.downloadLabel': '匯出 PDF',
      'tool.threshold.downloadSub': '轉換並下載所有頁面',
      'tool.greyscale.label': '灰階',
      'tool.greyscale.lede': '用亮度和對比把 PDF 轉成灰階。',
      'tool.greyscale.meta': '灰階輸出<br/>全程在本機處理<br/>亮度與對比',
      'tool.greyscale.downloadLabel': '匯出灰階 PDF',
      'tool.greyscale.downloadSub': '轉換並下載所有頁面',
    },
    ko: {
      'brand.subtitle': 'PDF 도구',
      'nav.tools': '도구',
      'nav.toolsAria': 'PDF 도구',
      'sections.source': 'I. 원본 PDF',
      'sections.organize': 'II. 페이지 정리',
      'sections.cropRotate': 'II. 자르기/회전',
      'sections.merge': 'II. PDF 병합',
      'sections.compress': 'II. PDF 압축',
      'sections.threshold': 'II. 흑백',
      'sections.greyscale': 'II. 그레이스케일',
      'sections.pages': 'III. 페이지',
      'file.pages': '페이지',
      'file.page': '페이지',
      'file.pagePrefix': '',
      'file.pageSuffix': '페이지',
      'file.size': '크기',
      'file.status': '상태',
      'file.renameTitle': '이름 바꾸기',
      'file.removeAria': '{name} 제거',
      'status.ready': '준비됨',
      'status.readySafe': '준비됨 · 안전 모드',
      'status.loading': '불러오는 중',
      'status.error': '오류',
      'drop.uploadPdf': 'PDF 선택',
      'drop.uploadPdfs': 'PDF 여러 개 선택',
      'drop.singleSub': 'PDF · 클릭하거나 끌어오기',
      'drop.multiSub': '여러 PDF · 클릭하거나 끌어오기',
      'drop.singleAria': 'PDF 선택',
      'drop.multiAria': '하나 이상의 PDF 선택',
      'actions.clear': '지우기',
      'actions.clearList': '목록 지우기',
      'actions.restoreOrder': '원래 순서로 복원',
      'actions.resetSelectedPage': '선택한 페이지 초기화',
      'actions.reset': '초기화',
      'actions.resetThreshold': '임계값 초기화',
      'actions.resetBrightness': '밝기 초기화',
      'actions.resetContrast': '대비 초기화',
      'actions.mergeIntoOrganize': '정리 화면으로 병합',
      'actions.invert': '반전',
      'actions.sepia': '따뜻하게',
      'advanced.title': '고급 옵션',
      'advanced.currentOnly': '현재 페이지만',
      'advanced.currentOnlySub': '선택한 페이지만 내보냅니다.',
      'advanced.pageRange': '페이지 범위',
      'advanced.passwordLock': '비밀번호 잠금',
      'advanced.passwordPlaceholder': '비밀번호',
      'split.title': '분할 내보내기',
      'split.useButton': '페이지의 분할 버튼을 눌러 분할 지점을 추가하세요.',
      'split.summary': 'PDF {parts}개 · 분할 지점 {points}개.',
      'split.pointOne': '분할 지점',
      'split.pointMany': '분할 지점',
      'split.part': '{num}번째 파일',
      'split.pagesOne': '{start}페이지',
      'split.pagesMany': '{start}-{end}페이지',
      'split.nameAria': '{num}번째 파일 이름',
      'split.exportPart': '{num}번째 파일 내보내기',
      'split.button': '분할',
      'split.removeAria': '{num}번째 분할 지점 제거',
      'split.afterPage': '{num}페이지 뒤에서 분할',
      'split.removeAfterPage': '{num}페이지 뒤 분할 제거',
      'split.afterOriginal': '원본 {num}페이지 뒤에서 분할',
      'split.removeAfterOriginal': '원본 {num}페이지 뒤 분할 제거',
      'split.cannotFinal': '마지막 페이지 뒤에서는 분할할 수 없습니다',
      'edit.fineRotation': '회전 미세 조정',
      'edit.cropFrame': '자르기 영역',
      'edit.fineRotationQuality': '회전 내보내기 품질',
      'edit.fineQualityAria': '회전 미세 조정 내보내기에 Ultra 900 dpi 사용',
      'edit.qualityHigh': '높음 · 600 dpi',
      'edit.qualityUltra': 'Ultra · 900 dpi',
      'edit.selectPage': '페이지 선택',
      'edit.pageHint': '{page}페이지',
      'edit.summaryEmpty': 'PDF를 올린 뒤 자르거나 회전할 페이지를 선택하세요.',
      'edit.summaryActive': '{count}페이지 중 {page}페이지를 편집 중입니다. 변경 사항은 이 페이지에만 적용됩니다.',
      'edit.fullPage': '전체 페이지',
      'edit.cropKept': '{w}% × {h}% 유지',
      'edit.cropTotal': '총 {total}%',
      'merge.summaryEmpty': 'PDF 여러 개를 선택하고 순서를 조정한 뒤 병합하세요.',
      'merge.summaryActive': '{pdfWord} {count}개 선택됨 · {size}. 순서를 조정한 뒤 정리 화면으로 병합하세요.',
      'merge.pdfOne': 'PDF',
      'merge.pdfMany': 'PDF',
      'merge.moveUp': '{name} 위로 이동',
      'merge.moveDown': '{name} 아래로 이동',
      'merge.remove': '{name} 제거',
      'compress.original': '원본 품질',
      'compress.balanced': '균형',
      'compress.small': '작은 용량',
      'compress.hintOriginal': '원본 품질',
      'compress.hintBalanced': '균형',
      'compress.hintSmall': '작은 용량',
      'compress.summaryOriginal': '원본 페이지 내용을 최대한 유지하면서 PDF 구조를 정리합니다.',
      'compress.summaryBalanced': '화질과 용량을 균형 있게 줄인 컬러 PDF를 만듭니다.',
      'compress.summarySmall': '공유하기 쉬운 작은 용량을 우선합니다.',
      'resolution.fast': '빠르게',
      'threshold.whiteTag': '0 · 흰색',
      'threshold.blackTag': '255 · 검정',
      'greyscale.brightness': '밝기',
      'greyscale.darkTag': '−100 · 어둡게',
      'greyscale.lightTag': '+100 · 밝게',
      'greyscale.lowTag': '50% · 낮음',
      'greyscale.highTag': '200% · 높음',
      'hint.ready': '준비됨',
      'hint.low': '낮음',
      'hint.soft': '부드러움',
      'hint.midRange': '중간',
      'hint.darkRange': '어두운 범위',
      'hint.lightRange': '밝은 범위',
      'hint.high': '높음',
      'hint.neutral': '기본',
      'hint.normal': '보통',
      'hint.dark': '어두움',
      'hint.reduced': '낮춤',
      'hint.bright': '밝음',
      'hint.maximum': '최대',
      'hint.sepia': '따뜻하게',
      'hint.inverted': '반전',
      'hint.lowContrast': '낮은 대비',
      'hint.highContrast': '높은 대비',
      'empty.noPreview': '아직 미리보기가 없습니다',
      'empty.uploadToBegin': 'PDF를 올려 시작하세요',
      'empty.organize': 'PDF를 올려 페이지를 정리하세요.',
      'empty.organizeRemoved': '모든 페이지가 제거되었습니다. 원래 순서로 복원해 계속하세요.',
      'empty.edit': 'PDF를 올려 페이지를 자르거나 회전하세요.',
      'preview.titleOrganize': '정리 <em>— 페이지를 끌어 순서 변경</em>',
      'preview.titleEdit': '자르기/회전 <em>— 페이지 하나 선택</em>',
      'preview.titleOriginal': '미리보기 <em>— 원본 PDF</em>',
      'preview.titleCompress': '미리보기 <em>— 압축 내보내기</em>',
      'preview.titleProcessed': '미리보기 <em>— 처리 결과</em>',
      'proof.awaiting': 'PDF 대기 중',
      'zoom.fit': '맞춤',
      'zoom.fitTitle': '맞춤으로 보기',
      'proof.outputPages': '출력 {count}페이지',
      'proof.noPages': '선택한 페이지 없음',
      'proof.pagePixels': '{w} × {h} px · {page}/{count}페이지',
      'proof.editPage': '{page}/{count}페이지 · {edit}',
      'proof.mergedPages': '{count}페이지 병합됨',
      'progress.lockingPdf': 'PDF 암호화 중…',
      'progress.loadingPdf': 'PDF 불러오는 중…',
      'progress.openingPdf': 'PDF 여는 중…',
      'progress.openingLargePdf': '큰 PDF를 안전하게 여는 중…',
      'progress.renderingPage': '{page}/{count}페이지 렌더링 중',
      'progress.renderingAtDpi': '{dpi} dpi로 렌더링 중 · {page}/{count}페이지',
      'progress.resolutionCurrentPage': '해상도 설정 완료 · 현재 페이지 렌더링 중…',
      'progress.mergingPdfs': 'PDF 병합 중…',
      'progress.mergingFile': '{name} 병합 중',
      'progress.renderingMergedPdf': '병합된 PDF 렌더링 중…',
      'progress.exportingPages': '페이지 내보내는 중…',
      'progress.exportingOriginalPages': '원본 페이지 내보내는 중…',
      'progress.exportingPageEdits': '페이지 편집 내보내는 중…',
      'progress.compressingPdf': 'PDF 압축 중…',
      'progress.exportingEditedPage': '편집된 {page}/{count}페이지 내보내는 중',
      'progress.rasterizingFineRotation': '{dpi} dpi로 미세 회전 래스터화 중 · {page}/{count}페이지',
      'progress.exportingPart': '{part}번째 부분 내보내는 중…',
      'progress.exportingPage': '{page}/{count}페이지 내보내는 중',
      'progress.compressingPage': '{page}/{count}페이지 압축 중',
      'errors.rangeRequired': '내보내기 전에 페이지 범위를 입력하세요.',
      'errors.rangeFormat': '1-3, 8, 12-15 형식으로 페이지 범위를 입력하세요.',
      'errors.rangeBounds': '페이지 범위는 1부터 {count} 사이여야 합니다.',
      'errors.rangeOrder': '페이지 범위는 낮은 번호에서 높은 번호 순서여야 합니다.',
      'errors.rangeEmpty': '내보낼 페이지를 하나 이상 입력하세요.',
      'errors.readPdfFailed': '이 PDF를 읽을 수 없습니다: {error}',
      'errors.mergeFailed': '병합 실패: {error}',
      'errors.splitExportFailed': '분할 내보내기 실패: {error}',
      'errors.exportFailed': '내보내기 실패: {error}',
      'errors.previewFailed': '미리보기 실패: {error}',
      'errors.originalMissing': '원본 PDF 데이터를 사용할 수 없습니다.',
      'errors.noPagesExport': '내보낼 페이지가 없습니다.',
      'errors.renderPageFailed': '{page}페이지를 렌더링할 수 없습니다.',
      'organize.summaryEmpty': 'PDF를 올려 페이지 순서를 바꾸거나 삭제하세요.',
      'organize.summarySplit': 'PDF {parts}개가 준비되었습니다. 이름을 바꾼 뒤 각각 내보낼 수 있습니다.',
      'organize.summaryPages': '{total}페이지 중 {count}페이지를 내보냅니다. 페이지의 분할을 눌러 PDF를 여러 개로 나눌 수 있습니다.',
      'organize.splits': '분할 {count}개',
      'organize.pages': '{count}페이지',
      'theme.dark': '다크 모드',
      'theme.light': '라이트 모드',
      'theme.onAria': '다크 모드 켜기',
      'theme.offAria': '다크 모드 끄기',
      'footer.type': 'SF Pro / Inter 사용',
      'footer.clientSide': '로컬 PDF 처리',
      'footer.local': '브라우저 안에서만 실행',
      'errors.chooseMerge': '병합할 PDF 파일을 하나 이상 선택하세요.',
      'errors.password': '잠긴 PDF로 내보내려면 비밀번호를 입력하세요.',
      'errors.notPdf': 'PDF 파일이 아닌 것 같습니다.',
      'tool.preview.label': '미리보기',
      'tool.preview.lede': 'PDF를 보고 빠르게 페이지를 넘기거나 확대하세요.',
      'tool.preview.meta': 'PDF 열어 보기<br/>페이지 빠르게 이동<br/>확대해도 파일은 변경되지 않음',
      'tool.preview.downloadLabel': '미리보기 전용',
      'tool.preview.downloadSub': '보기와 확대만, 내보내기 없음',
      'tool.organize.label': '정리',
      'tool.organize.lede': '내보내기 전에 페이지 순서를 바꾸거나 삭제하세요.',
      'tool.organize.meta': '페이지를 끌어 순서 변경<br/>×를 눌러 페이지 삭제<br/>분할로 PDF를 여러 개로 나누기<br/>원본 페이지 내용 유지',
      'tool.organize.downloadLabel': '정리된 PDF 내보내기',
      'tool.organize.downloadSub': '원본 페이지 내용 유지',
      'tool.edit.label': '자르기/회전',
      'tool.edit.lede': '내보내기 전에 원하는 페이지를 자르거나 회전하세요.',
      'tool.edit.meta': '한 번에 한 페이지 편집<br/>자르기 영역 드래그<br/>슬라이더로 회전 미세 조정<br/>90° 버튼으로 페이지 회전',
      'tool.edit.downloadLabel': '편집된 PDF 내보내기',
      'tool.edit.downloadSub': '자르기와 회전 적용',
      'tool.merge.label': '병합',
      'tool.merge.lede': '여러 PDF를 하나의 파일로 합칩니다.',
      'tool.merge.meta': 'PDF 여러 개 선택<br/>병합 전 순서 조정<br/>결과는 정리 화면으로 열림',
      'tool.merge.downloadLabel': 'PDF 병합',
      'tool.merge.downloadSub': '선택한 파일 합치기',
      'tool.compress.label': '압축',
      'tool.compress.lede': '간단한 옵션으로 PDF 용량을 줄입니다.',
      'tool.compress.meta': '원본 품질은 페이지 내용을 유지<br/>균형과 작은 용량은 더 가벼운 페이지 이미지 생성<br/>비밀번호 잠금도 사용 가능',
      'tool.compress.downloadLabel': '압축 PDF 내보내기',
      'tool.compress.downloadSub': '파일 용량 줄이기',
      'tool.threshold.label': '흑백',
      'tool.threshold.lede': '임계값으로 PDF를 흑백으로 변환합니다.',
      'tool.threshold.meta': '흑백 출력<br/>브라우저 안에서만 처리 · 업로드 없음<br/>임계값 · 0 → 255',
      'tool.threshold.downloadLabel': 'PDF 내보내기',
      'tool.threshold.downloadSub': '모든 페이지 변환 후 다운로드',
      'tool.greyscale.label': '그레이스케일',
      'tool.greyscale.lede': '밝기와 대비로 PDF를 그레이스케일로 변환합니다.',
      'tool.greyscale.meta': '그레이스케일 출력<br/>브라우저 안에서만 처리 · 업로드 없음<br/>밝기와 대비',
      'tool.greyscale.downloadLabel': '그레이스케일 PDF 내보내기',
      'tool.greyscale.downloadSub': '모든 페이지 변환 후 다운로드',
    },
    ja: {
      'brand.subtitle': 'PDFツール',
      'nav.tools': 'ツール',
      'nav.toolsAria': 'PDFツール',
      'sections.source': 'I. 元のPDF',
      'sections.organize': 'II. ページ整理',
      'sections.cropRotate': 'II. トリミング/回転',
      'sections.merge': 'II. PDF結合',
      'sections.compress': 'II. PDF圧縮',
      'sections.threshold': 'II. 白黒',
      'sections.greyscale': 'II. グレースケール',
      'sections.pages': 'III. ページ',
      'file.pages': 'ページ',
      'file.page': 'ページ',
      'file.pagePrefix': '',
      'file.pageSuffix': 'ページ',
      'file.size': 'サイズ',
      'file.status': '状態',
      'file.renameTitle': '名前を変更',
      'file.removeAria': '{name}を削除',
      'status.ready': '準備完了',
      'status.readySafe': '準備完了 · 安全モード',
      'status.loading': '読み込み中',
      'status.error': 'エラー',
      'drop.uploadPdf': 'PDFを選択',
      'drop.uploadPdfs': '複数のPDFを選択',
      'drop.singleSub': 'PDF · クリックまたはドラッグ',
      'drop.multiSub': '複数PDF · クリックまたはドラッグ',
      'drop.singleAria': 'PDFを選択',
      'drop.multiAria': '1つ以上のPDFを選択',
      'actions.clear': 'クリア',
      'actions.clearList': 'リストをクリア',
      'actions.restoreOrder': '元の順序に戻す',
      'actions.resetSelectedPage': '選択ページをリセット',
      'actions.reset': 'リセット',
      'actions.resetThreshold': 'しきい値をリセット',
      'actions.resetBrightness': '明るさをリセット',
      'actions.resetContrast': 'コントラストをリセット',
      'actions.mergeIntoOrganize': '整理画面に結合',
      'actions.invert': '反転',
      'actions.sepia': '暖色',
      'advanced.title': '詳細オプション',
      'advanced.currentOnly': '現在のページのみ',
      'advanced.currentOnlySub': '選択中のページだけを書き出します。',
      'advanced.pageRange': 'ページ範囲',
      'advanced.passwordLock': 'パスワード保護',
      'advanced.passwordPlaceholder': 'パスワード',
      'split.title': '分割書き出し',
      'split.useButton': 'ページの分割ボタンで分割位置を追加できます。',
      'split.summary': 'PDF {parts}個 · 分割位置 {points}個。',
      'split.pointOne': '分割位置',
      'split.pointMany': '分割位置',
      'split.part': '{num}個目',
      'split.pagesOne': '{start}ページ',
      'split.pagesMany': '{start}-{end}ページ',
      'split.nameAria': '{num}個目の名前',
      'split.exportPart': '{num}個目を書き出し',
      'split.button': '分割',
      'split.removeAria': '{num}個目の分割位置を削除',
      'split.afterPage': '{num}ページの後で分割',
      'split.removeAfterPage': '{num}ページ後の分割を削除',
      'split.afterOriginal': '元の{num}ページの後で分割',
      'split.removeAfterOriginal': '元の{num}ページ後の分割を削除',
      'split.cannotFinal': '最後のページの後では分割できません',
      'edit.fineRotation': '回転の微調整',
      'edit.cropFrame': 'トリミング枠',
      'edit.fineRotationQuality': '回転書き出し品質',
      'edit.fineQualityAria': '回転微調整の書き出しにUltra 900 dpiを使用',
      'edit.qualityHigh': '高 · 600 dpi',
      'edit.qualityUltra': 'Ultra · 900 dpi',
      'edit.selectPage': 'ページを選択',
      'edit.pageHint': '{page}ページ',
      'edit.summaryEmpty': 'PDFを追加して、トリミングまたは回転するページを選択してください。',
      'edit.summaryActive': '{count}ページ中{page}ページを編集中です。変更はこのページにのみ適用されます。',
      'edit.fullPage': 'ページ全体',
      'edit.cropKept': '{w}% × {h}% を保持',
      'edit.cropTotal': '合計 {total}%',
      'merge.summaryEmpty': '複数のPDFを選択し、順序を調整して結合します。',
      'merge.summaryActive': '{pdfWord} {count}個を選択 · {size}。順序を調整して整理画面に結合します。',
      'merge.pdfOne': 'PDF',
      'merge.pdfMany': 'PDF',
      'merge.moveUp': '{name}を上へ移動',
      'merge.moveDown': '{name}を下へ移動',
      'merge.remove': '{name}を削除',
      'compress.original': '元の品質',
      'compress.balanced': 'バランス',
      'compress.small': '小容量',
      'compress.hintOriginal': '元の品質',
      'compress.hintBalanced': 'バランス',
      'compress.hintSmall': '小容量',
      'compress.summaryOriginal': '元のページ内容をできるだけ保ったまま、PDF構造を整理します。',
      'compress.summaryBalanced': '見やすさと容量のバランスを取ったカラーPDFを作成します。',
      'compress.summarySmall': '共有しやすい小さなファイルサイズを優先します。',
      'resolution.fast': '高速',
      'threshold.whiteTag': '0 · 白',
      'threshold.blackTag': '255 · 黒',
      'greyscale.brightness': '明るさ',
      'greyscale.darkTag': '−100 · 暗い',
      'greyscale.lightTag': '+100 · 明るい',
      'greyscale.lowTag': '50% · 低',
      'greyscale.highTag': '200% · 高',
      'hint.ready': '準備完了',
      'hint.low': '低',
      'hint.soft': 'ソフト',
      'hint.midRange': '中間',
      'hint.darkRange': '暗め',
      'hint.lightRange': '明るめ',
      'hint.high': '高',
      'hint.neutral': '標準',
      'hint.normal': '通常',
      'hint.dark': '暗い',
      'hint.reduced': '控えめ',
      'hint.bright': '明るい',
      'hint.maximum': '最大',
      'hint.sepia': '暖色',
      'hint.inverted': '反転',
      'hint.lowContrast': '低コントラスト',
      'hint.highContrast': '高コントラスト',
      'empty.noPreview': 'まだプレビューはありません',
      'empty.uploadToBegin': 'PDFを追加して開始',
      'empty.organize': 'PDFを追加してページを整理します。',
      'empty.organizeRemoved': 'すべてのページが削除されました。元の順序に戻して続行してください。',
      'empty.edit': 'PDFを追加してページをトリミングまたは回転します。',
      'preview.titleOrganize': '整理 <em>— ページをドラッグして並べ替え</em>',
      'preview.titleEdit': 'トリミング/回転 <em>— ページを1つ選択</em>',
      'preview.titleOriginal': 'プレビュー <em>— 元のPDF</em>',
      'preview.titleCompress': 'プレビュー <em>— 圧縮書き出し</em>',
      'preview.titleProcessed': 'プレビュー <em>— 処理結果</em>',
      'proof.awaiting': 'PDF待機中',
      'zoom.fit': '全体',
      'zoom.fitTitle': '全体表示にする',
      'proof.outputPages': '出力 {count}ページ',
      'proof.noPages': 'ページ未選択',
      'proof.pagePixels': '{w} × {h} px · {page}/{count}ページ',
      'proof.editPage': '{page}/{count}ページ · {edit}',
      'proof.mergedPages': '{count}ページを結合しました',
      'progress.lockingPdf': 'PDFを保護しています…',
      'progress.loadingPdf': 'PDFを読み込んでいます…',
      'progress.openingPdf': 'PDFを開いています…',
      'progress.openingLargePdf': '大きなPDFを安全に開いています…',
      'progress.renderingPage': '{page}/{count}ページをレンダリング中',
      'progress.renderingAtDpi': '{dpi} dpiでレンダリング中 · {page}/{count}ページ',
      'progress.resolutionCurrentPage': '解像度を設定しました · 現在のページをレンダリング中…',
      'progress.mergingPdfs': 'PDFを結合しています…',
      'progress.mergingFile': '{name}を結合しています',
      'progress.renderingMergedPdf': '結合したPDFをレンダリングしています…',
      'progress.exportingPages': 'ページを書き出しています…',
      'progress.exportingOriginalPages': '元のページを書き出しています…',
      'progress.exportingPageEdits': 'ページ編集を書き出しています…',
      'progress.compressingPdf': 'PDFを圧縮しています…',
      'progress.exportingEditedPage': '編集済みページ {page}/{count} を書き出しています',
      'progress.rasterizingFineRotation': '{dpi} dpiで微調整回転をラスタライズ中 · {page}/{count}ページ',
      'progress.exportingPart': 'パート {part} を書き出しています…',
      'progress.exportingPage': '{page}/{count}ページを書き出しています',
      'progress.compressingPage': '{page}/{count}ページを圧縮しています',
      'errors.rangeRequired': '書き出す前にページ範囲を入力してください。',
      'errors.rangeFormat': '1-3、8、12-15 のようなページ範囲を入力してください。',
      'errors.rangeBounds': 'ページ範囲は 1 から {count} までにしてください。',
      'errors.rangeOrder': 'ページ範囲は小さい番号から大きい番号の順にしてください。',
      'errors.rangeEmpty': '書き出すページを1ページ以上指定してください。',
      'errors.readPdfFailed': 'このPDFを読み込めませんでした: {error}',
      'errors.mergeFailed': '結合に失敗しました: {error}',
      'errors.splitExportFailed': '分割書き出しに失敗しました: {error}',
      'errors.exportFailed': '書き出しに失敗しました: {error}',
      'errors.previewFailed': 'プレビューに失敗しました: {error}',
      'errors.originalMissing': '元のPDFデータを利用できません。',
      'errors.noPagesExport': '書き出すページがありません。',
      'errors.renderPageFailed': '{page}ページをレンダリングできませんでした。',
      'organize.summaryEmpty': 'PDFを追加してページ順を変更または削除します。',
      'organize.summarySplit': 'PDF {parts}個の準備ができました。名前を変更して個別に書き出せます。',
      'organize.summaryPages': '{total}ページ中{count}ページを書き出します。ページの分割を使うとPDFを複数に分けられます。',
      'organize.splits': '分割 {count}個',
      'organize.pages': '{count}ページ',
      'theme.dark': 'ダークモード',
      'theme.light': 'ライトモード',
      'theme.onAria': 'ダークモードをオン',
      'theme.offAria': 'ダークモードをオフ',
      'footer.type': 'SF Pro / Inter',
      'footer.clientSide': 'ローカルPDF処理',
      'footer.local': 'すべてブラウザ内で実行',
      'errors.chooseMerge': '結合するPDFファイルを1つ以上選択してください。',
      'errors.password': '保護されたPDFとして書き出すにはパスワードを入力してください。',
      'errors.notPdf': 'PDFファイルではないようです。',
      'tool.preview.label': 'プレビュー',
      'tool.preview.lede': 'PDFを表示し、すばやくページ移動やズームができます。',
      'tool.preview.meta': 'PDFを開いて表示<br/>ページをすばやく移動<br/>ズームしてもファイルは変更されません',
      'tool.preview.downloadLabel': 'プレビューのみ',
      'tool.preview.downloadSub': '表示とズームのみ、書き出しなし',
      'tool.organize.label': '整理',
      'tool.organize.lede': '書き出し前にページ順を変更または削除します。',
      'tool.organize.meta': 'ページをドラッグして並べ替え<br/>×でページを削除<br/>分割でPDFを複数に分ける<br/>元のページ内容は保持',
      'tool.organize.downloadLabel': '整理済みPDFを書き出し',
      'tool.organize.downloadSub': '元のページ内容を保持',
      'tool.edit.label': 'トリミング/回転',
      'tool.edit.lede': '書き出し前に指定ページをトリミングまたは回転します。',
      'tool.edit.meta': '1ページずつ編集<br/>トリミング枠をドラッグ<br/>スライダーで回転を微調整<br/>90°ボタンでページ回転',
      'tool.edit.downloadLabel': '編集済みPDFを書き出し',
      'tool.edit.downloadSub': 'トリミングと回転を適用',
      'tool.merge.label': '結合',
      'tool.merge.lede': '複数のPDFを1つのファイルにまとめます。',
      'tool.merge.meta': '複数のPDFを選択<br/>結合前に順序を調整<br/>結果は整理画面で開きます',
      'tool.merge.downloadLabel': 'PDFを結合',
      'tool.merge.downloadSub': '選択したファイルを結合',
      'tool.compress.label': '圧縮',
      'tool.compress.lede': 'シンプルな設定でPDFの容量を減らします。',
      'tool.compress.meta': '元の品質はページ内容を保持<br/>バランスと小容量は軽いページ画像を作成<br/>パスワード保護も利用可能',
      'tool.compress.downloadLabel': '圧縮PDFを書き出し',
      'tool.compress.downloadSub': 'ファイルサイズを削減',
      'tool.threshold.label': '白黒',
      'tool.threshold.lede': 'しきい値でPDFを白黒に変換します。',
      'tool.threshold.meta': '白黒出力<br/>ブラウザ内のみで処理 · アップロードなし<br/>しきい値 · 0 → 255',
      'tool.threshold.downloadLabel': 'PDFを書き出し',
      'tool.threshold.downloadSub': '全ページを変換してダウンロード',
      'tool.greyscale.label': 'グレースケール',
      'tool.greyscale.lede': '明るさとコントラストでPDFをグレースケールに変換します。',
      'tool.greyscale.meta': 'グレースケール出力<br/>ブラウザ内のみで処理 · アップロードなし<br/>明るさとコントラスト',
      'tool.greyscale.downloadLabel': 'グレースケールPDFを書き出し',
      'tool.greyscale.downloadSub': '全ページを変換してダウンロード',
    },
    es: {
      'brand.subtitle': 'Herramientas PDF',
      'nav.tools': 'Herramientas',
      'sections.source': 'I. PDF de origen',
      'sections.organize': 'II. Organizar páginas',
      'sections.cropRotate': 'II. Recortar/Girar',
      'sections.merge': 'II. Unir PDF',
      'sections.compress': 'II. Comprimir PDF',
      'sections.threshold': 'II. Umbral',
      'sections.greyscale': 'II. Escala de grises',
      'sections.pages': 'III. Páginas',
      'file.pages': 'Páginas',
      'file.page': 'Página',
      'file.pagePrefix': 'Página ',
      'file.pageSuffix': '',
      'file.size': 'Tamaño',
      'file.status': 'Estado',
      'file.renameTitle': 'Haz clic para cambiar el nombre',
      'file.removeAria': 'Quitar {name}',
      'status.ready': 'listo',
      'status.readySafe': 'listo · seguro',
      'status.loading': 'cargando',
      'status.error': 'error',
      'drop.uploadPdf': 'Subir PDF',
      'drop.uploadPdfs': 'Subir PDFs',
      'drop.singleSub': 'PDF · clic o arrastra',
      'drop.multiSub': 'Varios PDF · clic o arrastra',
      'drop.singleAria': 'Subir un PDF',
      'drop.multiAria': 'Subir uno o más PDF',
      'actions.clear': 'Borrar',
      'actions.clearList': 'Borrar lista',
      'actions.restoreOrder': 'Restaurar orden original',
      'actions.resetSelectedPage': 'Restablecer página seleccionada',
      'actions.reset': 'Restablecer',
      'actions.resetThreshold': 'Restablecer umbral',
      'actions.resetBrightness': 'Restablecer brillo',
      'actions.resetContrast': 'Restablecer contraste',
      'actions.mergeIntoOrganize': 'Unir en Organizar',
      'actions.invert': 'Invertir',
      'actions.sepia': 'Sepia',
      'advanced.title': 'Opciones avanzadas',
      'advanced.currentOnly': 'Solo página actual',
      'advanced.currentOnlySub': 'Exporta solo la página seleccionada.',
      'advanced.pageRange': 'Rango de páginas',
      'advanced.passwordLock': 'Bloqueo con contraseña',
      'advanced.passwordPlaceholder': 'Contraseña',
      'split.title': 'Exportar división',
      'split.useButton': 'Usa el botón Dividir de una página en Organizar para crear una división.',
      'split.summary': '{parts} PDF desde {points} {pointWord}.',
      'split.pointOne': 'punto de división',
      'split.pointMany': 'puntos de división',
      'split.part': 'Parte {num}',
      'split.pagesOne': 'Página {start}',
      'split.pagesMany': 'Páginas {start}-{end}',
      'split.nameAria': 'Nombre de la parte {num}',
      'split.exportPart': 'Exportar parte {num}',
      'split.button': 'Dividir',
      'split.removeAria': 'Quitar división {num}',
      'split.afterPage': 'Dividir después de la página {num}',
      'split.removeAfterPage': 'Quitar división después de la página {num}',
      'split.afterOriginal': 'Dividir después de la página original {num}',
      'split.removeAfterOriginal': 'Quitar división después de la página original {num}',
      'split.cannotFinal': 'No se puede dividir después de la última página',
      'edit.fineRotation': 'Rotación fina',
      'edit.cropFrame': 'Marco de recorte',
      'edit.fineRotationQuality': 'Calidad de rotación fina',
      'edit.fineQualityAria': 'Usar ultra 900 dpi para exportar la rotación fina',
      'edit.qualityHigh': 'Alta · 600 dpi',
      'edit.qualityUltra': 'Ultra · 900 dpi',
      'edit.selectPage': 'selecciona página',
      'edit.pageHint': 'página {page}',
      'edit.summaryEmpty': 'Sube un PDF y elige una página en el editor para recortarla o girarla.',
      'edit.summaryActive': 'Editando página {page} de {count}. Los cambios solo afectan esta página.',
      'edit.fullPage': 'Página completa',
      'edit.cropKept': '{w}% × {h}% conservado',
      'edit.cropTotal': '{total}% total',
      'merge.summaryEmpty': 'Elige varios PDF, ordena la lista y únelos en el organizador.',
      'merge.summaryActive': '{count} {pdfWord} seleccionados · {size}. Ordena la lista y únelos en Organizar.',
      'merge.pdfOne': 'PDF',
      'merge.pdfMany': 'PDF',
      'merge.moveUp': 'Mover {name} arriba',
      'merge.moveDown': 'Mover {name} abajo',
      'merge.remove': 'Quitar {name}',
      'compress.original': 'Original',
      'compress.balanced': 'Equilibrado',
      'compress.small': 'Pequeño',
      'compress.hintOriginal': 'original',
      'compress.hintBalanced': 'equilibrado',
      'compress.hintSmall': 'pequeño',
      'compress.summaryOriginal': 'Compacta el PDF conservando el contenido original de las páginas.',
      'compress.summaryBalanced': 'Crea un PDF en color más pequeño con calidad equilibrada.',
      'compress.summarySmall': 'Crea el PDF más pequeño con imágenes de página más ligeras.',
      'resolution.fast': 'Rápido',
      'threshold.whiteTag': '0 · blanco',
      'threshold.blackTag': '255 · negro',
      'greyscale.brightness': 'brillo',
      'greyscale.darkTag': '−100 · oscuro',
      'greyscale.lightTag': '+100 · claro',
      'greyscale.lowTag': '50% · bajo',
      'greyscale.highTag': '200% · alto',
      'hint.ready': 'listo',
      'hint.low': 'bajo',
      'hint.soft': 'suave',
      'hint.midRange': 'rango medio',
      'hint.darkRange': 'rango oscuro',
      'hint.lightRange': 'rango claro',
      'hint.high': 'alto',
      'hint.neutral': 'neutral',
      'hint.normal': 'normal',
      'hint.dark': 'oscuro',
      'hint.reduced': 'reducido',
      'hint.bright': 'claro',
      'hint.maximum': 'máximo',
      'hint.sepia': 'sepia',
      'hint.inverted': 'invertido',
      'hint.lowContrast': 'bajo contraste',
      'hint.highContrast': 'alto contraste',
      'empty.noPreview': 'Sin vista previa',
      'empty.uploadToBegin': 'Sube un PDF para empezar',
      'empty.organize': 'Sube un PDF para organizar páginas.',
      'empty.organizeRemoved': 'Se han quitado todas las páginas. Restaura el orden original para continuar.',
      'empty.edit': 'Sube un PDF para recortar o girar páginas.',
      'preview.titleOrganize': 'Organizar <em>— arrastra páginas para reordenarlas</em>',
      'preview.titleEdit': 'Recortar/Girar <em>— selecciona una página</em>',
      'preview.titleOriginal': 'Vista previa <em>— PDF original</em>',
      'preview.titleCompress': 'Vista previa <em>— exportación comprimida</em>',
      'preview.titleProcessed': 'Vista previa <em>— resultado procesado</em>',
      'proof.awaiting': 'esperando PDF',
      'zoom.fit': 'ajustar',
      'zoom.fitTitle': 'Haz clic para ajustar',
      'proof.outputPages': '{count} páginas en la salida',
      'proof.noPages': 'sin páginas seleccionadas',
      'proof.pagePixels': '{w} × {h} px · página {page}/{count}',
      'proof.editPage': 'página {page}/{count} · {edit}',
      'proof.mergedPages': '{count} páginas unidas',
      'progress.lockingPdf': 'Protegiendo PDF…',
      'progress.loadingPdf': 'Cargando PDF…',
      'progress.openingPdf': 'Abriendo PDF…',
      'progress.openingLargePdf': 'Abriendo PDF grande de forma segura…',
      'progress.renderingPage': 'Renderizando página {page} de {count}',
      'progress.renderingAtDpi': 'Renderizando a {dpi} dpi · página {page} / {count}',
      'progress.resolutionCurrentPage': 'Resolución aplicada · renderizando página actual…',
      'progress.mergingPdfs': 'Uniendo PDF…',
      'progress.mergingFile': 'Uniendo {name}',
      'progress.renderingMergedPdf': 'Renderizando PDF unido…',
      'progress.exportingPages': 'Exportando páginas…',
      'progress.exportingOriginalPages': 'Exportando páginas originales…',
      'progress.exportingPageEdits': 'Exportando ediciones de página…',
      'progress.compressingPdf': 'Comprimiendo PDF…',
      'progress.exportingEditedPage': 'Exportando página editada {page} de {count}',
      'progress.rasterizingFineRotation': 'Rasterizando rotación fina a {dpi} dpi · página {page} de {count}',
      'progress.exportingPart': 'Exportando parte {part}…',
      'progress.exportingPage': 'Exportando página {page} de {count}',
      'progress.compressingPage': 'Comprimiendo página {page} de {count}',
      'errors.rangeRequired': 'Introduce un rango de páginas antes de exportar.',
      'errors.rangeFormat': 'Usa rangos como 1-3, 8, 12-15.',
      'errors.rangeBounds': 'El rango debe estar entre 1 y {count}.',
      'errors.rangeOrder': 'Los rangos deben ir de menor a mayor.',
      'errors.rangeEmpty': 'Introduce al menos una página para exportar.',
      'errors.readPdfFailed': 'No se pudo leer este PDF: {error}',
      'errors.mergeFailed': 'Error al unir: {error}',
      'errors.splitExportFailed': 'Error al exportar la división: {error}',
      'errors.exportFailed': 'Error al exportar: {error}',
      'errors.previewFailed': 'Error en la vista previa: {error}',
      'errors.originalMissing': 'Los datos del PDF original no están disponibles.',
      'errors.noPagesExport': 'No hay páginas para exportar.',
      'errors.renderPageFailed': 'No se pudo renderizar la página {page}.',
      'errors.chooseMerge': 'Elige uno o más PDF para unir.',
      'errors.password': 'Introduce una contraseña antes de exportar un PDF protegido.',
      'errors.notPdf': 'Ese archivo no parece ser un PDF.',
      'organize.summaryEmpty': 'Sube un PDF para reordenar o quitar páginas.',
      'organize.summarySplit': '{parts} PDF listos. Edita los nombres y exporta cada parte desde el panel de división.',
      'organize.summaryPages': 'Se exportarán {count} de {total} páginas originales. Usa Dividir en una página para separar el PDF.',
      'organize.splits': '{count} divisiones',
      'organize.pages': '{count} páginas',
      'theme.dark': 'Modo oscuro',
      'theme.light': 'Modo claro',
      'theme.onAria': 'Activar modo oscuro',
      'theme.offAria': 'Desactivar modo oscuro',
      'footer.type': 'Con SF Pro / Inter',
      'footer.clientSide': 'Procesamiento PDF en el navegador',
      'footer.local': 'Funciona íntegramente en tu navegador',
      'tool.preview.label': 'Vista previa',
      'tool.preview.lede': 'Visualiza un PDF con navegación rápida y zoom.',
      'tool.preview.meta': 'Abre un PDF para verlo<br/>Usa la navegación de páginas<br/>El zoom no cambia el archivo',
      'tool.preview.downloadLabel': 'Solo vista previa',
      'tool.preview.downloadSub': 'ver y ampliar sin exportar',
      'tool.organize.label': 'Organizar',
      'tool.organize.lede': 'Reordena o elimina páginas antes de exportar.',
      'tool.organize.meta': 'Arrastra páginas para reordenarlas<br/>Haz clic en × para quitar una página<br/>Usa Dividir para separar después de una página<br/>Se conserva el contenido original',
      'tool.organize.downloadLabel': 'Exportar PDF organizado',
      'tool.organize.downloadSub': 'conservar contenido original',
      'tool.edit.label': 'Recortar/Girar',
      'tool.edit.lede': 'Recorta y gira páginas individuales antes de exportar.',
      'tool.edit.meta': 'Selecciona una página a la vez<br/>Arrastra el marco de recorte<br/>Ajusta la rotación con un control fino<br/>Usa botones de 90° para girar páginas',
      'tool.edit.downloadLabel': 'Exportar PDF editado',
      'tool.edit.downloadSub': 'aplicar recortes y rotaciones',
      'tool.merge.label': 'Unir',
      'tool.merge.lede': 'Une varios PDF en un documento organizado.',
      'tool.merge.meta': 'Selecciona cualquier cantidad de PDF<br/>Reordena archivos antes de unirlos<br/>El resultado se abre en Organizar',
      'tool.merge.downloadLabel': 'Unir PDF',
      'tool.merge.downloadSub': 'combinar archivos seleccionados',
      'tool.compress.label': 'Comprimir',
      'tool.compress.lede': 'Reduce el tamaño del PDF con opciones simples de calidad.',
      'tool.compress.meta': 'Original conserva el contenido<br/>Equilibrado y Pequeño crean imágenes de página más ligeras<br/>El bloqueo con contraseña sigue funcionando',
      'tool.compress.downloadLabel': 'Exportar PDF comprimido',
      'tool.compress.downloadSub': 'reducir tamaño del archivo',
      'tool.threshold.label': 'Umbral',
      'tool.threshold.lede': 'Convierte PDF a blanco y negro con control de umbral.',
      'tool.threshold.meta': 'Salida en blanco y negro<br/>Solo en tu navegador · sin subida<br/>Umbral · 0 → 255',
      'tool.threshold.downloadLabel': 'Exportar PDF',
      'tool.threshold.downloadSub': 'renderizar y descargar todas las páginas',
      'tool.greyscale.label': 'Grises',
      'tool.greyscale.lede': 'Convierte PDF a escala de grises con brillo y contraste.',
      'tool.greyscale.meta': 'Salida en escala de grises<br/>Solo en tu navegador · sin subida<br/>Brillo y contraste',
      'tool.greyscale.downloadLabel': 'Exportar PDF en grises',
      'tool.greyscale.downloadSub': 'renderizar y descargar todas las páginas',
    },
    fr: {
      'brand.subtitle': 'Outils PDF',
      'nav.tools': 'Outils',
      'sections.source': 'I. PDF source',
      'sections.organize': 'II. Organiser les pages',
      'sections.cropRotate': 'II. Recadrer/Pivoter',
      'sections.merge': 'II. Fusionner des PDF',
      'sections.compress': 'II. Compresser le PDF',
      'sections.threshold': 'II. Seuil',
      'sections.greyscale': 'II. Niveaux de gris',
      'sections.pages': 'III. Pages',
      'file.pages': 'Pages',
      'file.page': 'Page',
      'file.pagePrefix': 'Page ',
      'file.pageSuffix': '',
      'file.size': 'Taille',
      'file.status': 'État',
      'file.renameTitle': 'Cliquer pour renommer',
      'file.removeAria': 'Supprimer {name}',
      'status.ready': 'prêt',
      'status.readySafe': 'prêt · sécurisé',
      'status.loading': 'chargement',
      'status.error': 'erreur',
      'drop.uploadPdf': 'Importer un PDF',
      'drop.uploadPdfs': 'Importer des PDF',
      'drop.singleSub': 'PDF · cliquer ou déposer',
      'drop.multiSub': 'Plusieurs PDF · cliquer ou déposer',
      'drop.singleAria': 'Importer un PDF',
      'drop.multiAria': 'Importer un ou plusieurs PDF',
      'actions.clear': 'Effacer',
      'actions.clearList': 'Vider la liste',
      'actions.restoreOrder': 'Restaurer l’ordre d’origine',
      'actions.resetSelectedPage': 'Réinitialiser la page',
      'actions.reset': 'Réinitialiser',
      'actions.resetThreshold': 'Réinitialiser le seuil',
      'actions.resetBrightness': 'Réinitialiser la luminosité',
      'actions.resetContrast': 'Réinitialiser le contraste',
      'actions.mergeIntoOrganize': 'Fusionner dans Organiser',
      'actions.invert': 'Inverser',
      'actions.sepia': 'Sépia',
      'advanced.title': 'Options avancées',
      'advanced.currentOnly': 'Page actuelle uniquement',
      'advanced.currentOnlySub': 'Exporte seulement la page sélectionnée.',
      'advanced.pageRange': 'Plage de pages',
      'advanced.passwordLock': 'Verrouillage par mot de passe',
      'advanced.passwordPlaceholder': 'Mot de passe',
      'split.title': 'Export scindé',
      'split.useButton': 'Utilisez le bouton Scinder sur une page dans Organiser pour créer une séparation.',
      'split.summary': '{parts} PDF à partir de {points} {pointWord}.',
      'split.pointOne': 'point de séparation',
      'split.pointMany': 'points de séparation',
      'split.part': 'Partie {num}',
      'split.pagesOne': 'Page {start}',
      'split.pagesMany': 'Pages {start}-{end}',
      'split.nameAria': 'Nom de la partie {num}',
      'split.exportPart': 'Exporter la partie {num}',
      'split.button': 'Scinder',
      'split.removeAria': 'Supprimer la séparation {num}',
      'split.afterPage': 'Scinder après la page {num}',
      'split.removeAfterPage': 'Supprimer la séparation après la page {num}',
      'split.afterOriginal': 'Scinder après la page originale {num}',
      'split.removeAfterOriginal': 'Supprimer la séparation après la page originale {num}',
      'split.cannotFinal': 'Impossible de scinder après la dernière page',
      'edit.fineRotation': 'Rotation fine',
      'edit.cropFrame': 'Cadre de recadrage',
      'edit.fineRotationQuality': 'Qualité de rotation fine',
      'edit.fineQualityAria': 'Utiliser ultra 900 dpi pour exporter la rotation fine',
      'edit.qualityHigh': 'Haute · 600 dpi',
      'edit.qualityUltra': 'Ultra · 900 dpi',
      'edit.selectPage': 'sélectionner une page',
      'edit.pageHint': 'page {page}',
      'edit.summaryEmpty': 'Importez un PDF, puis choisissez une page à recadrer ou faire pivoter.',
      'edit.summaryActive': 'Modification de la page {page} sur {count}. Les changements ne touchent que cette page.',
      'edit.fullPage': 'Page complète',
      'edit.cropKept': '{w}% × {h}% conservé',
      'edit.cropTotal': '{total}% au total',
      'merge.summaryEmpty': 'Choisissez plusieurs PDF, organisez leur ordre, puis fusionnez-les.',
      'merge.summaryActive': '{count} {pdfWord} sélectionnés · {size}. Organisez la liste, puis fusionnez dans Organiser.',
      'merge.pdfOne': 'PDF',
      'merge.pdfMany': 'PDF',
      'merge.moveUp': 'Déplacer {name} vers le haut',
      'merge.moveDown': 'Déplacer {name} vers le bas',
      'merge.remove': 'Supprimer {name}',
      'compress.original': 'Original',
      'compress.balanced': 'Équilibré',
      'compress.small': 'Petit',
      'compress.hintOriginal': 'original',
      'compress.hintBalanced': 'équilibré',
      'compress.hintSmall': 'petit',
      'compress.summaryOriginal': 'Compacte le PDF tout en conservant le contenu original des pages.',
      'compress.summaryBalanced': 'Crée un PDF couleur plus léger avec une qualité équilibrée.',
      'compress.summarySmall': 'Crée le PDF le plus léger avec des images de page allégées.',
      'resolution.fast': 'Rapide',
      'threshold.whiteTag': '0 · blanc',
      'threshold.blackTag': '255 · noir',
      'greyscale.brightness': 'luminosité',
      'greyscale.darkTag': '−100 · sombre',
      'greyscale.lightTag': '+100 · clair',
      'greyscale.lowTag': '50% · faible',
      'greyscale.highTag': '200% · élevé',
      'hint.ready': 'prêt',
      'hint.low': 'bas',
      'hint.soft': 'doux',
      'hint.midRange': 'milieu',
      'hint.darkRange': 'plage sombre',
      'hint.lightRange': 'plage claire',
      'hint.high': 'haut',
      'hint.neutral': 'neutre',
      'hint.normal': 'normal',
      'hint.dark': 'sombre',
      'hint.reduced': 'réduit',
      'hint.bright': 'clair',
      'hint.maximum': 'maximum',
      'hint.sepia': 'sépia',
      'hint.inverted': 'inversé',
      'hint.lowContrast': 'faible contraste',
      'hint.highContrast': 'contraste élevé',
      'empty.noPreview': 'Aucun aperçu',
      'empty.uploadToBegin': 'Importez un PDF pour commencer',
      'empty.organize': 'Importez un PDF pour organiser les pages.',
      'empty.organizeRemoved': 'Toutes les pages ont été supprimées. Restaurez l’ordre d’origine pour continuer.',
      'empty.edit': 'Importez un PDF pour recadrer ou faire pivoter les pages.',
      'preview.titleOrganize': 'Organiser <em>— faites glisser les pages pour les réordonner</em>',
      'preview.titleEdit': 'Recadrer/Pivoter <em>— sélectionnez une page</em>',
      'preview.titleOriginal': 'Aperçu <em>— PDF original</em>',
      'preview.titleCompress': 'Aperçu <em>— export compressé</em>',
      'preview.titleProcessed': 'Aperçu <em>— résultat traité</em>',
      'proof.awaiting': 'en attente du PDF',
      'zoom.fit': 'ajuster',
      'zoom.fitTitle': 'Cliquer pour ajuster',
      'proof.outputPages': '{count} pages en sortie',
      'proof.noPages': 'aucune page sélectionnée',
      'proof.pagePixels': '{w} × {h} px · page {page}/{count}',
      'proof.editPage': 'page {page}/{count} · {edit}',
      'proof.mergedPages': '{count} pages fusionnées',
      'progress.lockingPdf': 'Protection du PDF…',
      'progress.loadingPdf': 'Chargement du PDF…',
      'progress.openingPdf': 'Ouverture du PDF…',
      'progress.openingLargePdf': 'Ouverture sécurisée du grand PDF…',
      'progress.renderingPage': 'Rendu de la page {page} sur {count}',
      'progress.renderingAtDpi': 'Rendu à {dpi} dpi · page {page} / {count}',
      'progress.resolutionCurrentPage': 'Résolution appliquée · rendu de la page active…',
      'progress.mergingPdfs': 'Fusion des PDF…',
      'progress.mergingFile': 'Fusion de {name}',
      'progress.renderingMergedPdf': 'Rendu du PDF fusionné…',
      'progress.exportingPages': 'Export des pages…',
      'progress.exportingOriginalPages': 'Export des pages originales…',
      'progress.exportingPageEdits': 'Export des modifications de page…',
      'progress.compressingPdf': 'Compression du PDF…',
      'progress.exportingEditedPage': 'Export de la page modifiée {page} sur {count}',
      'progress.rasterizingFineRotation': 'Pixellisation de la rotation fine à {dpi} dpi · page {page} sur {count}',
      'progress.exportingPart': 'Export de la partie {part}…',
      'progress.exportingPage': 'Export de la page {page} sur {count}',
      'progress.compressingPage': 'Compression de la page {page} sur {count}',
      'errors.rangeRequired': 'Saisissez une plage de pages avant d’exporter.',
      'errors.rangeFormat': 'Utilisez des plages comme 1-3, 8, 12-15.',
      'errors.rangeBounds': 'La plage doit rester entre 1 et {count}.',
      'errors.rangeOrder': 'Les plages doivent aller du plus petit au plus grand numéro.',
      'errors.rangeEmpty': 'Saisissez au moins une page à exporter.',
      'errors.readPdfFailed': 'Impossible de lire ce PDF : {error}',
      'errors.mergeFailed': 'Échec de la fusion : {error}',
      'errors.splitExportFailed': 'Échec de l’export de la séparation : {error}',
      'errors.exportFailed': 'Échec de l’export : {error}',
      'errors.previewFailed': 'Échec de l’aperçu : {error}',
      'errors.originalMissing': 'Les données du PDF original ne sont pas disponibles.',
      'errors.noPagesExport': 'Aucune page à exporter.',
      'errors.renderPageFailed': 'Impossible de rendre la page {page}.',
      'errors.chooseMerge': 'Choisissez un ou plusieurs PDF à fusionner.',
      'errors.password': 'Saisissez un mot de passe avant d’exporter un PDF protégé.',
      'errors.notPdf': 'Ce fichier ne semble pas être un PDF.',
      'organize.summaryEmpty': 'Importez un PDF pour réordonner ou supprimer des pages.',
      'organize.summarySplit': '{parts} PDF sont prêts. Modifiez les noms et exportez chaque partie depuis le panneau de séparation.',
      'organize.summaryPages': '{count} pages originales sur {total} seront incluses dans l’export. Utilisez Scinder sur une page pour séparer le PDF.',
      'organize.splits': '{count} séparations',
      'organize.pages': '{count} pages',
      'theme.dark': 'Mode sombre',
      'theme.light': 'Mode clair',
      'theme.onAria': 'Activer le mode sombre',
      'theme.offAria': 'Désactiver le mode sombre',
      'footer.type': 'En SF Pro / Inter',
      'footer.clientSide': 'Traitement PDF côté navigateur',
      'footer.local': 'Fonctionne entièrement dans votre navigateur',
      'tool.preview.label': 'Aperçu',
      'tool.preview.lede': 'Consultez un PDF avec navigation rapide et zoom.',
      'tool.preview.meta': 'Ouvrir un PDF pour le consulter<br/>Utiliser la navigation de pages<br/>Zoomer sans modifier le fichier',
      'tool.preview.downloadLabel': 'Aperçu seul',
      'tool.preview.downloadSub': 'voir et zoomer sans exporter',
      'tool.organize.label': 'Organiser',
      'tool.organize.lede': 'Réorganisez ou supprimez des pages avant export.',
      'tool.organize.meta': 'Faites glisser les pages pour les réordonner<br/>Cliquez sur × pour supprimer une page<br/>Utilisez Scinder pour séparer après une page<br/>Les pages originales sont conservées',
      'tool.organize.downloadLabel': 'Exporter le PDF organisé',
      'tool.organize.downloadSub': 'conserver le contenu original',
      'tool.edit.label': 'Recadrer/Pivoter',
      'tool.edit.lede': 'Recadrez et faites pivoter des pages avant export.',
      'tool.edit.meta': 'Sélectionnez une page à la fois<br/>Faites glisser le cadre de recadrage<br/>Ajustez la rotation avec un curseur fin<br/>Utilisez les boutons 90° pour pivoter',
      'tool.edit.downloadLabel': 'Exporter le PDF modifié',
      'tool.edit.downloadSub': 'appliquer recadrages et rotations',
      'tool.merge.label': 'Fusionner',
      'tool.merge.lede': 'Fusionnez plusieurs PDF en un document organisé.',
      'tool.merge.meta': 'Sélectionnez autant de PDF que nécessaire<br/>Réordonnez les fichiers avant fusion<br/>Le résultat s’ouvre dans Organiser',
      'tool.merge.downloadLabel': 'Fusionner les PDF',
      'tool.merge.downloadSub': 'combiner les fichiers sélectionnés',
      'tool.compress.label': 'Compresser',
      'tool.compress.lede': 'Réduisez la taille du PDF avec des choix simples.',
      'tool.compress.meta': 'Original conserve le contenu des pages<br/>Équilibré et Petit créent des images de page plus légères<br/>Le verrouillage par mot de passe fonctionne toujours',
      'tool.compress.downloadLabel': 'Exporter le PDF compressé',
      'tool.compress.downloadSub': 'réduire la taille du fichier',
      'tool.threshold.label': 'Seuil',
      'tool.threshold.lede': 'Convertissez les PDF en noir et blanc avec un seuil réglable.',
      'tool.threshold.meta': 'Sortie noir et blanc<br/>Dans le navigateur uniquement · aucun envoi<br/>Seuil · 0 → 255',
      'tool.threshold.downloadLabel': 'Exporter le PDF',
      'tool.threshold.downloadSub': 'rendre et télécharger toutes les pages',
      'tool.greyscale.label': 'Gris',
      'tool.greyscale.lede': 'Convertissez les PDF en niveaux de gris avec luminosité et contraste.',
      'tool.greyscale.meta': 'Sortie en niveaux de gris<br/>Dans le navigateur uniquement · aucun envoi<br/>Luminosité et contraste',
      'tool.greyscale.downloadLabel': 'Exporter le PDF en gris',
      'tool.greyscale.downloadSub': 'rendre et télécharger toutes les pages',
    },
  });

  const SIGN_LOCALES = {
    en: {
      'sections.sign': 'II. Sign PDF',
      'preview.titleSign': 'Sign <em>— drag your signature onto the page</em>',
      'progress.exportingSignedPdf': 'Exporting signed PDF…',
      'errors.noSignature': 'Draw a signature and place it on the PDF before exporting.',
      'errors.signaturePageMissing': 'The signed page is not included in this export.',
      'sign.padAria': 'Signature drawing pad',
      'sign.clear': 'Clear',
      'sign.removeSelected': 'Remove selected',
      'sign.drawSignature': 'draw signature',
      'sign.ready': 'ready to place',
      'sign.drawFirst': 'Draw a signature first',
      'sign.dragToPage': 'Drag signature to the PDF',
      'sign.uploadPdf': 'Upload a PDF to place it',
      'sign.summaryEmpty': 'Draw a signature, then drag it onto the page.',
      'sign.summaryNoPdf': 'Upload a PDF after drawing your signature.',
      'sign.summaryReady': 'Drag the signature onto the page preview.',
      'sign.summaryPlaced': 'Signature placed on page {page}. Drag it again to adjust.',
      'sign.summaryPlacedCount': '{count} signatures placed. Drag to move; drag corners to resize.',
      'tool.sign.label': 'Sign',
      'tool.sign.lede': 'Draw a signature and place it directly on a PDF page.',
      'tool.sign.meta': 'Draw your signature locally<br/>Drag it onto the page preview<br/>Export without rasterizing the PDF',
      'tool.sign.downloadLabel': 'Export Signed PDF',
      'tool.sign.downloadSub': 'stamp the signature onto the PDF',
    },
    'zh-Hans': {
      'sections.sign': 'II. 签署 PDF',
      'preview.titleSign': '签署 <em>— 将签名拖到页面上</em>',
      'progress.exportingSignedPdf': '正在导出签署后的 PDF…',
      'errors.noSignature': '请先绘制签名并放到 PDF 上，再进行导出。',
      'errors.signaturePageMissing': '包含签名的页面不在本次导出范围内。',
      'sign.padAria': '签名绘制区域',
      'sign.clear': '清除',
      'sign.removeSelected': '移除所选',
      'sign.drawSignature': '绘制签名',
      'sign.ready': '可放置',
      'sign.drawFirst': '请先绘制签名',
      'sign.dragToPage': '将签名拖到 PDF 上',
      'sign.uploadPdf': '上传 PDF 后即可放置',
      'sign.summaryEmpty': '绘制签名后，将它拖到页面上。',
      'sign.summaryNoPdf': '绘制签名后请上传 PDF。',
      'sign.summaryReady': '将签名拖到页面预览中。',
      'sign.summaryPlaced': '签名已放在第 {page} 页。可继续拖动调整位置。',
      'sign.summaryPlacedCount': '已放置 {count} 个签名。拖动可移动，拖动角点可调整大小。',
      'tool.sign.label': '签署',
      'tool.sign.lede': '绘制签名并直接放到 PDF 页面上。',
      'tool.sign.meta': '本地绘制签名<br/>拖到页面预览中<br/>导出时不栅格化 PDF',
      'tool.sign.downloadLabel': '导出签署后的 PDF',
      'tool.sign.downloadSub': '将签名盖到 PDF 上',
    },
    'zh-Hant-TW': {
      'sections.sign': 'II. 簽署 PDF',
      'preview.titleSign': '簽署 <em>— 將簽名拖到頁面上</em>',
      'progress.exportingSignedPdf': '正在匯出簽署後的 PDF…',
      'errors.noSignature': '請先繪製簽名並放到 PDF 上，再進行匯出。',
      'errors.signaturePageMissing': '包含簽名的頁面不在本次匯出範圍內。',
      'sign.padAria': '簽名繪製區域',
      'sign.clear': '清除',
      'sign.removeSelected': '移除所選',
      'sign.drawSignature': '繪製簽名',
      'sign.ready': '可放置',
      'sign.drawFirst': '請先繪製簽名',
      'sign.dragToPage': '將簽名拖到 PDF 上',
      'sign.uploadPdf': '上傳 PDF 後即可放置',
      'sign.summaryEmpty': '繪製簽名後，將它拖到頁面上。',
      'sign.summaryNoPdf': '繪製簽名後請上傳 PDF。',
      'sign.summaryReady': '將簽名拖到頁面預覽中。',
      'sign.summaryPlaced': '簽名已放在第 {page} 頁。可繼續拖曳調整位置。',
      'sign.summaryPlacedCount': '已放置 {count} 個簽名。拖曳可移動，拖曳角點可調整大小。',
      'tool.sign.label': '簽署',
      'tool.sign.lede': '繪製簽名並直接放到 PDF 頁面上。',
      'tool.sign.meta': '本機繪製簽名<br/>拖到頁面預覽中<br/>匯出時不光柵化 PDF',
      'tool.sign.downloadLabel': '匯出簽署後的 PDF',
      'tool.sign.downloadSub': '將簽名加到 PDF 上',
    },
    ko: {
      'sections.sign': 'II. PDF 서명',
      'preview.titleSign': '서명 <em>— 서명을 페이지 위로 끌어 놓기</em>',
      'progress.exportingSignedPdf': '서명된 PDF 내보내는 중…',
      'errors.noSignature': '내보내기 전에 서명을 그리고 PDF에 배치하세요.',
      'errors.signaturePageMissing': '서명된 페이지가 이번 내보내기에 포함되어 있지 않습니다.',
      'sign.padAria': '서명 입력 패드',
      'sign.clear': '지우기',
      'sign.removeSelected': '선택 항목 제거',
      'sign.drawSignature': '서명 그리기',
      'sign.ready': '배치 가능',
      'sign.drawFirst': '먼저 서명을 그리세요',
      'sign.dragToPage': '서명을 PDF로 끌어 놓기',
      'sign.uploadPdf': 'PDF를 업로드하면 배치할 수 있습니다',
      'sign.summaryEmpty': '서명을 그린 뒤 페이지 위로 끌어 놓으세요.',
      'sign.summaryNoPdf': '서명을 그린 뒤 PDF를 업로드하세요.',
      'sign.summaryReady': '서명을 페이지 미리보기 위로 끌어 놓으세요.',
      'sign.summaryPlaced': '{page}페이지에 서명이 배치되었습니다. 다시 끌어 위치를 조정하세요.',
      'sign.summaryPlacedCount': '서명 {count}개가 배치되었습니다. 끌어서 이동하고 모서리를 끌어 크기를 조정하세요.',
      'tool.sign.label': '서명',
      'tool.sign.lede': '서명을 그려 PDF 페이지에 바로 배치합니다.',
      'tool.sign.meta': '브라우저에서 서명 그리기<br/>페이지 미리보기로 끌어 놓기<br/>PDF를 래스터화하지 않고 내보내기',
      'tool.sign.downloadLabel': '서명된 PDF 내보내기',
      'tool.sign.downloadSub': 'PDF에 서명 추가',
    },
    ja: {
      'sections.sign': 'II. PDFに署名',
      'preview.titleSign': '署名 <em>— 署名をページ上へドラッグ</em>',
      'progress.exportingSignedPdf': '署名済みPDFを書き出しています…',
      'errors.noSignature': '書き出す前に署名を描いてPDF上に配置してください。',
      'errors.signaturePageMissing': '署名したページが今回の書き出し範囲に含まれていません。',
      'sign.padAria': '署名入力パッド',
      'sign.clear': '消去',
      'sign.removeSelected': '選択を削除',
      'sign.drawSignature': '署名を描く',
      'sign.ready': '配置できます',
      'sign.drawFirst': '先に署名を描いてください',
      'sign.dragToPage': '署名をPDFへドラッグ',
      'sign.uploadPdf': 'PDFをアップロードすると配置できます',
      'sign.summaryEmpty': '署名を描いてからページ上へドラッグしてください。',
      'sign.summaryNoPdf': '署名を描いたあと、PDFをアップロードしてください。',
      'sign.summaryReady': '署名をページプレビュー上へドラッグしてください。',
      'sign.summaryPlaced': '{page}ページに署名を配置しました。ドラッグして位置を調整できます。',
      'sign.summaryPlacedCount': '{count}個の署名を配置しました。ドラッグで移動、角をドラッグしてサイズ調整できます。',
      'tool.sign.label': '署名',
      'tool.sign.lede': '署名を描いてPDFページに直接配置します。',
      'tool.sign.meta': 'ブラウザ内で署名を描画<br/>ページプレビューへドラッグ<br/>PDFをラスタライズせずに書き出し',
      'tool.sign.downloadLabel': '署名済みPDFを書き出し',
      'tool.sign.downloadSub': 'PDFに署名を追加',
    },
    es: {
      'sections.sign': 'II. Firmar PDF',
      'preview.titleSign': 'Firmar <em>— arrastra tu firma a la página</em>',
      'progress.exportingSignedPdf': 'Exportando PDF firmado…',
      'errors.noSignature': 'Dibuja una firma y colócala en el PDF antes de exportar.',
      'errors.signaturePageMissing': 'La página firmada no está incluida en esta exportación.',
      'sign.padAria': 'Área para dibujar la firma',
      'sign.clear': 'Borrar',
      'sign.removeSelected': 'Quitar selección',
      'sign.drawSignature': 'dibujar firma',
      'sign.ready': 'lista para colocar',
      'sign.drawFirst': 'Dibuja una firma primero',
      'sign.dragToPage': 'Arrastra la firma al PDF',
      'sign.uploadPdf': 'Sube un PDF para colocarla',
      'sign.summaryEmpty': 'Dibuja una firma y luego arrástrala a la página.',
      'sign.summaryNoPdf': 'Sube un PDF después de dibujar la firma.',
      'sign.summaryReady': 'Arrastra la firma a la vista previa de la página.',
      'sign.summaryPlaced': 'Firma colocada en la página {page}. Arrástrala de nuevo para ajustarla.',
      'sign.summaryPlacedCount': '{count} firmas colocadas. Arrastra para mover; arrastra las esquinas para redimensionar.',
      'tool.sign.label': 'Firmar',
      'tool.sign.lede': 'Dibuja una firma y colócala directamente en una página del PDF.',
      'tool.sign.meta': 'Dibuja tu firma localmente<br/>Arrástrala a la vista previa<br/>Exporta sin rasterizar el PDF',
      'tool.sign.downloadLabel': 'Exportar PDF firmado',
      'tool.sign.downloadSub': 'estampar la firma en el PDF',
    },
    fr: {
      'sections.sign': 'II. Signer le PDF',
      'preview.titleSign': 'Signer <em>— faites glisser votre signature sur la page</em>',
      'progress.exportingSignedPdf': 'Export du PDF signé…',
      'errors.noSignature': 'Dessinez une signature et placez-la sur le PDF avant d’exporter.',
      'errors.signaturePageMissing': 'La page signée n’est pas incluse dans cet export.',
      'sign.padAria': 'Zone de dessin de la signature',
      'sign.clear': 'Effacer',
      'sign.removeSelected': 'Supprimer la sélection',
      'sign.drawSignature': 'dessiner la signature',
      'sign.ready': 'prête à placer',
      'sign.drawFirst': 'Dessinez d’abord une signature',
      'sign.dragToPage': 'Faites glisser la signature sur le PDF',
      'sign.uploadPdf': 'Importez un PDF pour la placer',
      'sign.summaryEmpty': 'Dessinez une signature, puis faites-la glisser sur la page.',
      'sign.summaryNoPdf': 'Importez un PDF après avoir dessiné votre signature.',
      'sign.summaryReady': 'Faites glisser la signature sur l’aperçu de la page.',
      'sign.summaryPlaced': 'Signature placée sur la page {page}. Faites-la glisser à nouveau pour l’ajuster.',
      'sign.summaryPlacedCount': '{count} signatures placées. Faites glisser pour déplacer ; tirez les coins pour redimensionner.',
      'tool.sign.label': 'Signer',
      'tool.sign.lede': 'Dessinez une signature et placez-la directement sur une page du PDF.',
      'tool.sign.meta': 'Dessinez votre signature localement<br/>Faites-la glisser sur l’aperçu<br/>Exportez sans pixelliser le PDF',
      'tool.sign.downloadLabel': 'Exporter le PDF signé',
      'tool.sign.downloadSub': 'apposer la signature sur le PDF',
    },
  };

  Object.entries(SIGN_LOCALES).forEach(([locale, additions]) => {
    Object.assign(LOCALES[locale], additions);
  });

  function concatBytes(...parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    parts.forEach(part => {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function bytesToBinaryString(bytes) {
    let out = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return out;
  }

  function binaryStringToBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  function bytesToHex(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  function hexToBytes(hex) {
    const clean = (hex || '').replace(/\s+/g, '');
    const out = new Uint8Array(Math.ceil(clean.length / 2));
    for (let i = 0; i < out.length; i++) {
      const pair = clean.slice(i * 2, i * 2 + 2).padEnd(2, '0');
      out[i] = parseInt(pair, 16) || 0;
    }
    return out;
  }

  function randomBytes(length) {
    const out = new Uint8Array(length);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(out);
    else throw new Error('Secure browser randomness is required to lock PDFs.');
    return out;
  }

  function passwordBytes(password) {
    return new TextEncoder().encode(String(password || ''));
  }

  function padPdfPassword(password) {
    const raw = passwordBytes(password);
    const out = new Uint8Array(32);
    const copyLength = Math.min(raw.length, 32);
    out.set(raw.subarray(0, copyLength), 0);
    if (copyLength < 32) out.set(PDF_PASSWORD_PADDING.subarray(0, 32 - copyLength), copyLength);
    return out;
  }

  function int32BytesLE(value) {
    const n = value >>> 0;
    return Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  }

  function rc4(key, data) {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 255;
      const t = s[i]; s[i] = s[j]; s[j] = t;
    }
    const out = new Uint8Array(data.length);
    let i = 0;
    j = 0;
    for (let n = 0; n < data.length; n++) {
      i = (i + 1) & 255;
      j = (j + s[i]) & 255;
      const t = s[i]; s[i] = s[j]; s[j] = t;
      out[n] = data[n] ^ s[(s[i] + s[j]) & 255];
    }
    return out;
  }

  function xorKey(key, value) {
    const out = new Uint8Array(key.length);
    for (let i = 0; i < key.length; i++) out[i] = key[i] ^ value;
    return out;
  }

  function leftRotate(value, shift) {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
  }

  function md5(bytes) {
    const inputLength = bytes.length;
    const paddedLength = (((inputLength + 8) >>> 6) + 1) << 6;
    const buffer = new Uint8Array(paddedLength);
    buffer.set(bytes);
    buffer[inputLength] = 0x80;
    const bitLength = inputLength * 8;
    for (let i = 0; i < 8; i++) buffer[paddedLength - 8 + i] = Math.floor(bitLength / (2 ** (8 * i))) & 0xff;

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const shifts = [
      7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
      5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
      4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
      6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const table = new Uint32Array(64);
    for (let i = 0; i < 64; i++) table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;

    for (let offset = 0; offset < paddedLength; offset += 64) {
      const m = new Uint32Array(16);
      for (let i = 0; i < 16; i++) {
        const p = offset + i * 4;
        m[i] = buffer[p] | (buffer[p + 1] << 8) | (buffer[p + 2] << 16) | (buffer[p + 3] << 24);
      }
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }
        const next = d;
        d = c;
        c = b;
        b = (b + leftRotate((a + f + table[i] + m[g]) >>> 0, shifts[i])) >>> 0;
        a = next;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    const out = new Uint8Array(16);
    [a0, b0, c0, d0].forEach((word, index) => {
      const offset = index * 4;
      out[offset] = word & 0xff;
      out[offset + 1] = (word >>> 8) & 0xff;
      out[offset + 2] = (word >>> 16) & 0xff;
      out[offset + 3] = (word >>> 24) & 0xff;
    });
    return out;
  }

  function computeOwnerPasswordValue(ownerPassword, userPassword, keyLength) {
    let digest = md5(padPdfPassword(ownerPassword));
    for (let i = 0; i < 50; i++) digest = md5(digest);
    const key = digest.subarray(0, keyLength);
    let value = padPdfPassword(userPassword);
    for (let i = 0; i < 20; i++) value = rc4(xorKey(key, i), value);
    return value;
  }

  function computeFileEncryptionKey(userPassword, ownerValue, permissions, fileId, keyLength) {
    let digest = md5(concatBytes(
      padPdfPassword(userPassword),
      ownerValue,
      int32BytesLE(permissions),
      fileId,
    ));
    for (let i = 0; i < 50; i++) digest = md5(digest.subarray(0, keyLength));
    return digest.subarray(0, keyLength);
  }

  function computeUserPasswordValue(fileKey, fileId) {
    let value = md5(concatBytes(PDF_PASSWORD_PADDING, fileId));
    for (let i = 0; i < 20; i++) value = rc4(xorKey(fileKey, i), value);
    return concatBytes(value, randomBytes(16));
  }

  function objectEncryptionKey(fileKey, objectNumber, generationNumber) {
    const suffix = Uint8Array.from([
      objectNumber & 0xff,
      (objectNumber >>> 8) & 0xff,
      (objectNumber >>> 16) & 0xff,
      generationNumber & 0xff,
      (generationNumber >>> 8) & 0xff,
    ]);
    return md5(concatBytes(fileKey, suffix)).subarray(0, Math.min(fileKey.length + 5, 16));
  }

  function decodePdfLiteralString(content) {
    const out = [];
    for (let i = 0; i < content.length; i++) {
      let code = content.charCodeAt(i) & 0xff;
      if (code !== 0x5c) {
        out.push(code);
        continue;
      }
      i += 1;
      if (i >= content.length) break;
      const next = content.charAt(i);
      const nextCode = content.charCodeAt(i) & 0xff;
      if (next === 'n') out.push(0x0a);
      else if (next === 'r') out.push(0x0d);
      else if (next === 't') out.push(0x09);
      else if (next === 'b') out.push(0x08);
      else if (next === 'f') out.push(0x0c);
      else if (next === '(' || next === ')' || next === '\\') out.push(nextCode);
      else if (next === '\r' || next === '\n') {
        if (next === '\r' && content.charAt(i + 1) === '\n') i += 1;
      } else if (/[0-7]/.test(next)) {
        let octal = next;
        for (let j = 0; j < 2 && /[0-7]/.test(content.charAt(i + 1)); j++) {
          i += 1;
          octal += content.charAt(i);
        }
        out.push(parseInt(octal, 8) & 0xff);
      } else {
        out.push(nextCode);
      }
    }
    return Uint8Array.from(out);
  }

  function parsePdfLiteralString(source, start) {
    let depth = 1;
    let escaped = false;
    for (let i = start + 1; i < source.length; i++) {
      const ch = source.charAt(i);
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          return {
            end: i + 1,
            bytes: decodePdfLiteralString(source.slice(start + 1, i)),
          };
        }
      }
    }
    return null;
  }

  function encryptPdfStrings(source, key) {
    let out = '';
    for (let i = 0; i < source.length;) {
      const ch = source.charAt(i);
      if (ch === '%') {
        const end = source.slice(i).search(/[\r\n]/);
        if (end === -1) {
          out += source.slice(i);
          break;
        }
        out += source.slice(i, i + end);
        i += end;
        continue;
      }
      if (ch === '(') {
        const parsed = parsePdfLiteralString(source, i);
        if (!parsed) {
          out += ch;
          i += 1;
          continue;
        }
        out += '<' + bytesToHex(rc4(key, parsed.bytes)) + '>';
        i = parsed.end;
        continue;
      }
      if (ch === '<' && source.charAt(i + 1) !== '<') {
        const end = source.indexOf('>', i + 1);
        const value = end === -1 ? '' : source.slice(i + 1, end);
        if (end !== -1 && /^[\da-fA-F\s]*$/.test(value)) {
          out += '<' + bytesToHex(rc4(key, hexToBytes(value))) + '>';
          i = end + 1;
          continue;
        }
      }
      out += ch;
      i += 1;
    }
    return out;
  }

  function encryptPdfObjectBody(body, key) {
    const streamMatch = /\bstream(\r\n|\n|\r)/.exec(body);
    if (!streamMatch) return encryptPdfStrings(body, key);
    const markerStart = streamMatch.index;
    const markerEnd = markerStart + streamMatch[0].length;
    const prefix = body.slice(0, markerStart);
    const lengthMatch = /\/Length\s+(\d+)/.exec(prefix);
    if (!lengthMatch) throw new Error('Cannot lock this PDF because a stream has an indirect length.');
    const streamLength = Number(lengthMatch[1]);
    const streamEnd = markerEnd + streamLength;
    const streamBytes = binaryStringToBytes(body.slice(markerEnd, streamEnd));
    return encryptPdfStrings(prefix, key) +
      body.slice(markerStart, markerEnd) +
      bytesToBinaryString(rc4(key, streamBytes)) +
      body.slice(streamEnd);
  }

  function readBalancedPdfDictionary(source, start) {
    if (source.slice(start, start + 2) !== '<<') return null;
    let depth = 0;
    for (let i = start; i < source.length - 1; i++) {
      const pair = source.slice(i, i + 2);
      if (pair === '<<') {
        depth += 1;
        i += 1;
      } else if (pair === '>>') {
        depth -= 1;
        i += 1;
        if (depth === 0) return { value: source.slice(start, i + 1), end: i + 1 };
      }
    }
    return null;
  }

  function parseTrailerDictionary(pdfText) {
    const trailerIndex = pdfText.lastIndexOf('trailer');
    if (trailerIndex === -1) throw new Error('Cannot lock this PDF because its trailer was not found.');
    const dictStart = pdfText.indexOf('<<', trailerIndex);
    const parsed = readBalancedPdfDictionary(pdfText, dictStart);
    if (!parsed) throw new Error('Cannot lock this PDF because its trailer is invalid.');
    return parsed.value;
  }

  function parsePdfObjectEntries(pdfText) {
    const startxrefIndex = pdfText.lastIndexOf('startxref');
    if (startxrefIndex === -1) throw new Error('Cannot lock this PDF because its cross-reference table was not found.');
    const startxrefMatch = /startxref\s+(\d+)/.exec(pdfText.slice(startxrefIndex));
    if (!startxrefMatch) throw new Error('Cannot lock this PDF because its cross-reference table was invalid.');
    const xrefOffset = Number(startxrefMatch[1]);
    if (pdfText.slice(xrefOffset, xrefOffset + 4) !== 'xref') {
      throw new Error('Cannot lock this PDF because it uses a compressed cross-reference stream.');
    }
    const trailerIndex = pdfText.indexOf('trailer', xrefOffset);
    const xrefBody = pdfText.slice(xrefOffset + 4, trailerIndex);
    const lines = xrefBody.split(/\r?\n/);
    const refs = [];
    for (let i = 0; i < lines.length; i++) {
      const header = /^\s*(\d+)\s+(\d+)\s*$/.exec(lines[i]);
      if (!header) continue;
      const first = Number(header[1]);
      const count = Number(header[2]);
      for (let j = 0; j < count && i + 1 + j < lines.length; j++) {
        const entry = /^(\d{10})\s+(\d{5})\s+([nf])/.exec(lines[i + 1 + j]);
        if (entry && entry[3] === 'n') {
          refs.push({
            number: first + j,
            generation: Number(entry[2]),
            offset: Number(entry[1]),
          });
        }
      }
      i += count;
    }
    refs.sort((a, b) => a.offset - b.offset);
    return refs.map((ref, index) => {
      const nextOffset = refs[index + 1]?.offset ?? pdfText.length;
      const slice = pdfText.slice(ref.offset, nextOffset);
      const header = new RegExp('^\\s*' + ref.number + '\\s+' + ref.generation + '\\s+obj\\s*').exec(slice);
      const endIndex = slice.lastIndexOf('endobj');
      if (!header || endIndex === -1) throw new Error('Cannot lock this PDF because object ' + ref.number + ' is invalid.');
      return {
        number: ref.number,
        generation: ref.generation,
        body: slice.slice(header[0].length, endIndex).replace(/^\r?\n/, '').replace(/\s*$/, ''),
      };
    });
  }

  function extractTrailerRef(trailer, name) {
    const match = new RegExp('/' + name + '\\s+(\\d+\\s+\\d+\\s+R)').exec(trailer);
    return match ? match[1] : '';
  }

  function extractTrailerId(trailer) {
    const match = /\/ID\s*\[\s*<([\da-fA-F\s]+)>\s*<([\da-fA-F\s]+)>/.exec(trailer);
    return match ? hexToBytes(match[1]).subarray(0, 16) : randomBytes(16);
  }

  function encryptionDictionary(objectNumber, ownerValue, userValue, permissions) {
    return objectNumber + ' 0 obj\n' +
      '<< /Filter /Standard /V 2 /R 3 /Length 128 ' +
      '/O <' + bytesToHex(ownerValue) + '> ' +
      '/U <' + bytesToHex(userValue) + '> ' +
      '/P ' + permissions + ' >>\n' +
      'endobj\n';
  }

  function encryptPdfBytesNoRaster(bytes, userPassword, ownerPassword) {
    const pdfText = bytesToBinaryString(bytes);
    const objects = parsePdfObjectEntries(pdfText);
    const trailer = parseTrailerDictionary(pdfText);
    const rootRef = extractTrailerRef(trailer, 'Root');
    if (!rootRef) throw new Error('Cannot lock this PDF because its document catalog was not found.');
    const infoRef = extractTrailerRef(trailer, 'Info');
    const fileId = extractTrailerId(trailer);
    const keyLength = 16;
    const permissions = -4;
    const ownerValue = computeOwnerPasswordValue(ownerPassword, userPassword, keyLength);
    const fileKey = computeFileEncryptionKey(userPassword, ownerValue, permissions, fileId, keyLength);
    const userValue = computeUserPasswordValue(fileKey, fileId);
    const maxObjectNumber = objects.reduce((max, object) => Math.max(max, object.number), 0);
    const encryptObjectNumber = maxObjectNumber + 1;

    let output = '%PDF-1.7\n%\x81\x81\x81\x81\n';
    const offsets = new Map();
    objects.forEach(object => {
      offsets.set(object.number, output.length);
      const key = objectEncryptionKey(fileKey, object.number, object.generation);
      output += object.number + ' ' + object.generation + ' obj\n' +
        encryptPdfObjectBody(object.body, key) + '\nendobj\n';
    });
    offsets.set(encryptObjectNumber, output.length);
    output += encryptionDictionary(encryptObjectNumber, ownerValue, userValue, permissions);

    const xrefOffset = output.length;
    const size = encryptObjectNumber + 1;
    output += 'xref\n0 ' + size + '\n';
    for (let i = 0; i < size; i++) {
      if (i === 0) output += '0000000000 65535 f \n';
      else if (offsets.has(i)) output += String(offsets.get(i)).padStart(10, '0') + ' 00000 n \n';
      else output += '0000000000 65535 f \n';
    }
    output += 'trailer\n<< /Size ' + size +
      ' /Root ' + rootRef +
      (infoRef ? ' /Info ' + infoRef : '') +
      ' /Encrypt ' + encryptObjectNumber + ' 0 R' +
      ' /ID [<' + bytesToHex(fileId) + '><' + bytesToHex(fileId) + '>]' +
      ' >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';
    return binaryStringToBytes(output);
  }

  async function applyAdvancedExportProcessors(artifact, context) {
    let current = artifact;
    const processors = buildAdvancedExportProcessors(context, current);
    for (const processor of processors) {
      setLoader(true, processor.label, processor.progress);
      current = await processor.apply(current, context);
    }
    return current;
  }

  async function runExportPipeline(context, producer) {
    const produced = await producer(context);
    const processed = await applyAdvancedExportProcessors(produced, context);
    downloadPdfArtifact(processed);
    return processed;
  }

  function activePageCount() {
    return state.pageOrder.length;
  }

  function currentPageProgress(index, count) {
    return count ? ((index + 1) / count) * 100 : 0;
  }

  function padPage(n) {
    return n ? String(n).padStart(2, '0') : '—';
  }

  function currentSourceIndex() {
    return state.pageOrder[state.curPage - 1];
  }

  function advancedPageRangeEnabled() {
    return advancedRangeToggle.checked;
  }

  function advancedPageRangeValue() {
    return advancedPageRangeEnabled() ? advancedRangeInput.value.trim() : '';
  }

  function parsePageRangeSpec(value, count) {
    const spec = String(value || '').trim();
    if (!spec) return { ok: false, error: t('errors.rangeRequired') };
    const pages = [];
    const seen = new Set();
    const parts = spec.split(',');
    for (const rawPart of parts) {
      const part = rawPart.trim();
      if (!part) continue;
      const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
      if (!match) return { ok: false, error: t('errors.rangeFormat') };
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : start;
      if (start < 1 || end < 1 || start > count || end > count) {
        return { ok: false, error: t('errors.rangeBounds', { count }) };
      }
      if (end < start) return { ok: false, error: t('errors.rangeOrder') };
      for (let page = start; page <= end; page++) {
        if (seen.has(page)) continue;
        seen.add(page);
        pages.push(page);
      }
    }
    if (!pages.length) return { ok: false, error: t('errors.rangeEmpty') };
    return { ok: true, pages };
  }

  function selectedRangePages() {
    const parsed = parsePageRangeSpec(advancedPageRangeValue(), activePageCount());
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.pages;
  }

  function rangeFileSuffix(value) {
    const clean = String(value || '')
      .replace(/\s+/g, '')
      .replace(/,/g, '_')
      .replace(/[^\d_-]+/g, '')
      .slice(0, 48);
    return clean || 'range';
  }

  function selectedExportPageOrder() {
    if (advancedPageRangeEnabled()) {
      return selectedRangePages().map(page => state.pageOrder[page - 1]).filter(sourceIndex => sourceIndex != null);
    }
    if (!advancedCurrentOnly.checked) return state.pageOrder.slice();
    const sourceIndex = currentSourceIndex();
    return sourceIndex == null ? [] : [sourceIndex];
  }

  function exportBaseNameForTool(toolId) {
    let base = outputBaseName() + TOOLS[toolId].suffix;
    if (advancedPageRangeEnabled()) {
      base += '_pages_' + rangeFileSuffix(advancedPageRangeValue());
    } else if (advancedCurrentOnly.checked && activePageCount() > 1) {
      base += '_page_' + padPage(state.curPage);
    }
    return base;
  }

  function canPasswordProtectExport(toolId = activeTool) {
    return toolId !== 'preview' && toolId !== 'merge';
  }

  function advancedPasswordValue() {
    return advancedPasswordToggle.checked ? advancedPasswordInput.value.trim() : '';
  }

  function jsPdfExportOptions(options, context) {
    const password = context?.advanced?.password || '';
    if (!password || !canPasswordProtectExport(context?.toolId || activeTool)) return options;
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
    const rangeAvailable = applies && hasPages;
    advancedCurrentOnly.disabled = !applies || !hasPages || advancedRangeToggle.checked;
    advancedRangeToggle.disabled = !rangeAvailable || advancedCurrentOnly.checked;
    advancedRangeRow.classList.toggle('is-disabled', !rangeAvailable || advancedCurrentOnly.checked);
    advancedRangeInput.disabled = !rangeAvailable || !advancedRangeToggle.checked;
    advancedPasswordToggle.disabled = !passwordAvailable;
    advancedPasswordRow.classList.toggle('is-disabled', !passwordAvailable);
    advancedPasswordInput.disabled = !passwordAvailable || !advancedPasswordToggle.checked;
    if (!rangeAvailable) advancedRangeToggle.checked = false;
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
    const pixelCount = (pd?.w || 0) * (pd?.h || 0);
    return !!(pd
      && pd.lum
      && pd.histo
      && pd.renderKey === renderKey
      && pixelCount > 0
      && pd.lum.length === pixelCount
      && pd.histo.length === 256);
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
    fineQualityLabel.textContent = ultra ? t('edit.qualityUltra') : t('edit.qualityHigh');
  }

  function syncCompressControls() {
    const preset = COMPRESSION_PRESETS[state.compressMode] || COMPRESSION_PRESETS.original;
    setTogglePressed(compressOriginal, state.compressMode === 'original');
    setTogglePressed(compressBalanced, state.compressMode === 'balanced');
    setTogglePressed(compressSmall, state.compressMode === 'small');
    const modeKey = state.compressMode === 'balanced' ? 'Balanced' : state.compressMode === 'small' ? 'Small' : 'Original';
    compressHint.textContent = t('compress.hint' + modeKey);
    compressSummary.textContent = t('compress.summary' + modeKey);
  }

  function setCompressMode(mode) {
    if (!COMPRESSION_PRESETS[mode] || state.compressMode === mode) return;
    state.compressMode = mode;
    syncCompressControls();
    if (state.pdfDoc && activeTool === 'compress') requestPreviewRender(false);
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
    return start + 1 === end
      ? t('split.pagesOne', { start: start + 1 })
      : t('split.pagesMany', { start: start + 1, end });
  }

  function updateSplitPanel() {
    const parts = splitParts();
    const splitActive = parts.length > 0;
    splitPanel.hidden = !splitActive;
    clearSplitBtn.disabled = !splitActive;
    splitPartsList.innerHTML = '';
    if (!splitActive) {
      splitSummary.textContent = t('split.useButton');
      return;
    }
    splitSummary.textContent = t('split.summary', {
      parts: parts.length,
      points: state.splitPoints.length,
      pointWord: t(state.splitPoints.length === 1 ? 'split.pointOne' : 'split.pointMany'),
    });
    parts.forEach(part => {
      const row = document.createElement('div');
      row.className = 'split-part-row';

      const top = document.createElement('div');
      top.className = 'split-part-top';
      const label = document.createElement('div');
      label.className = 'split-part-label';
      label.textContent = t('split.part', { num: part.index + 1 });
      const pages = document.createElement('div');
      pages.className = 'split-part-pages';
      pages.textContent = pageRangeText(part.start, part.end);
      top.appendChild(label);
      top.appendChild(pages);

      const input = document.createElement('input');
      input.className = 'split-name-input';
      input.type = 'text';
      input.value = part.name;
      input.setAttribute('aria-label', t('split.nameAria', { num: part.index + 1 }));
      input.addEventListener('input', () => {
        state.splitNames[part.index] = input.value;
      });

      const button = document.createElement('button');
      button.className = 'btn-secondary split-export-btn';
      button.type = 'button';
      button.textContent = t('split.exportPart', { num: part.index + 1 });
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
        : activeTool === 'sign'
          ? !signatureCanExport()
          : !state.pdfDoc || count === 0;
    resetPagesBtn.disabled = !state.pdfDoc || !isOrderChanged();
    organizeHint.textContent = state.pdfDoc
      ? (state.splitPoints.length
        ? t('organize.splits', { count: state.splitPoints.length })
        : t('organize.pages', { count }))
      : t('hint.ready');
    organizeSummary.textContent = state.pdfDoc
      ? (state.splitPoints.length
        ? t('organize.summarySplit', { parts: state.splitPoints.length + 1 })
        : t('organize.summaryPages', { count, total: state.numPages }))
      : t('organize.summaryEmpty');
    updateSplitPanel();
    proofMeta.textContent = state.pdfDoc
      ? (count ? t('proof.outputPages', { count }) : t('proof.noPages'))
      : t('proof.awaiting');
    syncAdvancedOptions();
    syncSignatureControls();
    updateSignatureOverlay();
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
    if (v < 64) return t('hint.low');
    if (v < 110) return t('hint.darkRange');
    if (v < 145) return t('hint.midRange');
    if (v < 200) return t('hint.lightRange');
    return t('hint.high');
  }

  function contrastHintText(v) {
    if (v < 80) return t('hint.low');
    if (v < 95) return t('hint.soft');
    if (v <= 115) return t('hint.normal');
    if (v <= 150) return t('hint.high');
    return t('hint.maximum');
  }

  function greyHintText() {
    if (state.sepia) return t('hint.sepia');
    if (state.greyInvert) return t('hint.inverted');
    if (state.brightness > 40) return t('hint.bright');
    if (state.brightness < -40) return t('hint.dark');
    if (state.contrast > 140) return t('hint.highContrast');
    return t('hint.neutral');
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
      fileNameEl.title = t('file.renameTitle');
      updateSourceDropMode();
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

  function clearCurrentPdf() {
    clearError();
    if (state.pdfDoc?.destroy) {
      try { state.pdfDoc.destroy(); } catch {}
    }
    state.mergeFiles = state.mergeFiles.filter(file => !isCurrentPdfMergeFile(file));
    resetRenderCaches();
    state.pdfDoc = null;
    state.numPages = 0;
    state.curPage = 1;
    state.pages = [];
    state.pageOrder = [];
    state.splitPoints = [];
    state.splitNames = [];
    state.pageEdits = [];
    state.fileName = '';
    state.fileSize = 0;
    state.pdfBytes = null;
    signatureState.stamps = [];
    signatureState.selectedId = null;
    signatureState.drag = null;
    signatureState.nextId = 1;
    state.largePdfSafeMode = false;
    state.fullPageCacheOrder = [];
    previewCanvas.width = 0;
    previewCanvas.height = 0;
    pageEditorCanvas.width = 0;
    pageEditorCanvas.height = 0;
    canvasWrap.style.display = 'none';
    pageEditorCanvasWrap.style.display = 'none';
    fileNameEl.textContent = '—';
    fileNameEl.title = '';
    fileNameEl.removeAttribute('tabindex');
    fileSizeEl.textContent = '—';
    fileStatusEl.textContent = t('status.ready');
    fileCard.classList.remove('on');
    downloadBtn.disabled = activeTool !== 'merge';
    zoomLevel = 1;
    updateSourceDropMode();
    updateMergeState();
    syncSignatureControls();
    updateSignatureOverlay();
    updatePageState();
    syncPreviewStageHeight();
    applyZoom({ preserveCenter: false });
  }

  fileRemoveBtn.addEventListener('click', clearCurrentPdf);

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
      up.innerHTML = '<span class="merge-file-action-glyph merge-file-action-arrow" aria-hidden="true">↑</span>';
      up.disabled = index === 0;
      up.setAttribute('aria-label', t('merge.moveUp', { name: file.name }));
      up.addEventListener('click', () => moveMergeFile(index, -1));
      const down = document.createElement('button');
      down.type = 'button';
      down.innerHTML = '<span class="merge-file-action-glyph merge-file-action-arrow" aria-hidden="true">↓</span>';
      down.disabled = index === state.mergeFiles.length - 1;
      down.setAttribute('aria-label', t('merge.moveDown', { name: file.name }));
      down.addEventListener('click', () => moveMergeFile(index, 1));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.innerHTML = '<span class="merge-file-action-glyph" aria-hidden="true">×</span>';
      remove.setAttribute('aria-label', t('merge.remove', { name: file.name }));
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
    mergeHint.textContent = count ? count + ' PDFs' : t('hint.ready');
    mergeSummary.textContent = count
      ? t('merge.summaryActive', {
        count,
        pdfWord: t(count === 1 ? 'merge.pdfOne' : 'merge.pdfMany'),
        size: fmtBytes(totalSize),
      })
      : t('merge.summaryEmpty');
    mergeClearBtn.disabled = count === 0;
    mergeRunBtn.disabled = count === 0;
    if (activeTool === 'merge') downloadBtn.disabled = count === 0;
    renderMergeList();
  }

  function currentPdfAsMergeFile() {
    if (!state.pdfBytes || !state.fileName) return null;
    const name = normalizePdfName(state.fileName);
    const bytes = state.pdfBytes.slice(0);
    const size = state.fileSize || bytes.byteLength || bytes.length || 0;
    return {
      name,
      size,
      type: 'application/pdf',
      currentPdfSource: state.pdfBytes,
      arrayBuffer: async () => bytes.slice(0),
    };
  }

  function isCurrentPdfMergeFile(file) {
    return file?.currentPdfSource === state.pdfBytes ||
      (state.fileName && normalizePdfName(file.name) === normalizePdfName(state.fileName) && file.size === state.fileSize);
  }

  function seedCurrentPdfInMergeList() {
    const currentFile = currentPdfAsMergeFile();
    if (!currentFile) return;
    state.mergeFiles = state.mergeFiles.filter(file => !isCurrentPdfMergeFile(file));
    state.mergeFiles.unshift(currentFile);
  }

  function addMergeFiles(fileList) {
    clearError();
    const files = Array.from(fileList).filter(file =>
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) {
      showError(t('errors.chooseMerge'));
      return;
    }
    seedCurrentPdfInMergeList();
    state.mergeFiles.push(...files.filter(file => !isCurrentPdfMergeFile(file)));
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
    if (!state.mergeFiles.length) {
      showError(t('errors.chooseMerge'));
      return;
    }
    mergeRunBtn.disabled = true;
    setLoader(true, t('progress.mergingPdfs'), 0);
    try {
      const pdfLib = await ensurePdfLib();
      const out = await pdfLib.PDFDocument.create();
      let totalPages = 0;
      for (let i = 0; i < state.mergeFiles.length; i++) {
        const file = state.mergeFiles[i];
        setLoader(true, t('progress.mergingFile', { name: file.name }), (i / state.mergeFiles.length) * 70);
        const src = await pdfLib.PDFDocument.load(await file.arrayBuffer());
        const pageIndices = src.getPageIndices();
        const pages = await out.copyPages(src, pageIndices);
        pages.forEach(page => out.addPage(page));
        totalPages += pageIndices.length;
      }
      const bytes = await out.save();
      const mergedName = cleanDownloadBase(state.mergeFiles[0].name, 'merged') +
        (state.mergeFiles.length > 1 ? '_merged.pdf' : '_copy.pdf');
      const mergedBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await loadPdfBytes(mergedBuffer, mergedName, bytes.byteLength, t('progress.renderingMergedPdf'));
      state.mergeFiles = [];
      updateMergeState();
      switchTool('organize');
      setLoader(false);
      proofMeta.textContent = t('proof.mergedPages', { count: totalPages });
    } catch (err) {
      console.error(err);
      showError(t('errors.mergeFailed', { error: err.message || err }));
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

  async function loadPdfBytes(buf, fileName, fileSize, loadingLabel = t('progress.loadingPdf')) {
    resetRenderCaches();
    signatureState.stamps = [];
    signatureState.selectedId = null;
    signatureState.drag = null;
    signatureState.nextId = 1;
    state.fileName = normalizePdfName(fileName);
    state.fileSize = fileSize;
    fileNameEl.textContent = state.fileName;
    fileNameEl.title = t('file.renameTitle');
    fileNameEl.tabIndex = 0;
    fileSizeEl.textContent = fmtBytes(fileSize);
    fileStatusEl.textContent = t('status.loading');
    fileCard.classList.add('on');
    state.pdfBytes = buf.slice(0);
    updateSourceDropMode();
    setLoader(true, loadingLabel, 0);
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
    const lazyOpen = state.largePdfSafeMode || activeTool === 'preview' || activeTool === 'organize' || activeTool === 'edit' || activeTool === 'sign' || activeTool === 'compress';
    if (lazyOpen) {
      setLoader(true, state.largePdfSafeMode ? t('progress.openingLargePdf') : t('progress.openingPdf'), 45);
      await ensurePageMeta(0);
      if (activeTool === 'edit') await ensureRasterPreviewData(0);
    } else {
      for (let i = 1; i <= pdf.numPages; i++) {
        setLoader(true, t('progress.renderingPage', { page: i, count: pdf.numPages }), ((i - 1) / pdf.numPages) * 100);
        await renderPageToLuminance(i);
      }
    }
    fileStatusEl.textContent = state.largePdfSafeMode ? t('status.readySafe') : t('status.ready');
    downloadBtn.disabled = false;
    zoomLevel = 1;
    zoomInBtn.disabled = false;
    zoomOutBtn.disabled = false;
    updatePageState();
    updateSourceDropMode();
    syncPreviewStageHeight();
    drawPreview();
    drawHistogram();
    setLoader(false);
  }

  async function handleFile(file) {
    clearError();
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showError(t('errors.notPdf')); return;
    }
    try {
      await loadPdfBytes(await file.arrayBuffer(), file.name, file.size);
    } catch (err) {
      console.error(err);
      showError(t('errors.readPdfFailed', { error: err.message || err }));
      fileStatusEl.textContent = t('status.error');
      setLoader(false);
    }
  }

  // ── Page luminance cache ──
  function getRenderScale(baseVp) {
    if (state.resolution === '900') return 900 / 72;
    if (state.resolution === '600') return 600 / 72;
    if (state.resolution === '300') return 300 / 72;
    return Math.min(2.5, 1800 / Math.max(baseVp.width, baseVp.height));
  }

  function getPreviewRenderScale(baseVp) {
    return Math.min(2.5, 2200 / Math.max(baseVp.width, baseVp.height));
  }

  function isOriginalPreviewTool(id = activeTool) {
    return id === 'preview' || id === 'merge' || id === 'compress' || id === 'sign';
  }

  function getOriginalPreviewScale(baseVp, targetCssWidth) {
    const basePixels = Math.max(1, baseVp.width * baseVp.height);
    const fitScale = Math.max(0.1, (targetCssWidth || baseVp.width) * Math.max(1, devicePixelRatio || 1) / baseVp.width);
    const memoryScale = Math.sqrt(ORIGINAL_PREVIEW_MAX_PIXELS / basePixels);
    return Math.max(getPreviewRenderScale(baseVp), Math.min(fitScale, memoryScale));
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
      baseW: baseVp.width,
      baseH: baseVp.height,
      previewQualityScale: existing?.previewQualityScale || 0,
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
      if (el.dataset.editThumbSource != null && isPageEdited(getPageEdit(sourceIndex))) return;
      if (el.tagName === 'IMG') el.src = thumbUrl;
      else el.style.backgroundImage = 'url("' + thumbUrl + '")';
      el.textContent = '';
      el.setAttribute('aria-label', 'Page thumbnail ' + (sourceIndex + 1));
    });
  }

  function applyEditedThumbnailToElements(sourceIndex, thumbUrl) {
    document.querySelectorAll('[data-edit-thumb-source="' + sourceIndex + '"]').forEach(el => {
      if (el.tagName === 'IMG') el.src = thumbUrl;
      else el.style.backgroundImage = 'url("' + thumbUrl + '")';
      el.textContent = '';
      el.setAttribute('aria-label', 'Edited page thumbnail ' + (sourceIndex + 1));
    });
  }

  let editThumbnailTimer = null;
  let editThumbnailToken = 0;
  function requestEditedThumbnailRender(sourceIndex = currentSourceIndex(), delay = 500) {
    if (sourceIndex == null) return;
    if (editThumbnailTimer) clearTimeout(editThumbnailTimer);
    editThumbnailTimer = setTimeout(async () => {
      editThumbnailTimer = null;
      const token = ++editThumbnailToken;
      if (!state.pdfDoc) return;
      const edit = clonePageEdit(getPageEdit(sourceIndex));
      try {
        const thumbUrl = isPageEdited(edit)
          ? await renderEditedThumbnail(sourceIndex, edit)
          : await ensureThumbnail(sourceIndex, 'high');
        if (token === editThumbnailToken && thumbUrl) applyEditedThumbnailToElements(sourceIndex, thumbUrl);
      } catch (err) {
        console.warn('Edited thumbnail render failed', err);
      }
    }, delay);
  }

  function resetSignaturePadCanvas() {
    if (!signaturePad) return;
    signaturePad.width = 900;
    signaturePad.height = 300;
    const ctx = signaturePad.getContext('2d');
    ctx.clearRect(0, 0, signaturePad.width, signaturePad.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#0c0a08';
  }

  function signaturePadPoint(e) {
    const rect = signaturePad.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * signaturePad.width,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * signaturePad.height,
    };
  }

  function trimmedSignatureFromPad() {
    if (!signaturePad) return null;
    const ctx = signaturePad.getContext('2d');
    const width = signaturePad.width;
    const height = signaturePad.height;
    const img = ctx.getImageData(0, 0, width, height);
    const data = img.data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] <= 8) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (maxX < minX || maxY < minY) return null;
    const pad = 18;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    const trimW = Math.max(1, maxX - minX + 1);
    const trimH = Math.max(1, maxY - minY + 1);
    const out = document.createElement('canvas');
    out.width = trimW;
    out.height = trimH;
    out.getContext('2d').drawImage(signaturePad, minX, minY, trimW, trimH, 0, 0, trimW, trimH);
    return {
      dataUrl: out.toDataURL('image/png'),
      ratio: trimW / Math.max(1, trimH),
    };
  }

  function updateSignatureFromPad() {
    const trimmed = trimmedSignatureFromPad();
    if (!trimmed) {
      clearSignature();
      return;
    }
    signatureState.hasInk = true;
    signatureState.dataUrl = trimmed.dataUrl;
    signatureState.ratio = trimmed.ratio;
    syncSignatureControls();
    updateSignatureOverlay();
  }

  function clearSignature() {
    resetSignaturePadCanvas();
    signatureState.hasInk = false;
    signatureState.dataUrl = '';
    syncSignatureControls();
    updateSignatureOverlay();
    updatePageState();
  }

  function activeSignatureStamps(pageOrder = state.pageOrder) {
    const includedPages = new Set(pageOrder);
    return signatureState.stamps.filter(stamp => includedPages.has(stamp.pageIndex));
  }

  function currentPageSignatureStamps() {
    const sourceIndex = currentSourceIndex();
    return signatureState.stamps.filter(stamp => stamp.pageIndex === sourceIndex);
  }

  function getSignatureStamp(id) {
    return signatureState.stamps.find(stamp => stamp.id === id) || null;
  }

  function signatureCanExport(pageOrder = state.pageOrder) {
    return !!state.pdfDoc && activeSignatureStamps(pageOrder).length > 0;
  }

  function syncSignatureControls() {
    if (!signaturePad) return;
    const hasPdf = !!state.pdfDoc;
    const hasInk = !!signatureState.dataUrl;
    const placedCount = activeSignatureStamps().length;
    const selected = !!getSignatureStamp(signatureState.selectedId);
    signHint.textContent = hasInk ? t('sign.ready') : t('sign.drawSignature');
    signatureClearBtn.disabled = !hasInk;
    signatureRemoveBtn.disabled = !selected;
    signatureDragSource.classList.toggle('is-empty', !hasInk);
    if (signatureDragPreview) {
      signatureDragPreview.hidden = !hasInk;
      signatureDragPreview.src = hasInk ? signatureState.dataUrl : '';
    }
    signatureDragLabel.textContent = !hasInk
      ? t('sign.drawFirst')
      : hasPdf
        ? t('sign.dragToPage')
        : t('sign.uploadPdf');
    signatureDragLabel.hidden = hasInk;
    signatureDragSource.setAttribute('aria-label', hasInk ? t('sign.dragToPage') : t('sign.drawFirst'));
    if (!hasInk && !placedCount) signSummary.textContent = t('sign.summaryEmpty');
    else if (!hasPdf) signSummary.textContent = t('sign.summaryNoPdf');
    else if (!placedCount) signSummary.textContent = t('sign.summaryReady');
    else signSummary.textContent = t('sign.summaryPlacedCount', { count: placedCount });
  }

  function defaultSignaturePlacement(rect, dataUrl = signatureState.dataUrl, ratio = signatureState.ratio) {
    const wPct = Math.max(18, Math.min(38, (190 / Math.max(1, rect.width)) * 100));
    const hPct = (rect.width * wPct / 100 / Math.max(0.1, ratio)) / Math.max(1, rect.height) * 100;
    return {
      id: signatureState.nextId++,
      pageIndex: currentSourceIndex(),
      dataUrl,
      ratio,
      xPct: 50 - wPct / 2,
      yPct: 50 - hPct / 2,
      wPct,
      hPct,
    };
  }

  function clampSignatureStamp(stamp) {
    stamp.wPct = Math.max(5, Math.min(100, stamp.wPct));
    stamp.hPct = Math.max(2, Math.min(100, stamp.hPct));
    stamp.xPct = Math.max(0, Math.min(100 - stamp.wPct, stamp.xPct));
    stamp.yPct = Math.max(0, Math.min(100 - stamp.hPct, stamp.yPct));
    return stamp;
  }

  function setSignatureStampFromPoint(clientX, clientY, drag) {
    const rect = previewCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    let stamp = getSignatureStamp(drag.id);
    if (!stamp && drag.mode === 'new') {
      stamp = defaultSignaturePlacement(rect, drag.dataUrl, drag.ratio);
      signatureState.stamps.push(stamp);
      drag.id = stamp.id;
      signatureState.selectedId = stamp.id;
    }
    if (!stamp) return false;
    const wPx = rect.width * stamp.wPct / 100;
    const hPx = rect.height * stamp.hPct / 100;
    stamp.pageIndex = currentSourceIndex();
    stamp.xPct = ((clientX - rect.left - wPx * drag.offsetX) / rect.width) * 100;
    stamp.yPct = ((clientY - rect.top - hPx * drag.offsetY) / rect.height) * 100;
    clampSignatureStamp(stamp);
    syncSignatureControls();
    updateSignatureOverlay();
    downloadBtn.disabled = !signatureCanExport();
    return true;
  }

  function resizeSignatureStampFromPointer(e, drag) {
    const stamp = getSignatureStamp(drag.id);
    const rect = drag.pageRect || previewCanvas.getBoundingClientRect();
    if (!stamp || !drag.startStamp || !rect.width || !rect.height) return false;
    const start = drag.startStamp;
    const ratio = Math.max(0.1, start.ratio || stamp.ratio || signatureState.ratio);
    const left = rect.width * start.xPct / 100;
    const top = rect.height * start.yPct / 100;
    const width = rect.width * start.wPct / 100;
    const height = rect.height * start.hPct / 100;
    const right = left + width;
    const bottom = top + height;
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const handle = drag.handle || 'se';
    const widthFromX = handle.includes('w') ? right - localX : localX - left;
    const widthFromY = (handle.includes('n') ? bottom - localY : localY - top) * ratio;
    const minW = Math.min(rect.width, Math.max(36, rect.width * 0.05));
    const maxByX = handle.includes('w') ? right : rect.width - left;
    const maxByY = (handle.includes('n') ? bottom : rect.height - top) * ratio;
    const maxW = Math.max(8, Math.min(maxByX, maxByY));
    const nextW = Math.max(8, Math.min(maxW, Math.max(minW, widthFromX, widthFromY)));
    const nextH = nextW / ratio;
    const nextLeft = handle.includes('w') ? right - nextW : left;
    const nextTop = handle.includes('n') ? bottom - nextH : top;
    stamp.xPct = (nextLeft / rect.width) * 100;
    stamp.yPct = (nextTop / rect.height) * 100;
    stamp.wPct = (nextW / rect.width) * 100;
    stamp.hPct = (nextH / rect.height) * 100;
    clampSignatureStamp(stamp);
    syncSignatureControls();
    updateSignatureOverlay();
    downloadBtn.disabled = !signatureCanExport();
    return true;
  }

  function createSignatureStampElement(stamp) {
    const el = document.createElement('div');
    el.className = 'signature-stamp';
    if (stamp.id === signatureState.selectedId) el.classList.add('selected');
    if (signatureState.drag?.id === stamp.id) el.classList.add('dragging');
    el.dataset.signatureId = String(stamp.id);
    el.style.left = stamp.xPct + '%';
    el.style.top = stamp.yPct + '%';
    el.style.width = stamp.wPct + '%';
    el.style.height = stamp.hPct + '%';

    const img = document.createElement('img');
    img.alt = '';
    img.src = stamp.dataUrl;
    el.appendChild(img);

    ['nw', 'ne', 'se', 'sw'].forEach(handle => {
      const resizeHandle = document.createElement('span');
      resizeHandle.className = 'signature-resize-handle';
      resizeHandle.dataset.signatureHandle = handle;
      el.appendChild(resizeHandle);
    });
    return el;
  }

  function updateSignatureOverlay() {
    if (!signatureOverlay) return;
    const visible = activeTool === 'sign'
      && !!state.pdfDoc
      && canvasWrap.style.display !== 'none';
    signatureOverlay.hidden = !visible;
    signatureOverlay.innerHTML = '';
    if (!visible) return;
    currentPageSignatureStamps().forEach(stamp => {
      signatureOverlay.appendChild(createSignatureStampElement(stamp));
    });
  }

  function deleteSelectedSignatureStamp() {
    if (signatureState.selectedId == null) return false;
    const before = signatureState.stamps.length;
    signatureState.stamps = signatureState.stamps.filter(stamp => stamp.id !== signatureState.selectedId);
    if (signatureState.stamps.length === before) return false;
    signatureState.selectedId = null;
    syncSignatureControls();
    updateSignatureOverlay();
    updatePageState();
    return true;
  }

  function createSignatureGhost(dataUrl = signatureState.dataUrl) {
    const ghost = document.createElement('div');
    ghost.className = 'signature-ghost';
    ghost.style.backgroundImage = 'url("' + dataUrl + '")';
    document.body.appendChild(ghost);
    return ghost;
  }

  function moveSignatureDrag(e) {
    const drag = signatureState.drag;
    if (!drag) return;
    if (drag.mode === 'resize') {
      resizeSignatureStampFromPointer(e, drag);
      return;
    }
    const rect = previewCanvas.getBoundingClientRect();
    const overPage = activeTool === 'sign' && state.pdfDoc && rect.width && rect.height
      && e.clientX >= rect.left && e.clientX <= rect.right
      && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (overPage || drag.id) {
      setSignatureStampFromPoint(e.clientX, e.clientY, drag);
      if (drag.ghost) drag.ghost.style.display = 'none';
    } else if (drag.ghost) {
      drag.ghost.style.display = 'block';
      drag.ghost.style.left = e.clientX + 'px';
      drag.ghost.style.top = e.clientY + 'px';
    }
  }

  function endSignatureDrag(e) {
    if (!signatureState.drag) return;
    moveSignatureDrag(e);
    signatureDragSource.classList.remove('dragging');
    if (signatureState.drag.ghost) signatureState.drag.ghost.remove();
    window.removeEventListener('pointermove', moveSignatureDrag);
    window.removeEventListener('pointerup', endSignatureDrag);
    window.removeEventListener('pointercancel', endSignatureDrag);
    signatureState.drag = null;
    updatePageState();
  }

  function beginSignatureDragFromSource(e) {
    if (!signatureState.dataUrl || !state.pdfDoc || activeTool !== 'sign') return;
    e.preventDefault();
    signatureState.drag = {
      mode: 'new',
      id: null,
      dataUrl: signatureState.dataUrl,
      ratio: signatureState.ratio,
      offsetX: 0.5,
      offsetY: 0.5,
      ghost: createSignatureGhost(),
    };
    signatureDragSource.classList.add('dragging');
    window.addEventListener('pointermove', moveSignatureDrag);
    window.addEventListener('pointerup', endSignatureDrag);
    window.addEventListener('pointercancel', endSignatureDrag);
    moveSignatureDrag(e);
  }

  function beginSignatureOverlayDrag(e) {
    if (activeTool !== 'sign' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const stampEl = e.target.closest('.signature-stamp');
    if (!stampEl || !signatureOverlay.contains(stampEl)) return;
    const stamp = getSignatureStamp(Number(stampEl.dataset.signatureId));
    if (!stamp) return;
    e.preventDefault();
    e.stopPropagation();
    signatureState.selectedId = stamp.id;
    const handleEl = e.target.closest('[data-signature-handle]');
    if (handleEl && stampEl.contains(handleEl)) {
      signatureState.drag = {
        mode: 'resize',
        id: stamp.id,
        handle: handleEl.dataset.signatureHandle || 'se',
        startStamp: { ...stamp },
        pageRect: previewCanvas.getBoundingClientRect(),
        ghost: null,
      };
    } else {
      const rect = stampEl.getBoundingClientRect();
      signatureState.drag = {
        mode: 'move',
        id: stamp.id,
        offsetX: (e.clientX - rect.left) / Math.max(1, rect.width),
        offsetY: (e.clientY - rect.top) / Math.max(1, rect.height),
        ghost: null,
      };
    }
    updateSignatureOverlay();
    window.addEventListener('pointermove', moveSignatureDrag);
    window.addEventListener('pointerup', endSignatureDrag);
    window.addEventListener('pointercancel', endSignatureDrag);
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
  let originalPreviewUpgradeTimer = null;

  async function renderOriginalPreview(pd, sourceIndex) {
    const token = ++originalPreviewRenderToken;
    if (originalPreviewUpgradeTimer) {
      clearTimeout(originalPreviewUpgradeTimer);
      originalPreviewUpgradeTimer = null;
    }
    try {
      await renderOriginalPreviewPass(pd, sourceIndex, pd.scale, token, false);
      if (token === originalPreviewRenderToken && isOriginalPreviewTool()) {
        applyZoom();
        queueOriginalPreviewUpgrade(sourceIndex, token);
      }
    } catch (err) {
      console.error(err);
      showError(t('errors.previewFailed', { error: err.message || err }));
    }
  }

  async function renderOriginalPreviewPass(pd, sourceIndex, scale, token, highQuality) {
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    if (token !== originalPreviewRenderToken || !isOriginalPreviewTool()) return false;
    const viewport = page.getViewport({ scale });
    const nextW = Math.max(1, Math.floor(viewport.width));
    const nextH = Math.max(1, Math.floor(viewport.height));
    const tmp = highQuality ? document.createElement('canvas') : previewCanvas;
    tmp.width = nextW;
    tmp.height = nextH;
    const ctx = tmp.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    if (token !== originalPreviewRenderToken || !isOriginalPreviewTool()) {
      if (highQuality) { tmp.width = 0; tmp.height = 0; }
      return false;
    }
    if (highQuality) {
      previewCanvas.width = tmp.width;
      previewCanvas.height = tmp.height;
      previewCanvas.getContext('2d').drawImage(tmp, 0, 0);
      tmp.width = 0;
      tmp.height = 0;
    }
    const keepFullData = pageHasFullData(pd, pd.renderKey) && pd.w === nextW && pd.h === nextH;
    const updated = {
      ...pd,
      w: nextW,
      h: nextH,
      scale,
      previewQualityScale: highQuality ? scale : (pd.previewQualityScale || scale),
      lum: keepFullData ? pd.lum : null,
      histo: keepFullData ? pd.histo : null,
      renderKey: keepFullData ? pd.renderKey : null,
      metaKey: PREVIEW_META_KEY,
    };
    state.pages[sourceIndex] = updated;
    if (sourceIndex === currentSourceIndex()) {
      proofMeta.textContent = t('proof.pagePixels', { w: nextW, h: nextH, page: state.curPage, count: activePageCount() });
      updateSignatureOverlay();
    }
    return true;
  }

  function queueOriginalPreviewUpgrade(sourceIndex, token) {
    originalPreviewUpgradeTimer = setTimeout(async () => {
      originalPreviewUpgradeTimer = null;
      if (token !== originalPreviewRenderToken || !isOriginalPreviewTool() || sourceIndex !== currentSourceIndex()) return;
      const pd = state.pages[sourceIndex];
      if (!pd) return;
      const baseVp = {
        width: pd.baseW || (pd.w / pd.scale),
        height: pd.baseH || (pd.h / pd.scale),
      };
      const cssWidth = parseFloat(previewCanvas.style.width) || getFitCanvasWidth(pd) * zoomLevel;
      const targetScale = getOriginalPreviewScale(baseVp, cssWidth);
      if (targetScale <= (pd.scale || 0) * 1.12) return;
      try {
        const center = getScrollCenter();
        const rendered = await renderOriginalPreviewPass(pd, sourceIndex, targetScale, token, true);
        if (rendered && token === originalPreviewRenderToken && isOriginalPreviewTool() && sourceIndex === currentSourceIndex()) {
          applyZoom({ preserveCenter: false });
          if (zoomLevel > 1.001) requestAnimationFrame(() => {
            restoreScrollCenter(center);
            updateSignatureOverlay();
          });
        }
      } catch (err) {
        console.warn('High quality preview failed', err);
      }
    }, 120);
  }

  async function drawPreview() {
    const sourceIndex = currentSourceIndex();
    if (sourceIndex == null) {
      canvasWrap.style.display = 'none';
      emptyState.style.display = activeTool === 'organize' ? 'none' : 'block';
      return;
    }
    const token = ++processedPreviewRenderToken;
    if (isOriginalPreviewTool() && sourceIndex != null) {
      const pd = await ensurePageMeta(sourceIndex);
      if (token !== processedPreviewRenderToken || sourceIndex !== currentSourceIndex() || !isOriginalPreviewTool()) return;
      renderOriginalPreview(pd, sourceIndex);
      proofMeta.textContent = t('proof.pagePixels', { w: pd.w, h: pd.h, page: state.curPage, count: activePageCount() });
      return;
    }
    const pd = isRasterTool(activeTool)
      ? await ensureRasterPreviewData(sourceIndex)
      : await ensurePageData(sourceIndex);
    if (!pd || token !== processedPreviewRenderToken || sourceIndex !== currentSourceIndex() || activeTool === 'organize' || activeTool === 'edit') return;
    if (processTool === 'threshold') applyThresholdToCanvas(pd, previewCanvas);
    else applyGreyscaleToCanvas(pd, previewCanvas);
    proofMeta.textContent = t('proof.pagePixels', { w: pd.w, h: pd.h, page: state.curPage, count: activePageCount() });
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
    if (!isPageEdited(edit)) return t('compress.original');
    const parts = [];
    const angle = editAngle(edit);
    if (Math.abs(angle) > 0.001) parts.push((Math.round(angle * 10) / 10) + '°');
    const cropTotal = edit.crop.left + edit.crop.top + edit.crop.right + edit.crop.bottom;
    if (cropTotal) parts.push(t('edit.cropFrame'));
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
      pageEditorEmpty.textContent = t('empty.edit');
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

      const thumb = createPageThumb(sourceIndex, 'Page ' + (outputIndex + 1));
      thumb.dataset.editThumbSource = sourceIndex;
      const edit = getPageEdit(sourceIndex);
      const editedThumbUrl = state.pages[sourceIndex]?.editedThumbUrl;
      if (isPageEdited(edit) && editedThumbUrl) {
        if (thumb.tagName === 'IMG') thumb.src = editedThumbUrl;
        else {
          thumb.style.backgroundImage = 'url("' + editedThumbUrl + '")';
          thumb.textContent = '';
        }
      }
      card.appendChild(thumb);

      const actions = document.createElement('div');
      actions.className = 'page-card-actions';
      const badge = document.createElement('span');
      badge.className = 'page-edit-badge';
      badge.textContent = editedLabel(edit);
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
    cropHint.textContent = total ? t('edit.cropTotal', { total: roundCropValue(total) }) : '0%';
    cropReadout.textContent = total
      ? t('edit.cropKept', { w: roundCropValue(retainedW), h: roundCropValue(retainedH) })
      : t('edit.fullPage');
    updateCropOverlay();
  }

  function syncEditControls() {
    const hasPages = !!state.pdfDoc && activePageCount() > 0;
    rotateLeftBtn.disabled = !hasPages;
    rotateRightBtn.disabled = !hasPages;
    bottomRotateLeftBtn.disabled = !hasPages;
    bottomRotateRightBtn.disabled = !hasPages;
    resetEditBtn.disabled = !hasPages || !isPageEdited(currentPageEdit());
    editHint.textContent = hasPages ? t('edit.pageHint', { page: state.curPage }) : t('edit.selectPage');
    editSummary.textContent = hasPages
      ? t('edit.summaryActive', { page: state.curPage, count: activePageCount() })
      : t('edit.summaryEmpty');
    editRotateSlider.disabled = !hasPages;
    bottomRotateSlider.disabled = !hasPages;
    cropOverlay.hidden = !hasPages;
    if (!hasPages) {
      cropHint.textContent = '0%';
      cropReadout.textContent = t('edit.fullPage');
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
    requestEditedThumbnailRender();
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
    proofMeta.textContent = t('proof.editPage', { page: state.curPage, count: activePageCount(), edit: editedLabel(edit) });
    if (final) {
      renderPageEditor();
      requestEditedThumbnailRender();
    }
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

  async function renderEditedThumbnail(sourceIndex, edit) {
    const tmp = document.createElement('canvas');
    const size = await renderEditedColorPreviewToCanvas(sourceIndex, edit, tmp);
    if (!size) return null;
    const thumbUrl = makeThumbnailUrl(tmp, 520, 720);
    const pd = await ensurePageMeta(sourceIndex);
    state.pages[sourceIndex] = { ...(pd || {}), editedThumbUrl: thumbUrl };
    tmp.width = 0;
    tmp.height = 0;
    return thumbUrl;
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
    proofMeta.textContent = t('proof.editPage', { page: state.curPage, count: activePageCount(), edit: editedLabel(currentPageEdit()) });
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
      ? t('empty.organizeRemoved')
      : t('empty.organize');
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
      split.textContent = t('split.button');
      split.setAttribute('aria-pressed', splitExists ? 'true' : 'false');
      split.setAttribute('aria-label', canSplit
        ? t(splitExists ? 'split.removeAfterOriginal' : 'split.afterOriginal', { num: sourceIndex + 1 })
        : t('split.cannotFinal'));
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
    label.append(t('split.part', { num: splitIndex + 1 }));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'page-split-remove';
    remove.setAttribute('aria-label', t('split.removeAria', { num: splitIndex + 1 }));
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

  async function createPageOrderPdfArtifact(pageOrder, fileBase, context) {
    const pdfLib = await ensurePdfLib();
    if (!state.pdfBytes) throw new Error(t('errors.originalMissing'));
    if (!pageOrder.length) throw new Error(t('errors.noPagesExport'));
    const src = await pdfLib.PDFDocument.load(state.pdfBytes);
    const out = await pdfLib.PDFDocument.create();
    const copiedPages = await out.copyPages(src, pageOrder);
    copiedPages.forEach(page => out.addPage(page));
    const bytes = await out.save({ useObjectStreams: !context?.advanced?.password });
    return createPdfArtifact(bytes, fileBase, {
      source: 'pdf-lib',
      rasterized: false,
      preservesOriginalQuality: true,
    });
  }

  async function exportPageOrderAsPdf(pageOrder, fileBase, options = {}) {
    const context = createExportContext(options.toolId || 'organize', pageOrder, fileBase, options);
    await runExportPipeline(context, () => createPageOrderPdfArtifact(pageOrder, fileBase, context));
  }

  async function exportOrganizedPdf(pageOrder = state.pageOrder, fileBase = outputBaseName() + TOOLS.organize.suffix) {
    await exportPageOrderAsPdf(pageOrder, fileBase);
  }

  function applyVectorPageEdit(page, edit, pdfLib) {
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
      page.setRotation(pdfLib.degrees((currentRotation + e.quarterTurns * 90) % 360));
    }
  }

  async function createEditedPdfArtifact(pageOrder, fileBase, context) {
    const pdfLib = await ensurePdfLib();
    if (!state.pdfBytes) throw new Error(t('errors.originalMissing'));
    if (!pageOrder.length) throw new Error(t('errors.noPagesExport'));
    const src = await pdfLib.PDFDocument.load(state.pdfBytes);
    const out = await pdfLib.PDFDocument.create();
    let rasterized = false;
    const count = pageOrder.length;
    for (let i = 0; i < count; i++) {
      const progress = currentPageProgress(i, count);
      setLoader(true, t('progress.exportingEditedPage', { page: i + 1, count }), progress);
      const sourceIndex = pageOrder[i];
      const edit = clonePageEdit(state.pageEdits[sourceIndex]);
      if (hasFineRotation(edit)) {
        setLoader(true, t('progress.rasterizingFineRotation', { dpi: fineRotationExportDpi(), page: i + 1, count }), progress);
      }
      if (!isPageEdited(edit)) {
        const [copied] = await out.copyPages(src, [sourceIndex]);
        out.addPage(copied);
        continue;
      }

      if (!hasFineRotation(edit)) {
        const [copied] = await out.copyPages(src, [sourceIndex]);
        applyVectorPageEdit(copied, edit, pdfLib);
        out.addPage(copied);
        continue;
      }

      rasterized = true;
      const canvas = document.createElement('canvas');
      const size = await renderEditedPageImageToCanvas(sourceIndex, edit, canvas);
      const image = await out.embedPng(canvas.toDataURL('image/png'));
      const page = out.addPage([size.wPt, size.hPt]);
      page.drawImage(image, { x: 0, y: 0, width: size.wPt, height: size.hPt });
      await new Promise(r => setTimeout(r, 0));
    }
    const bytes = await out.save({ useObjectStreams: !context?.advanced?.password });
    return createPdfArtifact(bytes, fileBase, {
      source: 'pdf-lib',
      rasterized,
      preservesOriginalQuality: !rasterized,
    });
  }

  function pngDataUrlToBytes(dataUrl) {
    const comma = String(dataUrl || '').indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function createSignedPdfArtifact(pageOrder, fileBase, context) {
    const pdfLib = await ensurePdfLib();
    if (!state.pdfBytes) throw new Error(t('errors.originalMissing'));
    if (!pageOrder.length) throw new Error(t('errors.noPagesExport'));
    if (!signatureState.stamps.length) throw new Error(t('errors.noSignature'));
    const exportStamps = activeSignatureStamps(pageOrder);
    if (!exportStamps.length) {
      throw new Error(t('errors.signaturePageMissing'));
    }

    const src = await pdfLib.PDFDocument.load(state.pdfBytes);
    const out = await pdfLib.PDFDocument.create();
    const imageCache = new Map();
    async function signatureImageFor(dataUrl) {
      if (!imageCache.has(dataUrl)) {
        imageCache.set(dataUrl, out.embedPng(pngDataUrlToBytes(dataUrl)));
      }
      return imageCache.get(dataUrl);
    }
    const count = pageOrder.length;

    for (let i = 0; i < count; i++) {
      const sourceIndex = pageOrder[i];
      const [copied] = await out.copyPages(src, [sourceIndex]);
      const pageStamps = exportStamps.filter(stamp => stamp.pageIndex === sourceIndex);
      for (const stamp of pageStamps) {
        const signatureImage = await signatureImageFor(stamp.dataUrl);
        const width = copied.getWidth();
        const height = copied.getHeight();
        const drawWidth = width * stamp.wPct / 100;
        const drawHeight = height * stamp.hPct / 100;
        const x = width * stamp.xPct / 100;
        const y = height - (height * stamp.yPct / 100) - drawHeight;
        copied.drawImage(signatureImage, {
          x,
          y,
          width: drawWidth,
          height: drawHeight,
        });
      }
      out.addPage(copied);
      await new Promise(r => setTimeout(r, 0));
    }

    const bytes = await out.save({ useObjectStreams: !context?.advanced?.password });
    return createPdfArtifact(bytes, fileBase, {
      source: 'pdf-lib',
      rasterized: false,
      preservesOriginalQuality: true,
      signed: true,
    });
  }

  async function exportEditedPdf(pageOrder = state.pageOrder, fileBase = outputBaseName() + TOOLS.edit.suffix) {
    const context = createExportContext('edit', pageOrder, fileBase);
    await runExportPipeline(context, () => createEditedPdfArtifact(pageOrder, fileBase, context));
  }

  async function exportSplitPart(partIndex) {
    const part = splitParts()[partIndex];
    if (!part || !part.pageOrder.length) return;
    if (advancedPasswordToggle.checked && canPasswordProtectExport('split') && !advancedPasswordValue()) {
      showError(t('errors.password'));
      advancedPasswordInput.focus();
      return;
    }
    splitPartsList.querySelectorAll('button').forEach(button => { button.disabled = true; });
    setLoader(true, t('progress.exportingPart', { part: partIndex + 1 }), 35);
    try {
      await exportPageOrderAsPdf(part.pageOrder, part.name || defaultSplitName(partIndex), {
        toolId: 'split',
        useCurrentOnly: false,
      });
      setLoader(false);
    } catch (err) {
      console.error(err);
      showError(t('errors.splitExportFailed', { error: err.message || err }));
      setLoader(false);
    } finally {
      updatePageState();
    }
  }

  async function createRasterProcessedPdfArtifact(context) {
    const { jsPDF } = await ensureJsPdf();
    const tmp = document.createElement('canvas');
    let pdf = null;
    const count = context.pageOrder.length;
    if (!count) throw new Error(t('errors.noPagesExport'));
    for (let i = 0; i < count; i++) {
      setLoader(true, t('progress.exportingPage', { page: i + 1, count }), currentPageProgress(i, count));
      const pd = await ensurePageData(context.pageOrder[i]);
      if (!pd) throw new Error(t('errors.renderPageFailed', { page: i + 1 }));
      if (processTool === 'threshold') applyThresholdToCanvas(pd, tmp);
      else applyGreyscaleToCanvas(pd, tmp);
      const wPt = pd.w / pd.scale;
      const hPt = pd.h / pd.scale;
      const orient = wPt > hPt ? 'l' : 'p';
      const dataUrl = tmp.toDataURL('image/png');
      if (i === 0) {
        pdf = new jsPDF(jsPdfExportOptions({
          orientation: orient,
          unit: 'pt',
          format: [wPt, hPt],
        }, context));
      } else {
        pdf.addPage([wPt, hPt], orient);
      }
      pdf.addImage(dataUrl, 'PNG', 0, 0, wPt, hPt, undefined, 'FAST');
      tmp.width = 0;
      tmp.height = 0;
      await new Promise(r => setTimeout(r, 0));
    }
    return createPdfArtifact(pdf.output('arraybuffer'), context.fileBase, {
      source: 'jsPDF',
      rasterized: true,
      passwordProtected: !!(context.advanced.password && canPasswordProtectExport(context.toolId)),
      preservesOriginalQuality: false,
    });
  }

  async function renderCompressedPageToCanvas(sourceIndex, preset, canvas) {
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    const baseVp = page.getViewport({ scale: 1 });
    const requestedScale = (preset.dpi || 144) / 72;
    const cappedScale = Math.min(requestedScale, (preset.maxDimension || 2400) / Math.max(baseVp.width, baseVp.height));
    const scale = Math.max(0.5, cappedScale);
    const vp = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return {
      wPt: baseVp.width,
      hPt: baseVp.height,
    };
  }

  async function createRasterCompressedPdfArtifact(context, preset) {
    const { jsPDF } = await ensureJsPdf();
    const tmp = document.createElement('canvas');
    let pdf = null;
    const count = context.pageOrder.length;
    if (!count) throw new Error(t('errors.noPagesExport'));
    for (let i = 0; i < count; i++) {
      setLoader(true, t('progress.compressingPage', { page: i + 1, count }), currentPageProgress(i, count));
      const size = await renderCompressedPageToCanvas(context.pageOrder[i], preset, tmp);
      const orient = size.wPt > size.hPt ? 'l' : 'p';
      const dataUrl = tmp.toDataURL('image/jpeg', preset.jpegQuality);
      if (i === 0) {
        pdf = new jsPDF(jsPdfExportOptions({
          orientation: orient,
          unit: 'pt',
          format: [size.wPt, size.hPt],
          compress: true,
        }, context));
      } else {
        pdf.addPage([size.wPt, size.hPt], orient);
      }
      pdf.addImage(dataUrl, 'JPEG', 0, 0, size.wPt, size.hPt, undefined, 'FAST');
      tmp.width = 0;
      tmp.height = 0;
      await new Promise(r => setTimeout(r, 0));
    }
    return createPdfArtifact(pdf.output('arraybuffer'), context.fileBase, {
      source: 'jsPDF',
      compressionMode: state.compressMode,
      rasterized: true,
      passwordProtected: !!(context.advanced.password && canPasswordProtectExport(context.toolId)),
      preservesOriginalQuality: false,
    });
  }

  async function createCompressedPdfArtifact(context) {
    const preset = COMPRESSION_PRESETS[state.compressMode] || COMPRESSION_PRESETS.original;
    if (!preset.rasterize) {
      const artifact = await createPageOrderPdfArtifact(context.pageOrder, context.fileBase, context);
      return clonePdfArtifact(artifact, {
        meta: {
          ...artifact.meta,
          compressionMode: state.compressMode,
        },
      });
    }
    return createRasterCompressedPdfArtifact(context, preset);
  }

  // ── Threshold controls ──
  function setThresholdValue(value, render = true) {
    const v = Math.max(0, Math.min(255, Math.round(+value || 0)));
    state.threshold = v;
    threshSlider.value = String(v);
    threshNum.textContent = v;
    threshPct.textContent = Math.round((v / 255) * 100) + '%';
    threshHint.textContent = threshHintText(v);
    threshNeedle.style.left = ((v / 255) * 100) + '%';
    if (render && state.pdfDoc) requestPreviewRender(false);
  }

  threshSlider.addEventListener('input', e => setThresholdValue(e.target.value));
  thresholdResetBtn.addEventListener('click', () => setThresholdValue(128));
  invertToggle.addEventListener('click', () => {
    state.invert = !state.invert;
    setTogglePressed(invertToggle, state.invert);
    if (state.pdfDoc) requestPreviewRender(false);
  });

  // ── Greyscale controls ──
  function setBrightnessValue(value, render = true) {
    const v = Math.max(-100, Math.min(100, Math.round(+value || 0)));
    state.brightness = v;
    brightSlider.value = String(v);
    brightNum.textContent = v > 0 ? '+' + v : String(v);
    brightTag.textContent = brightnessHintText(v);
    $('greyHint').textContent = greyHintText();
    if (render && state.pdfDoc) requestPreviewRender(false);
  }

  function setContrastValue(value, render = true) {
    const v = Math.max(50, Math.min(200, Math.round(+value || 0)));
    state.contrast = v;
    contrastSlider.value = String(v);
    contrastNum.textContent = v;
    contrastTag.textContent = contrastHintText(v);
    $('greyHint').textContent = greyHintText();
    if (render && state.pdfDoc) requestPreviewRender(false);
  }

  brightSlider.addEventListener('input', e => setBrightnessValue(e.target.value));
  brightnessResetBtn.addEventListener('click', () => setBrightnessValue(0));
  contrastSlider.addEventListener('input', e => setContrastValue(e.target.value));
  contrastResetBtn.addEventListener('click', () => setContrastValue(100));
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

  compressOriginal.addEventListener('click', () => setCompressMode('original'));
  compressBalanced.addEventListener('click', () => setCompressMode('balanced'));
  compressSmall.addEventListener('click', () => setCompressMode('small'));

  function setFineRotation(value) {
    if (!state.pdfDoc) return;
    const edit = currentPageEdit();
    edit.fineRotation = Math.round((+value || 0) * 10) / 10;
    syncEditControls();
    requestEditedPreviewRender();
    requestEditedThumbnailRender();
  }

  function rotateSelectedPage90(delta) {
    if (!state.pdfDoc) return;
    const edit = currentPageEdit();
    edit.quarterTurns = (edit.quarterTurns + delta + 4) % 4;
    syncEditControls();
    renderPageEditor();
    drawEditedPagePreview();
    requestEditedThumbnailRender();
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

  signaturePad.addEventListener('pointerdown', e => {
    signatureState.padDrawing = true;
    signatureState.padPointerId = e.pointerId;
    signatureState.lastPadPoint = signaturePadPoint(e);
    signaturePad.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  signaturePad.addEventListener('pointermove', e => {
    if (!signatureState.padDrawing || e.pointerId !== signatureState.padPointerId) return;
    const point = signaturePadPoint(e);
    const ctx = signaturePad.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(signatureState.lastPadPoint.x, signatureState.lastPadPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    signatureState.lastPadPoint = point;
    e.preventDefault();
  });

  function finishSignaturePadStroke(e) {
    if (!signatureState.padDrawing || e.pointerId !== signatureState.padPointerId) return;
    if (signaturePad.hasPointerCapture(e.pointerId)) signaturePad.releasePointerCapture(e.pointerId);
    signatureState.padDrawing = false;
    signatureState.padPointerId = null;
    signatureState.lastPadPoint = null;
    updateSignatureFromPad();
    e.preventDefault();
  }

  signaturePad.addEventListener('pointerup', finishSignaturePadStroke);
  signaturePad.addEventListener('pointercancel', finishSignaturePadStroke);
  signatureClearBtn.addEventListener('click', clearSignature);
  signatureRemoveBtn.addEventListener('click', deleteSelectedSignatureStamp);
  signatureDragSource.addEventListener('pointerdown', beginSignatureDragFromSource);
  signatureOverlay.addEventListener('pointerdown', beginSignatureOverlayDrag);

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
    requestEditedThumbnailRender(sourceIndex);
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
    const editingText = e.target.closest?.('input, textarea, [contenteditable="true"]');
    if ((e.key === 'Delete' || e.key === 'Backspace') && activeTool === 'sign' && !editingText) {
      if (deleteSelectedSignatureStamp()) {
        e.preventDefault();
        return;
      }
    }
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
  const resButtons = { fast: $('resFast'), '300': $('res300'), '600': $('res600'), '900': $('res900') };

  function syncResolutionToggles() {
    Object.entries(resButtons).forEach(([key, btn]) => setTogglePressed(btn, state.resolution === key));
  }

  Object.entries(resButtons).forEach(([key, btn]) => {
    btn.addEventListener('click', async () => {
      if (state.resolution === key) return;
      if (key === '900' && !window.confirm(t('resolution.900Warning'))) {
        syncResolutionToggles();
        return;
      }
      state.resolution = key;
      syncResolutionToggles();
      if (!state.pdfDoc) return;
      if (state.largePdfSafeMode) {
        forgetFullPageData();
        setLoader(true, t('progress.resolutionCurrentPage'), 35);
        if (isRasterTool(activeTool)) {
          await ensureRasterPreviewData(currentSourceIndex());
        } else if (activeTool === 'edit') {
          await ensurePageData(currentSourceIndex());
        }
      } else {
        state.pages = new Array(state.numPages).fill(null);
        for (let i = 1; i <= state.numPages; i++) {
          const label = key === 'fast'
            ? t('progress.renderingPage', { page: i, count: state.numPages })
            : t('progress.renderingAtDpi', { dpi: key, page: i, count: state.numPages });
          setLoader(true, label, ((i - 1) / state.numPages) * 100);
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
      showError(t('errors.password'));
      advancedPasswordInput.focus();
      return;
    }
    let exportOrder;
    try {
      exportOrder = selectedExportPageOrder();
    } catch (err) {
      showError(err.message || err);
      advancedRangeInput.focus();
      return;
    }
    if (!exportOrder.length) return;
    downloadBtn.disabled = true;
    setLoader(true, t('progress.exportingPages'), 0);
    try {
      const context = createExportContext(activeTool, exportOrder, exportBaseNameForTool(activeTool));
      if (activeTool === 'organize') {
        setLoader(true, t('progress.exportingOriginalPages'), 35);
        await runExportPipeline(context, () => createPageOrderPdfArtifact(exportOrder, context.fileBase, context));
      } else if (activeTool === 'edit') {
        setLoader(true, t('progress.exportingPageEdits'), 15);
        await runExportPipeline(context, () => createEditedPdfArtifact(exportOrder, context.fileBase, context));
      } else if (activeTool === 'sign') {
        setLoader(true, t('progress.exportingSignedPdf'), 20);
        await runExportPipeline(context, () => createSignedPdfArtifact(exportOrder, context.fileBase, context));
      } else if (activeTool === 'compress') {
        setLoader(true, t('progress.compressingPdf'), 10);
        await runExportPipeline(context, createCompressedPdfArtifact);
      } else {
        await runExportPipeline(context, createRasterProcessedPdfArtifact);
      }
      setLoader(false);
    } catch (err) {
      console.error(err);
      showError(t('errors.exportFailed', { error: err.message || err }));
      setLoader(false);
    } finally {
      updatePageState();
    }
  });

  // ── Zoom ──
  const ZOOM_MIN = 0.25, ZOOM_MAX = 8, ZOOM_STEP = 1.25;
  let zoomLevel = 1; // 1 = largest fit without preview scrollbars

  function syncZoomReadout() {
    if (!zoomValEl || zoomValEl.querySelector('input')) return;
    zoomValEl.title = t('zoom.fitTitle');
    zoomValEl.textContent = (!state.pdfDoc || activeTool === 'organize')
      ? t('zoom.fit')
      : Math.round(zoomLevel * 100) + '%';
  }

  function setZoom(z, opts) {
    zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    applyZoom(opts);
  }
  let previewHeightRaf = null;
  const previewLayoutState = {
    phoneViewportHeight: 0,
    width: 0,
    orientation: '',
    height: 0,
    isPhone: false,
  };
  const panState = { active: false, pointerId: null, x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };

  function syncPreviewStageHeight() {
    if (previewHeightRaf) cancelAnimationFrame(previewHeightRaf);
    previewHeightRaf = requestAnimationFrame(() => {
      previewHeightRaf = null;
      const isTablet = window.matchMedia('(max-width: 900px)').matches;
      const isPhone = window.matchMedia('(max-width: 700px)').matches;
      const minHeight = isPhone ? 280 : (isTablet ? 520 : 620);
      const maxHeight = isPhone ? 430 : (isTablet ? 820 : 1100);
      const viewportWidth = Math.round(document.documentElement.clientWidth || window.innerWidth || 0);
      const rawViewportHeight = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
      const orientation = (screen.orientation && screen.orientation.type)
        || (viewportWidth > rawViewportHeight ? 'landscape' : 'portrait');
      const widthTolerance = isPhone ? 2 : 0;
      const widthChanged = previewLayoutState.width > 0
        && Math.abs(previewLayoutState.width - viewportWidth) > widthTolerance;
      const phoneLayoutChanged = !previewLayoutState.isPhone
        || widthChanged
        || previewLayoutState.orientation !== orientation;
      let stableViewportHeight = rawViewportHeight;
      if (isPhone) {
        if (!previewLayoutState.phoneViewportHeight || phoneLayoutChanged) {
          previewLayoutState.phoneViewportHeight = rawViewportHeight;
        }
        stableViewportHeight = previewLayoutState.phoneViewportHeight;
      } else {
        previewLayoutState.phoneViewportHeight = 0;
      }
      const mainPanel = previewStage.closest('main');
      const stageRect = previewStage.getBoundingClientRect();
      const mainRect = mainPanel ? mainPanel.getBoundingClientRect() : null;
      const panelStyle = getComputedStyle(previewStage.parentElement);
      const panelBottomInset = parseFloat(panelStyle.paddingBottom) || 0;
      const panelBottom = mainRect ? Math.max(0, mainRect.bottom - stageRect.top - panelBottomInset) : 0;
      const viewportHeight = stableViewportHeight * (isPhone ? 0.46 : 0.82);
      const preferredHeight = isPhone ? viewportHeight : Math.max(viewportHeight, panelBottom);
      const targetHeight = Math.max(minHeight, Math.min(maxHeight, preferredHeight));
      const roundedHeight = Math.round(targetHeight);
      const heightChanged = previewLayoutState.height !== roundedHeight;
      previewLayoutState.width = viewportWidth;
      previewLayoutState.orientation = orientation;
      previewLayoutState.height = roundedHeight;
      previewLayoutState.isPhone = isPhone;
      if (heightChanged) {
        previewStage.style.setProperty('--preview-stage-height', roundedHeight + 'px');
      }
      if (state.pdfDoc && (heightChanged || widthChanged)) applyZoom();
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
      syncZoomReadout();
      return;
    }
    const preserveCenter = opts.preserveCenter !== false;
    const pd = currentPageData();
    const z = zoomLevel;
    const isZoomedIn = z > 1.001;

    zoomOutBtn.disabled = !state.pdfDoc || z <= ZOOM_MIN + 0.001;
    zoomInBtn.disabled  = !state.pdfDoc || z >= ZOOM_MAX - 0.001;
    syncZoomReadout();

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
      updateSignatureOverlay();
      return;
    }

    canvasWrap.classList.toggle('zoomed', isZoomedIn);
    previewStage.classList.toggle('zoomed', isZoomedIn);
    previewCanvas.style.width = (getFitCanvasWidth(pd) * z) + 'px';
    previewCanvas.style.height = 'auto';
    updateSignatureOverlay();
    if (isOriginalPreviewTool() && previewCanvas.width && currentSourceIndex() != null) {
      queueOriginalPreviewUpgrade(currentSourceIndex(), originalPreviewRenderToken);
    }

    requestAnimationFrame(() => {
      if (isZoomedIn) restoreScrollCenter(center);
      else { previewStage.scrollLeft = 0; previewStage.scrollTop = 0; }
      updatePanCursor();
      updateSignatureOverlay();
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
      const fitWords = ['fit', t('zoom.fit').toLowerCase()];
      if (commit && fitWords.includes(raw)) setZoom(1, { preserveCenter: false });
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
    const canZoomTool = activeTool === 'preview' || activeTool === 'merge' || activeTool === 'compress' || activeTool === 'sign' || isRasterTool(activeTool) || activeTool === 'edit';
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
    updateSignatureOverlay();
  });
  document.querySelector('.tool-nav').addEventListener('scroll', updateToolIndicator);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncPreviewStageHeight);
  }
  setTimeout(() => {
    document.body.classList.add('title-condensed');
    syncPreviewStageHeight();
  }, 1000);
  currentLocale = readSavedLocale();
  applyStaticLocale();
  applyToolLocale();
  setDarkMode(readSavedTheme() === 'dark');
  syncPreviewStageHeight();
  syncToolTabA11y();
  updateSourceDropMode();
  resolutionOptions.classList.toggle('hidden', !isRasterTool(activeTool));
  downloadBtn.parentElement.style.display = activeTool === 'preview' ? 'none' : '';
  syncAdvancedOptions();
  updateMergeState();
  updatePageState();
  setTogglePressed(invertToggle, state.invert);
  setTogglePressed(greyInvertToggle, state.greyInvert);
  setTogglePressed(sepiaToggle, state.sepia);
  syncResolutionToggles();
  syncCompressControls();
  syncFineQualityToggle();
  syncToneLabels();
  syncEditControls();
  resetSignaturePadCanvas();
  syncSignatureControls();
  updateSignatureOverlay();
  updatePreviewMode();
  updateToolIndicator();

  // init display
  setThresholdValue(128, false);
  setBrightnessValue(0, false);
  setContrastValue(100, false);
