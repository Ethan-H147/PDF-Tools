  // SPDX-License-Identifier: AGPL-3.0-or-later

  import * as pdfjsLib from './vendor/pdfjs-6.3.289/legacy/build/pdf.min.mjs';
  import { PageHistory, capturePageStructure } from './page-history.mjs';

  const APP_ASSET_BASE = document.currentScript?.src || document.baseURI;

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    new URL('./vendor/pdfjs-6.3.289/legacy/build/pdf.worker.min.mjs', APP_ASSET_BASE).href;

  // ── Tool registry: add a new entry here to add a new tool ──
  const MOBILE_PERFORMANCE_MODE = (() => {
    if (navigator.userAgentData?.mobile) return true;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')) return true;
    const shortestScreenSide = Math.min(screen.width || innerWidth, screen.height || innerHeight);
    return navigator.maxTouchPoints > 1 && shortestScreenSide <= 700 && matchMedia('(pointer: coarse)').matches;
  })();
  const REDUCED_MOTION_MEDIA = window.matchMedia('(prefers-reduced-motion: reduce)');
  const prefersReducedMotion = () => REDUCED_MOTION_MEDIA.matches;
  const FINE_ROTATION_EXPORT_DPI = { high: 600, ultra: 900 };
  const LARGE_PDF_SAFE_MODE_BYTES = 35 * 1024 * 1024;
  const LARGE_PDF_SAFE_MODE_PAGES = 80;
  const SAFE_FULL_PAGE_CACHE_LIMIT = MOBILE_PERFORMANCE_MODE
    ? 1
    : (navigator.deviceMemory && navigator.deviceMemory >= 6) ? 4 : 3;
  const RASTER_PREVIEW_MAX_PIXELS = MOBILE_PERFORMANCE_MODE
    ? 1200000
    : (navigator.deviceMemory && navigator.deviceMemory >= 6) ? 4200000 : 2200000;
  const ORIGINAL_PREVIEW_MAX_PIXELS = MOBILE_PERFORMANCE_MODE
    ? 2000000
    : (navigator.deviceMemory && navigator.deviceMemory >= 8)
    ? 36000000
    : (navigator.deviceMemory && navigator.deviceMemory >= 4)
      ? 22000000
      : 12000000;
  const MOBILE_RASTER_EXPORT_MAX_PIXELS = 5000000;
  const MOBILE_CANVAS_MAX_SIDE = 4096;
  const MOBILE_THUMBNAIL_CACHE_LIMIT = 18;
  document.body.classList.toggle('mobile-performance-mode', MOBILE_PERFORMANCE_MODE);
  const RASTER_PREVIEW_KEY = 'preview-raster';
  const PREVIEW_META_KEY = 'preview-meta';
  const PDF_LIB_SCRIPT_URLS = [
    new URL('./vendor/pdf-lib-2.9.2/dist/pdf-lib.min.js', APP_ASSET_BASE).href,
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
      lede: 'Read and inspect a PDF without changing it.',
      meta: 'Move quickly between pages<br/>Zoom in on fine details<br/>Return to fit view in one click',
      downloadLabel: 'Preview Only',
      downloadSub: 'view and zoom without exporting',
      suffix: '',
    },
    organize: {
      lede: 'Rearrange pages or split a PDF into separate files.',
      meta: 'Drag pages into a new order<br/>Remove pages you do not need<br/>Add split points and name each part',
      downloadLabel: 'Export Organized PDF',
      downloadSub: 'preserve original page content',
      suffix: '_organized',
    },
    edit: {
      lede: 'Crop, straighten, or rotate individual pages.',
      meta: 'Adjust one page at a time<br/>Drag the crop frame into place<br/>Rotate by 90° or fine-tune the angle',
      downloadLabel: 'Export Edited PDF',
      downloadSub: 'apply page crops and rotations',
      suffix: '_edited',
    },
    sign: {
      lede: 'Add a hand-drawn signature to any PDF page.',
      meta: 'Draw and refine your signature<br/>Position and resize it on the page<br/>Keep the original PDF content sharp',
      downloadLabel: 'Export Signed PDF',
      downloadSub: 'stamp the signature onto the PDF',
      suffix: '_signed',
    },
    merge: {
      lede: 'Combine multiple PDFs into one document.',
      meta: 'Add as many PDFs as you need<br/>Arrange them in the right order<br/>Review the combined pages before export',
      downloadLabel: 'Merge PDFs',
      downloadSub: 'combine selected files into organize',
      suffix: '_merged',
    },
    compress: {
      lede: 'Make a PDF smaller with a choice of quality levels.',
      meta: 'Preserve original pages when possible<br/>Use Balanced for everyday sharing<br/>Use Small when file size matters most',
      downloadLabel: 'Export Compressed PDF',
      downloadSub: 'reduce file size',
      suffix: '_compressed',
    },
    threshold: {
      lede: 'Turn pages into crisp black and white.',
      meta: 'Control what becomes black or white<br/>Adjust one page or the whole document<br/>Invert the result when needed',
      downloadLabel: 'Export PDF',
      downloadSub: 'render and download all pages',
      suffix: '_bw',
    },
    greyscale: {
      lede: 'Remove color and tune the look of each page.',
      meta: 'Adjust brightness and contrast<br/>Apply settings per page or to all pages<br/>Add an inverted or warm sepia finish',
      downloadLabel: 'Export Grayscale PDF',
      downloadSub: 'render and download all pages',
      suffix: '_grey',
    },
  };

  let activeTool = 'preview';
  let processTool = 'threshold';
  let currentLocale = 'en';
  let mobileControlsOpen = false;
  const pageHistory = new PageHistory();

  const state = {
    pdfDoc: null, numPages: 0, curPage: 1,
    // threshold
    threshold: 128, invert: false,
    // greyscale
    brightness: 0, contrast: 100, greyInvert: false, sepia: false,
    rasterScopes: { threshold: 'all', greyscale: 'all' },
    rasterPageSettings: {},
    // output
    resolution: '600',
    // cache
    pages: [], pageOrder: [], splitPoints: [], splitNames: [], fileName: '', fileSize: 0, pdfBytes: null, sourceFile: null,
    mergeFiles: [], pageEdits: [],
    fineRotationQuality: 'high',
    compressMode: 'original',
    largePdfSafeMode: false,
    renderGeneration: 0,
    fullPageCacheOrder: [],
  };

  const pageRenderJobs = new Map();
  const thumbnailJobs = new Map();
  const activePdfRenderTasks = new Set();
  const thumbnailQueue = [];
  const thumbnailQueued = new Set();
  let thumbnailQueueRunning = false;
  let thumbnailObserver = null;
  let mobileThumbnailCacheOrder = [];
  let operationInProgress = false;
  let mobileEditFocused = false;
  let mobileEditOverviewScrollTop = 0;
  let pdfLoadGeneration = 0;
  let activePdfLoadingTask = null;
  let pendingPdfDestroy = Promise.resolve();
  const lazyScriptLoads = new Map();

  function isCancelledRenderError(err) {
    return err?.name === 'RenderingCancelledException' || /rendering cancelled/i.test(err?.message || '');
  }

  async function runPdfPageRender(page, params) {
    const task = page.render(params);
    activePdfRenderTasks.add(task);
    try {
      await task.promise;
      return true;
    } catch (err) {
      if (isCancelledRenderError(err)) return false;
      throw err;
    } finally {
      activePdfRenderTasks.delete(task);
    }
  }

  function cancelActivePdfRenders() {
    activePdfRenderTasks.forEach(task => {
      try { task.cancel(); } catch {}
    });
    activePdfRenderTasks.clear();
  }

  function beginPdfLoad() {
    const token = ++pdfLoadGeneration;
    const loadingTask = activePdfLoadingTask;
    activePdfLoadingTask = null;
    queuePdfDestroy(loadingTask);
    return token;
  }

  function queuePdfDestroy(pdfDoc) {
    if (!pdfDoc?.destroy) return pendingPdfDestroy;
    pendingPdfDestroy = pendingPdfDestroy
      .then(() => pdfDoc.destroy())
      .catch(() => {});
    return pendingPdfDestroy;
  }

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
  const thresholdScopeAll = $('thresholdScopeAll');
  const thresholdScopePage = $('thresholdScopePage');
  const thresholdScopeStatus = $('thresholdScopeStatus');
  const thresholdCopyToAll = $('thresholdCopyToAll');
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
  const greyscaleScopeAll = $('greyscaleScopeAll');
  const greyscaleScopePage = $('greyscaleScopePage');
  const greyscaleScopeStatus = $('greyscaleScopeStatus');
  const greyscaleCopyToAll = $('greyscaleCopyToAll');
  const prevBtn       = $('prevPage');
  const nextBtn       = $('nextPage');
  const curPageEl     = $('curPage');
  const totPageEl     = $('totPage');
  const pageCustomBadge = $('pageCustomBadge');
  const pageNav       = prevBtn.closest('.pagenav');
  const downloadBtn   = $('downloadBtn');
  const actionsDock   = downloadBtn.parentElement;
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
  const undoPagesBtn = $('undoPagesBtn');
  const mobileDocumentName = $('mobileDocumentName');
  const mergeHint     = $('mergeHint');
  const mergeSummary  = $('mergeSummary');
  const mergeList     = $('mergeList');
  const mergeClearBtn = $('mergeClearBtn');
  const mergeRunBtn   = $('mergeRunBtn');
  const compressHint  = $('compressHint');
  const compressSummary = $('compressSummary');
  const compressEstimate = $('compressEstimate');
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
  const mobileEditCloseBtn = $('mobileEditCloseBtn');
  const mobileEditResetBtn = $('mobileEditResetBtn');
  const mobileEditPageLabel = $('mobileEditPageLabel');
  const mobileEditCropLabel = $('mobileEditCropLabel');
  const mobileEditQualityBtn = $('mobileEditQualityBtn');
  const mobileEditQualityLabel = $('mobileEditQualityLabel');
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
  const mobileControlsSheet = $('mobileControlsSheet');
  const mobileControlsToggle = $('mobileControlsToggle');
  const mobileControlsLabel = $('mobileControlsLabel');
  const mobileControlsTitle = $('mobileControlsTitle');
  const mobileControlsClose = $('mobileControlsClose');
  const emptyUploadBtn = $('emptyUploadBtn');
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

  function baseRasterSettings(tool, settings = state) {
    return tool === 'threshold'
      ? { threshold: settings.threshold, invert: settings.invert }
      : {
          brightness: settings.brightness,
          contrast: settings.contrast,
          greyInvert: settings.greyInvert,
          sepia: settings.sepia,
        };
  }

  function effectiveRasterSettings(tool, sourceIndex, settings = state) {
    const base = baseRasterSettings(tool, settings);
    if (settings.rasterScopes?.[tool] !== 'page' || sourceIndex == null) return base;
    const pageSettings = settings.rasterPageSettings?.[sourceIndex]?.[tool];
    return pageSettings ? { ...base, ...pageSettings } : base;
  }

  function editableRasterSettings(tool) {
    if (state.rasterScopes[tool] !== 'page') return state;
    const sourceIndex = currentSourceIndex();
    if (sourceIndex == null) return state;
    const pageSettings = state.rasterPageSettings[sourceIndex] ||= {};
    pageSettings[tool] ||= baseRasterSettings(tool);
    return pageSettings[tool];
  }

  function syncRasterScopeUI() {
    const count = activePageCount();
    const hasPage = !!state.pdfDoc && count > 0;
    const sourceIndex = currentSourceIndex();
    [
      ['threshold', thresholdScopeAll, thresholdScopePage, thresholdScopeStatus, thresholdCopyToAll],
      ['greyscale', greyscaleScopeAll, greyscaleScopePage, greyscaleScopeStatus, greyscaleCopyToAll],
    ].forEach(([tool, allButton, pageButton, status, copyButton]) => {
      const perPage = state.rasterScopes[tool] === 'page';
      const custom = !!state.rasterPageSettings[sourceIndex]?.[tool];
      setTogglePressed(allButton, !perPage);
      setTogglePressed(pageButton, perPage);
      pageButton.disabled = !hasPage;
      copyButton.hidden = !perPage || !custom;
      status.textContent = perPage && hasPage
        ? 'Page ' + state.curPage + ' of ' + count + (custom ? ' · Custom' : '')
        : 'Every page';
    });
    const activeRasterCustom = isRasterTool(activeTool) && !!state.rasterPageSettings[sourceIndex]?.[activeTool];
    pageCustomBadge.hidden = !activeRasterCustom;
  }

  function syncRasterControls() {
    const sourceIndex = currentSourceIndex();
    const thresholdSettings = effectiveRasterSettings('threshold', sourceIndex);
    const greyscaleSettings = effectiveRasterSettings('greyscale', sourceIndex);
    const thresholdValue = thresholdSettings.threshold;
    threshSlider.value = String(thresholdValue);
    threshNum.textContent = thresholdValue;
    threshPct.textContent = Math.round((thresholdValue / 255) * 100) + '%';
    threshHint.textContent = threshHintText(thresholdValue);
    threshNeedle.style.left = ((thresholdValue / 255) * 100) + '%';
    setTogglePressed(invertToggle, thresholdSettings.invert);
    brightSlider.value = String(greyscaleSettings.brightness);
    brightNum.textContent = greyscaleSettings.brightness > 0 ? '+' + greyscaleSettings.brightness : String(greyscaleSettings.brightness);
    brightTag.textContent = brightnessHintText(greyscaleSettings.brightness);
    contrastSlider.value = String(greyscaleSettings.contrast);
    contrastNum.textContent = greyscaleSettings.contrast;
    contrastTag.textContent = contrastHintText(greyscaleSettings.contrast);
    setTogglePressed(greyInvertToggle, greyscaleSettings.greyInvert);
    setTogglePressed(sepiaToggle, greyscaleSettings.sepia);
    $('greyHint').textContent = greyHintText(greyscaleSettings);
    syncRasterScopeUI();
  }

  function syncToneLabels() {
    syncRasterControls();
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

  let themeTransitionGeneration = 0;

  function setDarkMode(enabled, persist = false, animate = false) {
    const applyThemeState = () => {
      document.body.classList.toggle('dark-mode', enabled);
      document.documentElement.classList.toggle('dark-mode', enabled);
      themeToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      themeToggle.setAttribute('aria-label', enabled ? t('theme.offAria') : t('theme.onAria'));
      themeToggleText.textContent = enabled ? t('theme.light') : t('theme.dark');
      if (persist) saveTheme(enabled ? 'dark' : 'light');
      syncPreviewStageHeight();
      updateToolIndicator();
    };

    if (!animate || prefersReducedMotion()) {
      applyThemeState();
      return;
    }

    const generation = ++themeTransitionGeneration;
    document.documentElement.classList.add('theme-transitioning');
    if (typeof document.startViewTransition === 'function') {
      const transition = document.startViewTransition(applyThemeState);
      transition.finished.catch(() => {}).finally(() => {
        if (generation === themeTransitionGeneration) {
          document.documentElement.classList.remove('theme-transitioning');
        }
      });
      return;
    }

    applyThemeState();
    requestAnimationFrame(() => {
      if (generation === themeTransitionGeneration) {
        document.documentElement.classList.remove('theme-transitioning');
      }
    });
  }

  themeToggle.addEventListener('click', () => {
    setDarkMode(!document.body.classList.contains('dark-mode'), true, true);
  });

  if (languageSwitcher) {
    languageSwitcher.addEventListener('click', e => {
      const button = e.target.closest('button[data-lang]');
      if (!button) return;
      setLocale(button.dataset.lang, true);
    });
  }

  let advancedPanelAnimation = null;

  function setAdvancedPanelExpanded(expanded) {
    const wasHidden = advancedPanel.hidden;
    if (expanded && wasHidden) advancedPanel.hidden = false;
    const currentStyle = getComputedStyle(advancedPanel);
    const currentOpacity = wasHidden ? 0 : (Number.parseFloat(currentStyle.opacity) || 0);
    const currentTransform = wasHidden
      ? 'translateY(-4px) scale(.985)'
      : currentStyle.transform === 'none'
        ? 'translateY(0) scale(1)'
        : currentStyle.transform;
    if (advancedPanelAnimation) {
      advancedPanelAnimation.cancel();
      advancedPanelAnimation = null;
    }

    advancedToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (prefersReducedMotion()) {
      advancedPanel.hidden = !expanded;
      syncMobileDockMetrics();
      return;
    }

    const targetOpacity = expanded ? 1 : 0;
    const targetTransform = expanded
      ? 'translateY(0) scale(1)'
      : 'translateY(-4px) scale(.985)';
    const animation = advancedPanel.animate([
      { opacity: currentOpacity, transform: currentTransform },
      { opacity: targetOpacity, transform: targetTransform },
    ], {
      duration: expanded ? 160 : 140,
      easing: expanded ? 'cubic-bezier(.2, .8, .2, 1)' : 'cubic-bezier(.4, 0, 1, 1)',
      fill: 'both',
    });
    advancedPanelAnimation = animation;
    syncMobileDockMetrics();
    animation.finished.then(() => {
      if (advancedPanelAnimation !== animation) return;
      if (!expanded && advancedToggle.getAttribute('aria-expanded') === 'false') {
        advancedPanel.hidden = true;
      }
      animation.cancel();
      advancedPanelAnimation = null;
      syncMobileDockMetrics();
    }).catch(() => {});
  }

  advancedToggle.addEventListener('click', () => {
    const expanded = advancedToggle.getAttribute('aria-expanded') === 'true';
    setAdvancedPanelExpanded(!expanded);
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

  function centerActiveToolTab() {
    if (!isPhoneViewport()) return;
    const activeTab = document.querySelector('.tool-tab.active');
    const nav = activeTab?.parentElement;
    if (!activeTab || !nav) return;
    const left = activeTab.offsetLeft - (nav.clientWidth - activeTab.offsetWidth) / 2;
    nav.scrollTo({
      left: Math.max(0, left),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  function toolTipText(meta) {
    const div = document.createElement('div');
    div.innerHTML = meta.replace(/<br\s*\/?>/gi, '\n');
    return div.textContent.trim();
  }

  function syncBottomDockState() {
    document.body.classList.toggle('preview-only-mode', activeTool === 'preview');
    syncMobileEditMode();
    syncMobileDockLayout();
    syncMobilePreviewWorkspace();
  }

  function isPhoneViewport() {
    return window.matchMedia('(max-width: 700px), (max-width: 1000px) and (max-height: 500px) and (pointer: coarse)').matches;
  }

  function usesMobilePreviewWorkspace() {
    return isPhoneViewport();
  }

  function syncMobilePreviewWorkspace() {
    const enabled = usesMobilePreviewWorkspace();
    if (!enabled) mobileControlsOpen = false;
    document.body.classList.toggle('mobile-preview-workspace', enabled);
    document.body.classList.toggle('mobile-signing', enabled && activeTool === 'sign');
    document.documentElement.classList.toggle('mobile-workspace', enabled);
    document.body.classList.toggle('mobile-controls-open', enabled && mobileControlsOpen);

    if (mobileControlsToggle) {
      mobileControlsToggle.hidden = !enabled;
      mobileControlsToggle.setAttribute('aria-expanded', enabled && mobileControlsOpen ? 'true' : 'false');
      mobileControlsToggle.setAttribute('aria-label', t('mobile.openControls', {
        tool: toolText(activeTool, 'label'),
      }));
    }
    if (mobileControlsLabel) mobileControlsLabel.textContent = t(enabled && activeTool === 'sign' ? 'sign.drawSignature' : 'mobile.controls');
    if (mobileControlsTitle) mobileControlsTitle.textContent = toolText(activeTool, 'label');
    if (emptyUploadBtn) emptyUploadBtn.hidden = !enabled || !!state.pdfDoc;

    if (mobileControlsSheet) {
      const visuallyHidden = enabled && !mobileControlsOpen;
      mobileControlsSheet.setAttribute('aria-hidden', visuallyHidden ? 'true' : 'false');
      mobileControlsSheet.inert = visuallyHidden;
    }
  }

  function setMobileControlsOpen(open, { restoreFocus = false, instant = false } = {}) {
    const nextOpen = usesMobilePreviewWorkspace() && !!open;
    if (!nextOpen && restoreFocus) mobileControlsToggle?.focus({ preventScroll: true });
    if (instant) document.body.classList.add('mobile-controls-instant');
    mobileControlsOpen = nextOpen;
    syncMobilePreviewWorkspace();
    syncMobileDockMetrics();
    if (nextOpen) mobileControlsClose?.focus({ preventScroll: true });
    if (instant) requestAnimationFrame(() => document.body.classList.remove('mobile-controls-instant'));
  }

  function isMobileEditLayout() {
    return isPhoneViewport() && activeTool === 'edit';
  }

  function syncMobileEditMode() {
    const mobileEditor = isMobileEditLayout();
    if (!mobileEditor || !state.pdfDoc) mobileEditFocused = false;
    const focused = mobileEditor && mobileEditFocused;
    document.documentElement.classList.toggle('mobile-edit-focused', focused);
    document.body.classList.toggle('mobile-edit-tool', mobileEditor);
    document.body.classList.toggle('mobile-edit-focused', focused);
    pageEditor?.classList.toggle('mobile-overview', mobileEditor && !focused);
    pageEditor?.classList.toggle('mobile-focused', focused);
  }

  function openMobilePageEditor(outputIndex) {
    if (!isMobileEditLayout() || !state.pdfDoc || operationInProgress) return;
    mobileEditOverviewScrollTop = pageEditorStrip.scrollTop;
    mobileEditFocused = true;
    state.curPage = Math.max(1, Math.min(activePageCount(), outputIndex + 1));
    syncMobileEditMode();
    updatePageState();
    syncEditControls();
    requestEditedPreviewRender();
    requestAnimationFrame(() => mobileEditCloseBtn?.focus({ preventScroll: true }));
  }

  function closeMobilePageEditor({ restoreFocus = true } = {}) {
    if (!mobileEditFocused) return;
    mobileEditFocused = false;
    syncMobileEditMode();
    renderPageEditor();
    syncEditControls();
    cropOverlay.hidden = true;
    requestAnimationFrame(() => {
      pageEditorStrip.scrollTop = mobileEditOverviewScrollTop;
      if (!restoreFocus) return;
      const selected = pageEditorStrip.querySelector('[data-output-index="' + (state.curPage - 1) + '"]');
      selected?.focus({ preventScroll: true });
    });
    syncMobileDockMetrics();
  }

  // Move the existing controls, preserving their state and desktop positions.
  const mobileDock = document.createElement('div');
  mobileDock.className = 'mobile-workspace-dock';
  document.querySelector('.frame').appendChild(mobileDock);
  const mobileControlHomes = [pageNav, actionsDock, resolutionOptions, advancedOptions, document.querySelector('footer')]
    .map(element => {
      const anchor = document.createComment('desktop control position');
      element.before(anchor);
      return { element, anchor };
    });

  function syncMobileDockLayout() {
    const phone = isPhoneViewport();
    const scroll = mobileControlsSheet.querySelector('.mobile-controls-scroll');
    for (const { element, anchor } of mobileControlHomes) {
      const destination = element === pageNav || element === actionsDock ? mobileDock : scroll;
      if (phone) {
        if (element.parentElement !== destination) destination.appendChild(element);
      } else if (element.previousSibling !== anchor) {
        anchor.after(element);
      }
    }
    document.body.classList.remove('page-nav-in-actions');
    syncMobileDockMetrics();
  }

  function syncMobileDockMetrics() {
    requestAnimationFrame(() => {
      const dockStyle = getComputedStyle(mobileDock);
      const height = isPhoneViewport() ? Math.ceil(mobileDock.getBoundingClientRect().height
        + parseFloat(dockStyle.marginTop) + parseFloat(dockStyle.marginBottom)) : 0;
      document.documentElement.style.setProperty('--mobile-actions-height', height + 'px');
    });
  }

  const RASTER_TOOL_ENTRY_DELAY_MS = 300;
  let rasterToolEntryTimer = null;

  function cancelRasterToolEntryRender() {
    if (!rasterToolEntryTimer) return;
    clearTimeout(rasterToolEntryTimer);
    rasterToolEntryTimer = null;
  }

  function scheduleRasterToolEntryRender(id) {
    cancelRasterToolEntryRender();
    rasterToolEntryTimer = setTimeout(() => {
      rasterToolEntryTimer = null;
      if (!state.pdfDoc || activeTool !== id || operationInProgress) return;
      requestPreviewRender(true);
    }, RASTER_TOOL_ENTRY_DELAY_MS);
  }

  function switchTool(id, { force = false } = {}) {
    if (!TOOLS[id]) return;
    if (operationInProgress && !force) return;
    if (id === activeTool) {
      syncToolTabA11y();
      return;
    }
    const previousTool = activeTool;
    cancelRasterToolEntryRender();
    if (MOBILE_PERFORMANCE_MODE) {
      resetRenderCaches({ preserveThumbnailCache: true });
      forgetFullPageData();
    }
    activeTool = id;
    setMobileControlsOpen(false);
    if (id === 'threshold' || id === 'greyscale') processTool = id;
    syncToolTabA11y();
    applyToolLocale();
    resolutionOptions.classList.toggle('hidden', !isRasterTool(id));
    actionsDock.style.display = id === 'preview' ? 'none' : '';
    syncBottomDockState();
    syncAdvancedOptions();
    updateSourceDropMode();
    if (id === 'merge') {
      seedCurrentPdfInMergeList();
      updateMergeState();
    }
    else updatePageState();
    updatePreviewMode();
    updateToolIndicator();
    requestAnimationFrame(centerActiveToolTab);
    syncPreviewStageHeight();
    if (id === 'sign') syncSignatureControls();
    if (state.pdfDoc && id !== 'organize' && id !== 'edit') {
      const enteringRasterTool = isRasterTool(id) && !isRasterTool(previousTool);
      if (!MOBILE_PERFORMANCE_MODE && enteringRasterTool) scheduleRasterToolEntryRender(id);
      else requestPreviewRender(isRasterTool(id));
    }
    if (state.pdfDoc && id === 'edit') { syncEditControls(); requestEditedPreviewRender(); }
  }

  function isRasterTool(id) {
    return id === 'threshold' || id === 'greyscale';
  }

  function updatePreviewMode() {
    syncPageHistory();
    const organizing = activeTool === 'organize';
    const editing = activeTool === 'edit';
    syncMobileEditMode();
    syncMobilePreviewWorkspace();
    if (MOBILE_PERFORMANCE_MODE) {
      if (organizing || editing) {
        previewCanvas.width = 0;
        previewCanvas.height = 0;
        previewCanvas._mobileProcessedImage = null;
      }
      if (!editing) {
        pageEditorCanvas.width = 0;
        pageEditorCanvas.height = 0;
      }
      if (!isRasterTool(activeTool)) {
        previewCanvas._mobileProcessedImage = null;
        histoCanvas.width = 0;
        histoCanvas.height = 0;
        forgetFullPageData();
      }
    }
    previewStage.classList.toggle('organizing', organizing);
    previewStage.classList.toggle('editing', editing);
    previewTools.classList.toggle('preview-tools-hidden', !isPhoneViewport() && (organizing || editing));
    previewTools.querySelector('.zoom-bar').hidden = isPhoneViewport() && (organizing || editing);
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
    syncDocumentName();
    const merging = activeTool === 'merge';
    const hasCurrentPdf = !!state.pdfBytes || !!state.sourceFile || !!state.pdfDoc;
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
  function syncDocumentName() {
    mobileDocumentName.hidden = !state.pdfDoc;
    mobileDocumentName.textContent = state.pdfDoc ? state.fileName : '';
    mobileDocumentName.title = state.pdfDoc ? state.fileName : '';
    $('mobileEditDocumentName').textContent = state.pdfDoc ? state.fileName : '';
    $('mobileEditDocumentName').title = state.pdfDoc ? state.fileName : '';
    requestAnimationFrame(positionDocumentName);
  }

  function positionDocumentName() {
    if (!isPhoneViewport() || !state.pdfDoc) return;
    const stage = previewStage.getBoundingClientRect();
    const canvas = previewCanvas.getBoundingClientRect();
    const hasCanvas = activeTool !== 'organize' && activeTool !== 'edit' && activePageCount() > 0 && !canvasWrap.classList.contains('zoomed');
    const left = hasCanvas ? Math.max(8, canvas.left - stage.left) : 16;
    const top = hasCanvas ? Math.max(6, canvas.top - stage.top - 24) : 8;
    mobileDocumentName.style.left = left + 'px';
    mobileDocumentName.style.top = top + 'px';
    mobileDocumentName.style.width = (hasCanvas ? canvas.width : Math.max(0, stage.width - 32)) + 'px';
  }

  function syncPageHistory() {
    undoPagesBtn.hidden = activeTool !== 'organize';
    undoPagesBtn.disabled = !state.pdfDoc || !pageHistory.canUndo || operationInProgress || loader.classList.contains('on');
  }

  function undoPageChange() {
    if (!state.pdfDoc || operationInProgress || loader.classList.contains('on') || activeTool !== 'organize' || organizerDrag.active) return;
    const previous = pageHistory.undo();
    if (!previous) return;
    hidePageContextMenu();
    Object.assign(state, previous);
    updatePageState();
  }

  function showError(msg) {
    if (usesMobilePreviewWorkspace()) setMobileControlsOpen(true);
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

  function yieldToMainThread() {
    return new Promise(resolve => setTimeout(resolve, 0));
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

  async function readOriginalPdfBytes() {
    if (state.pdfBytes) return normalizePdfBytes(state.pdfBytes);
    if (state.sourceFile) return new Uint8Array(await state.sourceFile.arrayBuffer());
    throw new Error(t('errors.originalMissing'));
  }

  function hasOriginalPdfSource() {
    return !!(state.pdfBytes || state.sourceFile);
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

  function createJsPdfOutputArtifact(pdf, fileBase, meta = {}) {
    if (!MOBILE_PERFORMANCE_MODE) {
      return createPdfArtifact(pdf.output('arraybuffer'), fileBase, meta);
    }
    return {
      bytes: null,
      blob: pdf.output('blob'),
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

  function createOriginalSourceArtifact(fileBase, meta = {}) {
    if (state.sourceFile) {
      return {
        bytes: null,
        blob: state.sourceFile,
        fileBase: cleanDownloadBase(fileBase, outputBaseName()),
        mimeType: 'application/pdf',
        meta: { processors: [], ...meta },
      };
    }
    return createPdfArtifact(state.pdfBytes, fileBase, meta);
  }

  function downloadPdfArtifact(artifact) {
    const blob = artifact.blob instanceof Blob
      ? artifact.blob
      : new Blob([normalizePdfBytes(artifact.bytes)], { type: artifact.mimeType || 'application/pdf' });
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
      settings: {
        processTool,
        threshold: state.threshold,
        invert: state.invert,
        brightness: state.brightness,
        contrast: state.contrast,
        greyInvert: state.greyInvert,
        sepia: state.sepia,
        rasterScopes: { ...state.rasterScopes },
        rasterPageSettings: Object.fromEntries(Object.entries(state.rasterPageSettings).map(([sourceIndex, settings]) => [
          sourceIndex,
          {
            threshold: settings.threshold ? { ...settings.threshold } : null,
            greyscale: settings.greyscale ? { ...settings.greyscale } : null,
          },
        ])),
        resolution: state.resolution,
        compressMode: state.compressMode,
        fineRotationDpi: fineRotationExportDpi(),
        pageEdits: state.pageEdits.map(edit => clonePageEdit(edit)),
        signatureStamps: signatureState.stamps.map(stamp => ({ ...stamp })),
      },
    };
  }

  function buildAdvancedExportProcessors(context, artifact) {
    const processors = [];
    if (context.advanced.password) {
      processors.push({
        id: 'password',
        label: t('progress.lockingPdf'),
        progress: 100,
        apply: applyPasswordProcessor,
      });
    }
    return processors;
  }

  async function applyPasswordProcessor(artifact, context) {
    const { PDFDocument } = await ensurePdfLib();
    const bytes = artifact.blob instanceof Blob
      ? new Uint8Array(await artifact.blob.arrayBuffer())
      : normalizePdfBytes(artifact.bytes);
    const document = await PDFDocument.load(bytes, { updateMetadata: false });
    const ownerKey = crypto.getRandomValues(new Uint8Array(32));
    const ownerPassword = Array.from(ownerKey, byte => byte.toString(16).padStart(2, '0')).join('');
    document.encrypt({
      algorithm: 'AES-256',
      userPassword: context.advanced.password,
      ownerPassword,
    });
    const encryptedBytes = await document.save();
    return clonePdfArtifact(artifact, {
      bytes: encryptedBytes,
      blob: null,
      meta: {
        passwordProtected: true,
        processors: [...(artifact.meta?.processors || []), 'password'],
      },
    });
  }

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
      'mobile.controls': 'Controls',
      'mobile.closeControls': 'Close controls',
      'mobile.openPdf': 'Open PDF',
      'mobile.openControls': 'Open {tool} controls',
      'sections.source': 'Source PDF',
      'sections.organize': 'Organize Pages',
      'sections.cropRotate': 'Crop & Rotate',
      'sections.merge': 'Merge PDFs',
      'sections.compress': 'Compress PDF',
      'sections.threshold': 'Threshold',
      'sections.greyscale': 'Grayscale',
      'sections.pages': 'Pages',
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
      'edit.mobileHold': 'Tap a page to crop or rotate it.',
      'edit.mobileCloseAria': 'Back to all pages',
      'edit.mobilePage': 'Page {page} of {count}',
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
      'empty.noPreview': 'Your preview will appear here',
      'empty.uploadToBegin': 'Choose a PDF to start',
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
      'footer.clientSide': 'No account required',
      'footer.local': 'Runs entirely in your browser',
      'errors.chooseMerge': 'Choose one or more PDF files to merge.',
      'errors.password': 'Enter a password before exporting a locked PDF.',
      'errors.notPdf': 'That doesn’t look like a PDF.',
      'tool.preview.label': 'Preview',
      'tool.preview.lede': 'Read and inspect a PDF without changing it.',
      'tool.preview.meta': 'Move quickly between pages<br/>Zoom in on fine details<br/>Return to fit view in one click',
      'tool.preview.downloadLabel': 'Preview Only',
      'tool.preview.downloadSub': 'view and zoom without exporting',
      'tool.organize.label': 'Organize',
      'tool.organize.lede': 'Rearrange pages or split a PDF into separate files.',
      'tool.organize.meta': 'Drag pages into a new order<br/>Remove pages you do not need<br/>Add split points and name each part',
      'tool.organize.downloadLabel': 'Export Organized PDF',
      'tool.organize.downloadSub': 'preserve original page content',
      'tool.edit.label': 'Crop/Rotate',
      'tool.edit.lede': 'Crop, straighten, or rotate individual pages.',
      'tool.edit.meta': 'Adjust one page at a time<br/>Drag the crop frame into place<br/>Rotate by 90° or fine-tune the angle',
      'tool.edit.downloadLabel': 'Export Edited PDF',
      'tool.edit.downloadSub': 'apply page crops and rotations',
      'tool.merge.label': 'Merge',
      'tool.merge.lede': 'Combine multiple PDFs into one document.',
      'tool.merge.meta': 'Add as many PDFs as you need<br/>Arrange them in the right order<br/>Review the combined pages before export',
      'tool.merge.downloadLabel': 'Merge PDFs',
      'tool.merge.downloadSub': 'combine selected files into organize',
      'tool.compress.label': 'Compress',
      'tool.compress.lede': 'Make a PDF smaller with a choice of quality levels.',
      'tool.compress.meta': 'Preserve original pages when possible<br/>Use Balanced for everyday sharing<br/>Use Small when file size matters most',
      'tool.compress.downloadLabel': 'Export Compressed PDF',
      'tool.compress.downloadSub': 'reduce file size',
      'tool.threshold.label': 'Threshold',
      'tool.threshold.lede': 'Turn pages into crisp black and white.',
      'tool.threshold.meta': 'Control what becomes black or white<br/>Adjust one page or the whole document<br/>Invert the result when needed',
      'tool.threshold.downloadLabel': 'Export PDF',
      'tool.threshold.downloadSub': 'render and download all pages',
      'tool.greyscale.label': 'Grayscale',
      'tool.greyscale.lede': 'Remove color and tune the look of each page.',
      'tool.greyscale.meta': 'Adjust brightness and contrast<br/>Apply settings per page or to all pages<br/>Add an inverted or warm sepia finish',
      'tool.greyscale.downloadLabel': 'Export Grayscale PDF',
      'tool.greyscale.downloadSub': 'render and download all pages',
    },
  };

  Object.assign(LOCALES, {
    'zh-Hans': {
      'brand.subtitle': 'PDF 工具',
      'nav.tools': '工具',
      'nav.toolsAria': 'PDF 工具',
      'mobile.controls': '控制项',
      'mobile.closeControls': '关闭控制项',
      'mobile.openPdf': '打开 PDF',
      'mobile.openControls': '打开{tool}控制项',
      'sections.source': '原始 PDF',
      'sections.organize': '整理页面',
      'sections.cropRotate': '裁剪与旋转',
      'sections.merge': '合并 PDF',
      'sections.compress': '压缩 PDF',
      'sections.threshold': '黑白阈值',
      'sections.greyscale': '灰度',
      'sections.pages': '页面',
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
      'edit.mobileHold': '轻点页面即可裁剪或旋转。',
      'edit.mobileCloseAria': '返回所有页面',
      'edit.mobilePage': '第 {page} 页，共 {count} 页',
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
      'footer.clientSide': '无需注册账号',
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
      'mobile.controls': '控制項',
      'mobile.closeControls': '關閉控制項',
      'mobile.openPdf': '開啟 PDF',
      'mobile.openControls': '開啟{tool}控制項',
      'sections.source': '原始 PDF',
      'sections.organize': '整理頁面',
      'sections.cropRotate': '裁切與旋轉',
      'sections.merge': '合併 PDF',
      'sections.compress': '壓縮 PDF',
      'sections.threshold': '黑白閾值',
      'sections.greyscale': '灰階',
      'sections.pages': '頁面',
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
      'edit.mobileHold': '點一下頁面即可裁切或旋轉。',
      'edit.mobileCloseAria': '返回所有頁面',
      'edit.mobilePage': '第 {page} 頁，共 {count} 頁',
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
      'footer.clientSide': '無需註冊帳號',
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
      'tool.threshold.meta': '控制哪些內容變成黑或白<br/>可調整單頁或全部頁面<br/>需要時可反相結果',
      'tool.threshold.downloadLabel': '匯出 PDF',
      'tool.threshold.downloadSub': '轉換並下載所有頁面',
      'tool.greyscale.label': '灰階',
      'tool.greyscale.lede': '用亮度和對比把 PDF 轉成灰階。',
      'tool.greyscale.meta': '調整亮度與對比<br/>可套用到單頁或全部頁面<br/>可選反相或暖色調效果',
      'tool.greyscale.downloadLabel': '匯出灰階 PDF',
      'tool.greyscale.downloadSub': '轉換並下載所有頁面',
    },
    ko: {
      'brand.subtitle': 'PDF 도구',
      'nav.tools': '도구',
      'nav.toolsAria': 'PDF 도구',
      'mobile.controls': '제어',
      'mobile.closeControls': '제어 닫기',
      'mobile.openPdf': 'PDF 열기',
      'mobile.openControls': '{tool} 제어 열기',
      'sections.source': '원본 PDF',
      'sections.organize': '페이지 정리',
      'sections.cropRotate': '자르기/회전',
      'sections.merge': 'PDF 병합',
      'sections.compress': 'PDF 압축',
      'sections.threshold': '흑백',
      'sections.greyscale': '그레이스케일',
      'sections.pages': '페이지',
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
      'edit.mobileHold': '페이지를 탭하여 자르거나 회전하세요.',
      'edit.mobileCloseAria': '모든 페이지로 돌아가기',
      'edit.mobilePage': '{count}페이지 중 {page}페이지',
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
      'footer.clientSide': '계정 없이 사용',
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
      'tool.threshold.meta': '검정과 흰색의 기준 조절<br/>페이지별 또는 전체 문서에 적용<br/>필요할 때 결과 반전',
      'tool.threshold.downloadLabel': 'PDF 내보내기',
      'tool.threshold.downloadSub': '모든 페이지 변환 후 다운로드',
      'tool.greyscale.label': '그레이스케일',
      'tool.greyscale.lede': '밝기와 대비로 PDF를 그레이스케일로 변환합니다.',
      'tool.greyscale.meta': '밝기와 대비 조절<br/>페이지별 또는 전체 문서에 적용<br/>반전 또는 따뜻한 세피아 효과',
      'tool.greyscale.downloadLabel': '그레이스케일 PDF 내보내기',
      'tool.greyscale.downloadSub': '모든 페이지 변환 후 다운로드',
    },
    ja: {
      'brand.subtitle': 'PDFツール',
      'nav.tools': 'ツール',
      'nav.toolsAria': 'PDFツール',
      'mobile.controls': 'コントロール',
      'mobile.closeControls': 'コントロールを閉じる',
      'mobile.openPdf': 'PDFを開く',
      'mobile.openControls': '{tool}のコントロールを開く',
      'sections.source': '元のPDF',
      'sections.organize': 'ページ整理',
      'sections.cropRotate': 'トリミング/回転',
      'sections.merge': 'PDF結合',
      'sections.compress': 'PDF圧縮',
      'sections.threshold': '白黒',
      'sections.greyscale': 'グレースケール',
      'sections.pages': 'ページ',
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
      'edit.mobileHold': 'ページをタップして切り抜きまたは回転します。',
      'edit.mobileCloseAria': 'すべてのページに戻る',
      'edit.mobilePage': '{count}ページ中{page}ページ',
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
      'footer.clientSide': 'アカウント登録不要',
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
      'tool.threshold.meta': '黒と白の境界を調整<br/>ページごと、または全ページに適用<br/>必要に応じて結果を反転',
      'tool.threshold.downloadLabel': 'PDFを書き出し',
      'tool.threshold.downloadSub': '全ページを変換してダウンロード',
      'tool.greyscale.label': 'グレースケール',
      'tool.greyscale.lede': '明るさとコントラストでPDFをグレースケールに変換します。',
      'tool.greyscale.meta': '明るさとコントラストを調整<br/>ページごと、または全ページに適用<br/>反転または暖かいセピア調を追加',
      'tool.greyscale.downloadLabel': 'グレースケールPDFを書き出し',
      'tool.greyscale.downloadSub': '全ページを変換してダウンロード',
    },
    es: {
      'brand.subtitle': 'Herramientas PDF',
      'nav.tools': 'Herramientas',
      'mobile.controls': 'Controles',
      'mobile.closeControls': 'Cerrar controles',
      'mobile.openPdf': 'Abrir PDF',
      'mobile.openControls': 'Abrir controles de {tool}',
      'sections.source': 'PDF de origen',
      'sections.organize': 'Organizar páginas',
      'sections.cropRotate': 'Recortar/Girar',
      'sections.merge': 'Unir PDF',
      'sections.compress': 'Comprimir PDF',
      'sections.threshold': 'Umbral',
      'sections.greyscale': 'Escala de grises',
      'sections.pages': 'Páginas',
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
      'edit.mobileHold': 'Toca una página para recortarla o girarla.',
      'edit.mobileCloseAria': 'Volver a todas las páginas',
      'edit.mobilePage': 'Página {page} de {count}',
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
      'footer.clientSide': 'Sin necesidad de cuenta',
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
      'tool.threshold.meta': 'Controla qué se vuelve negro o blanco<br/>Ajusta una página o todo el documento<br/>Invierte el resultado cuando lo necesites',
      'tool.threshold.downloadLabel': 'Exportar PDF',
      'tool.threshold.downloadSub': 'renderizar y descargar todas las páginas',
      'tool.greyscale.label': 'Grises',
      'tool.greyscale.lede': 'Convierte PDF a escala de grises con brillo y contraste.',
      'tool.greyscale.meta': 'Ajusta brillo y contraste<br/>Aplica ajustes por página o a todas<br/>Añade inversión o un acabado sepia cálido',
      'tool.greyscale.downloadLabel': 'Exportar PDF en grises',
      'tool.greyscale.downloadSub': 'renderizar y descargar todas las páginas',
    },
    fr: {
      'brand.subtitle': 'Outils PDF',
      'nav.tools': 'Outils',
      'mobile.controls': 'Réglages',
      'mobile.closeControls': 'Fermer les réglages',
      'mobile.openPdf': 'Ouvrir un PDF',
      'mobile.openControls': 'Ouvrir les réglages de {tool}',
      'sections.source': 'PDF source',
      'sections.organize': 'Organiser les pages',
      'sections.cropRotate': 'Recadrer/Pivoter',
      'sections.merge': 'Fusionner des PDF',
      'sections.compress': 'Compresser le PDF',
      'sections.threshold': 'Seuil',
      'sections.greyscale': 'Niveaux de gris',
      'sections.pages': 'Pages',
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
      'edit.mobileHold': 'Touchez une page pour la recadrer ou la pivoter.',
      'edit.mobileCloseAria': 'Revenir à toutes les pages',
      'edit.mobilePage': 'Page {page} sur {count}',
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
      'footer.clientSide': 'Aucun compte requis',
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
      'tool.threshold.meta': 'Choisissez ce qui devient noir ou blanc<br/>Réglez une page ou tout le document<br/>Inversez le résultat si nécessaire',
      'tool.threshold.downloadLabel': 'Exporter le PDF',
      'tool.threshold.downloadSub': 'rendre et télécharger toutes les pages',
      'tool.greyscale.label': 'Gris',
      'tool.greyscale.lede': 'Convertissez les PDF en niveaux de gris avec luminosité et contraste.',
      'tool.greyscale.meta': 'Réglez la luminosité et le contraste<br/>Appliquez les réglages par page ou partout<br/>Ajoutez une inversion ou un sépia chaleureux',
      'tool.greyscale.downloadLabel': 'Exporter le PDF en gris',
      'tool.greyscale.downloadSub': 'rendre et télécharger toutes les pages',
    },
  });

  const SIGN_LOCALES = {
    en: {
      'sections.sign': 'Sign PDF',
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
      'tool.sign.lede': 'Add a hand-drawn signature to any PDF page.',
      'tool.sign.meta': 'Draw and refine your signature<br/>Position and resize it on the page<br/>Keep the original PDF content sharp',
      'tool.sign.downloadLabel': 'Export Signed PDF',
      'tool.sign.downloadSub': 'stamp the signature onto the PDF',
    },
    'zh-Hans': {
      'sections.sign': '签署 PDF',
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
      'sections.sign': '簽署 PDF',
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
      'sections.sign': 'PDF 서명',
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
      'sections.sign': 'PDFに署名',
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
      'sections.sign': 'Firmar PDF',
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
      'sections.sign': 'Signer le PDF',
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
  Object.entries({ en: 'Jump to page', 'zh-Hans': '跳转到页面', 'zh-Hant-TW': '跳至頁面', ko: '페이지로 이동', ja: 'ページへ移動', es: 'Ir a la página', fr: 'Aller à la page' }).forEach(([locale, label]) => { LOCALES[locale]['pages.jump'] = label; });

  Object.entries({
    en: ['Use signature', 'Drag to position', 'Make signature smaller', 'Make signature larger', 'Use signature to place it on this page.'],
    'zh-Hans': ['使用签名', '拖动以调整位置', '缩小签名', '放大签名', '点击“使用签名”将其放到当前页面。'],
    'zh-Hant-TW': ['使用簽名', '拖曳以調整位置', '縮小簽名', '放大簽名', '點選「使用簽名」將其放到目前頁面。'],
    ko: ['서명 사용', '드래그하여 배치', '서명 축소', '서명 확대', '서명 사용을 눌러 현재 페이지에 배치하세요.'],
    ja: ['署名を使用', 'ドラッグして配置', '署名を縮小', '署名を拡大', '「署名を使用」を押してこのページに配置します。'],
    es: ['Usar firma', 'Arrastra para colocar', 'Reducir firma', 'Ampliar firma', 'Pulsa Usar firma para colocarla en esta página.'],
    fr: ['Utiliser la signature', 'Glisser pour placer', 'Réduire la signature', 'Agrandir la signature', 'Appuyez sur Utiliser la signature pour la placer sur cette page.'],
  }).forEach(([locale, values]) => {
    ['useSignature', 'moveHint', 'smaller', 'larger', 'useHint'].forEach((key, index) => {
      LOCALES[locale]['sign.' + key] = values[index];
    });
  });

  Object.entries({
    en: ['Undo', 'Undo page change'],
    'zh-Hans': ['撤销', '撤销页面更改'],
    'zh-Hant-TW': ['復原', '復原頁面變更'],
    ko: ['실행 취소', '페이지 변경 실행 취소'],
    ja: ['取り消す', 'ページの変更を取り消す'],
    es: ['Deshacer', 'Deshacer cambio de páginas'],
    fr: ['Annuler', 'Annuler la modification des pages'],
  }).forEach(([locale, [undo, undoPages]]) => {
    Object.assign(LOCALES[locale], { 'actions.undo': undo, 'actions.undoPages': undoPages });
  });

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
    return advancedPasswordToggle.checked ? advancedPasswordInput.value : '';
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
    syncMobileDockMetrics();
  }

  function currentPageData() {
    const sourceIndex = currentSourceIndex();
    return sourceIndex == null ? null : state.pages[sourceIndex];
  }

  function shouldUseLargePdfSafeMode(fileSize, pageCount) {
    return MOBILE_PERFORMANCE_MODE || fileSize >= LARGE_PDF_SAFE_MODE_BYTES || pageCount >= LARGE_PDF_SAFE_MODE_PAGES;
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

  function resetRenderCaches({ preserveThumbnailCache = false } = {}) {
    state.renderGeneration++;
    cancelActivePdfRenders();
    cancelOriginalPreviewRender();
    if (previewRenderFrame) {
      cancelAnimationFrame(previewRenderFrame);
      previewRenderFrame = null;
    }
    previewNeedsHistogram = false;
    mobilePreviewRenderQueued = false;
    if (editPreviewFrame) {
      cancelAnimationFrame(editPreviewFrame);
      editPreviewFrame = null;
    }
    editPreviewQueued = false;
    editedPreviewRenderToken++;
    if (editThumbnailTimer) {
      clearTimeout(editThumbnailTimer);
      editThumbnailTimer = null;
    }
    editThumbnailToken++;
    if (originalPreviewUpgradeTimer) {
      clearTimeout(originalPreviewUpgradeTimer);
      originalPreviewUpgradeTimer = null;
    }
    state.fullPageCacheOrder = [];
    pageRenderJobs.clear();
    thumbnailJobs.clear();
    thumbnailQueue.length = 0;
    thumbnailQueued.clear();
    if (!preserveThumbnailCache) mobileThumbnailCacheOrder = [];
    if (thumbnailObserver) {
      thumbnailObserver.disconnect();
      thumbnailObserver = null;
    }
  }

  function touchFullPageCache(sourceIndex) {
    const rasterPreviewCache = isRasterTool(activeTool);
    if ((!state.largePdfSafeMode && !rasterPreviewCache) || sourceIndex == null) return;
    const cacheLimit = MOBILE_PERFORMANCE_MODE
      ? 1
      : rasterPreviewCache && state.resolution === '900'
        ? 1
        : rasterPreviewCache && state.resolution === '600'
          ? 2
          : SAFE_FULL_PAGE_CACHE_LIMIT;
    state.fullPageCacheOrder = state.fullPageCacheOrder.filter(index => index !== sourceIndex);
    state.fullPageCacheOrder.push(sourceIndex);
    while (state.fullPageCacheOrder.length > cacheLimit) {
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
    if (mobileEditQualityBtn) {
      mobileEditQualityBtn.classList.toggle('on', ultra);
      mobileEditQualityBtn.setAttribute('aria-pressed', ultra ? 'true' : 'false');
    }
    if (mobileEditQualityLabel) {
      mobileEditQualityLabel.textContent = ultra ? t('edit.qualityUltra') : t('edit.qualityHigh');
    }
  }

  function estimateCompressedOutput(preset) {
    if (!state.pdfDoc || !activePageCount()) return null;
    let totalPixels = 0;
    state.pageOrder.forEach(sourceIndex => {
      const pd = state.pages[sourceIndex];
      const baseW = pd?.baseW || (pd?.w && pd?.scale ? pd.w / pd.scale : 612);
      const baseH = pd?.baseH || (pd?.h && pd?.scale ? pd.h / pd.scale : 792);
      const requestedScale = (preset.dpi || 144) / 72;
      const cappedScale = Math.min(requestedScale, (preset.maxDimension || 2400) / Math.max(baseW, baseH));
      totalPixels += Math.max(1, Math.floor(baseW * cappedScale)) * Math.max(1, Math.floor(baseH * cappedScale));
    });
    const bytesPerPixel = state.compressMode === 'small' ? 0.075 : 0.12;
    const midpoint = totalPixels * bytesPerPixel + activePageCount() * 2600;
    return {
      low: Math.max(1024, midpoint * 0.62),
      high: Math.max(2048, midpoint * 1.42),
    };
  }

  function compressionEstimateText(preset) {
    if (!state.pdfDoc) return 'Choose a PDF to see an estimated output size.';
    if (!preset.rasterize) {
      return 'Expected output: close to the source size' + (state.fileSize ? ' (' + fmtBytes(state.fileSize) + ')' : '') + '.';
    }
    const estimate = estimateCompressedOutput(preset);
    return estimate
      ? 'Rough estimate: ' + fmtBytes(estimate.low) + '–' + fmtBytes(estimate.high) + ' · actual size depends on page detail.'
      : 'Output size will be estimated after the PDF is ready.';
  }

  function syncCompressControls() {
    const preset = COMPRESSION_PRESETS[state.compressMode] || COMPRESSION_PRESETS.original;
    setTogglePressed(compressOriginal, state.compressMode === 'original');
    setTogglePressed(compressBalanced, state.compressMode === 'balanced');
    setTogglePressed(compressSmall, state.compressMode === 'small');
    const modeKey = state.compressMode === 'balanced' ? 'Balanced' : state.compressMode === 'small' ? 'Small' : 'Original';
    compressHint.textContent = t('compress.hint' + modeKey);
    compressSummary.textContent = t('compress.summary' + modeKey);
    compressEstimate.textContent = compressionEstimateText(preset);
  }

  function setCompressMode(mode) {
    if (operationInProgress) return;
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
    syncPageHistory();
    syncDocumentName();
    const count = activePageCount();
    normalizeSplitState();
    if (count === 0) state.curPage = 1;
    else state.curPage = Math.max(1, Math.min(state.curPage, count));
    pageCountEl.textContent = state.pdfDoc ? count : '—';
    totPageEl.textContent = state.pdfDoc ? padPage(count) : '—';
    curPageEl.textContent = state.pdfDoc && count ? padPage(state.curPage) : '—';
    prevBtn.disabled = operationInProgress || !state.pdfDoc || state.curPage <= 1;
    nextBtn.disabled = operationInProgress || !state.pdfDoc || state.curPage >= count;
    downloadBtn.disabled = operationInProgress || (activeTool === 'preview'
      ? true
      : activeTool === 'merge'
        ? state.mergeFiles.length === 0
        : activeTool === 'sign'
          ? !signatureCanExport()
          : !state.pdfDoc || count === 0);
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
    syncRasterControls();
    syncCompressControls();
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
    syncPageHistory();
    loader.setAttribute('aria-busy', on ? 'true' : 'false');
    loader.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on && label != null) loaderLabel.textContent = label;
    if (on && pct != null) {
      const clampedPct = Math.max(0, Math.min(100, Number(pct) || 0));
      const roundedPct = Math.round(clampedPct);
      loaderPct.textContent = roundedPct + '%';
      loaderBar.style.transform = 'scaleX(' + (clampedPct / 100) + ')';
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

  function greyHintText(settings = state) {
    if (settings.sepia) return t('hint.sepia');
    if (settings.greyInvert) return t('hint.inverted');
    if (settings.brightness > 40) return t('hint.bright');
    if (settings.brightness < -40) return t('hint.dark');
    if (settings.contrast > 140) return t('hint.highContrast');
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
    if (operationInProgress) return;
    pageHistory.clear();
    beginPdfLoad();
    clearError();
    const previousPdf = state.pdfDoc;
    state.pdfDoc = null;
    state.mergeFiles = state.mergeFiles.filter(file => !isCurrentPdfMergeFile(file));
    resetRenderCaches();
    queuePdfDestroy(previousPdf);
    state.numPages = 0;
    state.curPage = 1;
    state.pages = [];
    state.pageOrder = [];
    state.splitPoints = [];
    state.splitNames = [];
    state.pageEdits = [];
    state.rasterPageSettings = {};
    state.fileName = '';
    state.fileSize = 0;
    state.pdfBytes = null;
    state.sourceFile = null;
    signatureState.stamps = [];
    signatureState.selectedId = null;
    signatureState.drag = null;
    signatureState.nextId = 1;
    state.largePdfSafeMode = false;
    state.fullPageCacheOrder = [];
    previewCanvas.width = 0;
    previewCanvas.height = 0;
    previewCanvas._mobileProcessedImage = null;
    pageEditorCanvas.width = 0;
    pageEditorCanvas.height = 0;
    canvasWrap.style.display = 'none';
    pageEditorCanvasWrap.style.display = 'none';
    fileNameEl.textContent = '—';
    fileNameEl.title = '';
    fileNameEl.removeAttribute('tabindex');
    fileSizeEl.textContent = '—';
    fileStatusEl.textContent = t('status.ready');
    setLoader(false);
    fileCard.classList.remove('on');
    downloadBtn.disabled = activeTool !== 'merge';
    zoomLevel = 1;
    updateSourceDropMode();
    updateMergeState();
    syncSignatureControls();
    updateSignatureOverlay();
    updatePageState();
    updatePreviewMode();
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
      up.disabled = operationInProgress || index === 0;
      up.setAttribute('aria-label', t('merge.moveUp', { name: file.name }));
      up.addEventListener('click', () => moveMergeFile(index, -1));
      const down = document.createElement('button');
      down.type = 'button';
      down.innerHTML = '<span class="merge-file-action-glyph merge-file-action-arrow" aria-hidden="true">↓</span>';
      down.disabled = operationInProgress || index === state.mergeFiles.length - 1;
      down.setAttribute('aria-label', t('merge.moveDown', { name: file.name }));
      down.addEventListener('click', () => moveMergeFile(index, 1));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.innerHTML = '<span class="merge-file-action-glyph" aria-hidden="true">×</span>';
      remove.setAttribute('aria-label', t('merge.remove', { name: file.name }));
      remove.disabled = operationInProgress;
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
    mergeClearBtn.disabled = operationInProgress || count === 0;
    mergeRunBtn.disabled = operationInProgress || count === 0;
    if (activeTool === 'merge') downloadBtn.disabled = operationInProgress || count === 0;
    renderMergeList();
  }

  function currentPdfAsMergeFile() {
    const source = state.sourceFile || state.pdfBytes;
    if (!source || !state.fileName) return null;
    const name = normalizePdfName(state.fileName);
    const size = state.fileSize || source.size || source.byteLength || source.length || 0;
    return {
      name,
      size,
      type: 'application/pdf',
      currentPdfSource: source,
      arrayBuffer: async () => source instanceof Blob ? source.arrayBuffer() : source,
    };
  }

  function isCurrentPdfMergeFile(file) {
    return file?.currentPdfSource === (state.sourceFile || state.pdfBytes) ||
      (state.fileName && normalizePdfName(file.name) === normalizePdfName(state.fileName) && file.size === state.fileSize);
  }

  function seedCurrentPdfInMergeList() {
    const currentFile = currentPdfAsMergeFile();
    if (!currentFile) return;
    state.mergeFiles = state.mergeFiles.filter(file => !isCurrentPdfMergeFile(file));
    state.mergeFiles.unshift(currentFile);
  }

  function addMergeFiles(fileList) {
    if (operationInProgress) return;
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
    if (operationInProgress) return;
    const next = index + delta;
    if (next < 0 || next >= state.mergeFiles.length) return;
    const [file] = state.mergeFiles.splice(index, 1);
    state.mergeFiles.splice(next, 0, file);
    updateMergeState();
  }

  function removeMergeFile(index) {
    if (operationInProgress) return;
    state.mergeFiles.splice(index, 1);
    updateMergeState();
  }

  async function buildMergedPdfBytes(files) {
    const pdfLib = await ensurePdfLib();
    const out = await pdfLib.PDFDocument.create();
    let totalPages = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setLoader(true, t('progress.mergingFile', { name: file.name }), (i / files.length) * 70);
      const src = await pdfLib.PDFDocument.load(await file.arrayBuffer());
      const pageIndices = src.getPageIndices();
      const pages = await out.copyPages(src, pageIndices);
      for (const page of pages) {
        out.addPage(page);
        if (MOBILE_PERFORMANCE_MODE) await yieldToMainThread();
      }
      totalPages += pageIndices.length;
    }
    return { bytes: await out.save(), totalPages };
  }

  async function mergeSelectedPdfs() {
    if (operationInProgress) return;
    clearError();
    if (!state.mergeFiles.length) {
      showError(t('errors.chooseMerge'));
      return;
    }
    operationInProgress = true;
    beginPdfLoad();
    updateMergeState();
    updatePageState();
    setLoader(true, t('progress.mergingPdfs'), 0);
    try {
      let files = state.mergeFiles.slice();
      const mergedName = cleanDownloadBase(files[0].name, 'merged') +
        (files.length > 1 ? '_merged.pdf' : '_copy.pdf');
      const { bytes, totalPages } = await buildMergedPdfBytes(files);
      state.mergeFiles = [];
      files = null;
      updateMergeState();
      if (MOBILE_PERFORMANCE_MODE) await yieldToMainThread();
      const mergedSourceFile = MOBILE_PERFORMANCE_MODE
        ? new File([bytes], normalizePdfName(mergedName), { type: 'application/pdf' })
        : null;
      await loadPdfBytes(bytes, mergedName, bytes.byteLength, t('progress.renderingMergedPdf'), mergedSourceFile);
      switchTool('organize', { force: true });
      setLoader(false);
      proofMeta.textContent = t('proof.mergedPages', { count: totalPages });
    } catch (err) {
      console.error(err);
      showError(t('errors.mergeFailed', { error: err.message || err }));
      setLoader(false);
      updateMergeState();
    } finally {
      operationInProgress = false;
      updateMergeState();
      updatePageState();
    }
  }

  mergeClearBtn.addEventListener('click', () => {
    if (operationInProgress) return;
    state.mergeFiles = [];
    updateMergeState();
  });
  mergeRunBtn.addEventListener('click', () => mergeSelectedPdfs());

  dropZone.addEventListener('click', () => fileInput.click());
  emptyUploadBtn?.addEventListener('click', () => fileInput.click());
  mobileControlsToggle?.addEventListener('click', e => {
    setMobileControlsOpen(!mobileControlsOpen, { instant: e.detail === 0 });
  });
  mobileControlsClose?.addEventListener('click', e => {
    setMobileControlsOpen(false, { restoreFocus: true, instant: e.detail === 0 });
  });
  document.addEventListener('pointerdown', e => {
    if (!mobileControlsOpen) return;
    if (mobileControlsSheet?.contains(e.target) || mobileControlsToggle?.contains(e.target)) return;
    setMobileControlsOpen(false);
  });
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

  async function loadPdfBytes(
    buf,
    fileName,
    fileSize,
    loadingLabel = t('progress.loadingPdf'),
    sourceFile = null,
    loadToken = beginPdfLoad(),
  ) {
    if (loadToken !== pdfLoadGeneration) return false;
    pageHistory.clear();
    const previousPdf = state.pdfDoc;
    state.pdfDoc = null;
    resetRenderCaches();
    queuePdfDestroy(previousPdf);
    await pendingPdfDestroy;
    if (loadToken !== pdfLoadGeneration) return false;
    state.numPages = 0;
    state.curPage = 1;
    state.pages = [];
    state.pageOrder = [];
    state.splitPoints = [];
    state.splitNames = [];
    state.pageEdits = [];
    state.rasterPageSettings = {};
    state.largePdfSafeMode = false;
    state.fullPageCacheOrder = [];
    previewCanvas.width = 0;
    previewCanvas.height = 0;
    previewCanvas._mobileProcessedImage = null;
    pageEditorCanvas.width = 0;
    pageEditorCanvas.height = 0;
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
    const inputBytes = normalizePdfBytes(buf);
    state.sourceFile = sourceFile;
    state.pdfBytes = sourceFile ? null : inputBytes;
    updatePageState();
    updateSourceDropMode();
    setLoader(true, loadingLabel, 0);
    const pdfData = sourceFile ? inputBytes : inputBytes.slice();
    if (location.protocol === 'file:') {
      // Local files cannot import module workers. PDF.js supports a same-thread
      // worker handler loaded by a classic script without weakening browser policy.
      await loadScriptOnce('PDF worker', [new URL('./vendor/pdfjs-6.3.289/legacy/build/pdf.worker.local.js', APP_ASSET_BASE).href]);
      if (loadToken !== pdfLoadGeneration) return false;
    }
    const loadingTask = pdfjsLib.getDocument({
      data: pdfData,
      isEvalSupported: false,
      cMapUrl: new URL('./vendor/pdfjs-6.3.289/cmaps/', APP_ASSET_BASE).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('./vendor/pdfjs-6.3.289/standard_fonts/', APP_ASSET_BASE).href,
      wasmUrl: new URL('./vendor/pdfjs-6.3.289/wasm/', APP_ASSET_BASE).href,
      iccUrl: new URL('./vendor/pdfjs-6.3.289/iccs/', APP_ASSET_BASE).href,
    });
    activePdfLoadingTask = loadingTask;
    let pdf;
    try {
      pdf = await loadingTask.promise;
    } catch (err) {
      if (loadToken !== pdfLoadGeneration) return false;
      throw err;
    } finally {
      if (activePdfLoadingTask === loadingTask) activePdfLoadingTask = null;
    }
    if (loadToken !== pdfLoadGeneration) {
      await queuePdfDestroy(pdf);
      return false;
    }
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
    const lazyOpen = state.largePdfSafeMode || isRasterTool(activeTool) || activeTool === 'preview' || activeTool === 'organize' || activeTool === 'edit' || activeTool === 'sign' || activeTool === 'compress';
    if (lazyOpen) {
      setLoader(true, state.largePdfSafeMode ? t('progress.openingLargePdf') : t('progress.openingPdf'), 45);
      await ensurePageMeta(0);
      if (activeTool === 'edit') await ensureRasterPreviewData(0);
      if (loadToken !== pdfLoadGeneration) return false;
    } else {
      for (let i = 1; i <= pdf.numPages; i++) {
        setLoader(true, t('progress.renderingPage', { page: i, count: pdf.numPages }), ((i - 1) / pdf.numPages) * 100);
        await renderPageToLuminance(i);
        if (loadToken !== pdfLoadGeneration) return false;
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
    return true;
  }

  async function handleFile(file) {
    if (operationInProgress) return;
    clearError();
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      showError(t('errors.notPdf')); return;
    }
    const loadToken = beginPdfLoad();
    try {
      const buffer = await file.arrayBuffer();
      if (loadToken !== pdfLoadGeneration || operationInProgress) return;
      const loaded = await loadPdfBytes(
        buffer,
        file.name,
        file.size,
        t('progress.loadingPdf'),
        MOBILE_PERFORMANCE_MODE ? file : null,
        loadToken,
      );
      if (loaded) {
        setMobileControlsOpen(false);
      }
    } catch (err) {
      if (loadToken !== pdfLoadGeneration) return;
      console.error(err);
      showError(t('errors.readPdfFailed', { error: err.message || err }));
      fileStatusEl.textContent = t('status.error');
      updatePageState();
      updatePreviewMode();
      setLoader(false);
    }
  }

  // ── Page luminance cache ──
  function capScaleToPixelBudget(baseVp, requestedScale, maxPixels) {
    const basePixels = Math.max(1, baseVp.width * baseVp.height);
    const pixelScale = Math.sqrt(maxPixels / basePixels);
    const sideScale = MOBILE_CANVAS_MAX_SIDE / Math.max(1, baseVp.width, baseVp.height);
    return Math.min(requestedScale, pixelScale, sideScale);
  }

  function getMobileExportPagePixelBudget(pageCount) {
    const memoryGb = Number(navigator.deviceMemory) || 4;
    const documentPixelBudget = memoryGb <= 2 ? 24000000 : memoryGb <= 4 ? 40000000 : 60000000;
    const minimumPageBudget = memoryGb <= 2 ? 300000 : 450000;
    return Math.max(
      minimumPageBudget,
      Math.min(MOBILE_RASTER_EXPORT_MAX_PIXELS, Math.floor(documentPixelBudget / Math.max(1, pageCount))),
    );
  }

  function getMobileGreyscaleJpegQuality(pageCount) {
    if (pageCount > 40) return 0.70;
    if (pageCount > 15) return 0.76;
    return 0.84;
  }

  function getRenderScale(baseVp, resolution = state.resolution, pixelBudget = MOBILE_RASTER_EXPORT_MAX_PIXELS) {
    let requestedScale;
    if (resolution === '900') requestedScale = 900 / 72;
    else if (resolution === '600') requestedScale = 600 / 72;
    else if (resolution === '300') requestedScale = 300 / 72;
    else requestedScale = Math.min(2.5, 1800 / Math.max(baseVp.width, baseVp.height));
    return MOBILE_PERFORMANCE_MODE
      ? capScaleToPixelBudget(baseVp, requestedScale, pixelBudget)
      : requestedScale;
  }

  function getPreviewRenderScale(baseVp) {
    const requestedScale = Math.min(2.5, 2200 / Math.max(baseVp.width, baseVp.height));
    return MOBILE_PERFORMANCE_MODE
      ? capScaleToPixelBudget(baseVp, Math.min(1.65, requestedScale), RASTER_PREVIEW_MAX_PIXELS)
      : requestedScale;
  }

  function isOriginalPreviewTool(id = activeTool) {
    return id === 'preview' || id === 'merge' || id === 'sign' || (id === 'compress' && state.compressMode === 'original');
  }

  function getOriginalPreviewScale(baseVp, targetCssWidth) {
    const basePixels = Math.max(1, baseVp.width * baseVp.height);
    const fitScale = Math.max(0.1, (targetCssWidth || baseVp.width) * Math.max(1, devicePixelRatio || 1) / baseVp.width);
    const memoryScale = Math.sqrt(ORIGINAL_PREVIEW_MAX_PIXELS / basePixels);
    const targetScale = Math.max(getPreviewRenderScale(baseVp), Math.min(fitScale, memoryScale));
    return MOBILE_PERFORMANCE_MODE
      ? Math.min(targetScale, MOBILE_CANVAS_MAX_SIDE / Math.max(1, baseVp.width, baseVp.height))
      : targetScale;
  }

  function getRasterPreviewScale(baseVp) {
    const pagePixels = Math.max(1, baseVp.width * baseVp.height);
    const budgetScale = Math.min(2.4, Math.sqrt(RASTER_PREVIEW_MAX_PIXELS / pagePixels));
    return MOBILE_PERFORMANCE_MODE
      ? Math.min(budgetScale, MOBILE_CANVAS_MAX_SIDE / Math.max(1, baseVp.width, baseVp.height))
      : Math.max(0.35, budgetScale);
  }

  async function ensurePageMeta(sourceIndex) {
    if (!state.pdfDoc || sourceIndex == null) return null;
    const generation = state.renderGeneration;
    const pdfDoc = state.pdfDoc;
    const existing = state.pages[sourceIndex];
    if (existing && existing.w && existing.h && existing.scale && existing.metaKey === PREVIEW_META_KEY) return existing;
    const page = await pdfDoc.getPage(sourceIndex + 1);
    if (generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }
    const baseVp = page.getViewport({ scale: 1 });
    const scale = getPreviewRenderScale(baseVp);
    const vp = page.getViewport({ scale });
    const pd = {
      ...(existing || {}),
      w: Math.max(1, Math.floor(vp.width)),
      h: Math.max(1, Math.floor(vp.height)),
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
    if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
    return pd;
  }

  async function renderPageToLuminance(pageNum, opts = {}) {
    const generation = state.renderGeneration;
    const pdfDoc = state.pdfDoc;
    const sourceIndex = pageNum - 1;
    const existing = state.pages[sourceIndex];
    const page = await pdfDoc.getPage(pageNum);
    if (generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }
    const baseVp = page.getViewport({ scale: 1 });
    const renderKey = opts.renderKey || state.resolution;
    const scale = opts.scale || getRenderScale(baseVp);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(vp.width));
    c.height = Math.max(1, Math.floor(vp.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    const rendered = await runPdfPageRender(page, { canvasContext: ctx, viewport: vp });
    if (!rendered || generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      c.width = 0;
      c.height = 0;
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }
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
    if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
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
    if (!MOBILE_PERFORMANCE_MODE) {
      return ensurePageData(sourceIndex, { renderKey: state.resolution, skipThumb: true });
    }
    const generation = state.renderGeneration;
    const pdfDoc = state.pdfDoc;
    const page = await pdfDoc.getPage(sourceIndex + 1);
    if (generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }
    const scale = getRasterPreviewScale(page.getViewport({ scale: 1 }));
    if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
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
    const url = thumb.toDataURL('image/png');
    thumb.width = 0;
    thumb.height = 0;
    return url;
  }

  async function renderThumbnail(sourceIndex, quality = 'low') {
    if (!state.pdfDoc || sourceIndex == null) return null;
    const generation = state.renderGeneration;
    const pdfDoc = state.pdfDoc;
    const existing = state.pages[sourceIndex];
    if (existing?.thumbUrl && (quality === 'low' || existing.thumbQuality === 'high')) return existing.thumbUrl;
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = quality === 'high'
      ? Math.min(1.45, 900 / Math.max(baseVp.width, baseVp.height))
      : Math.min(0.75, (MOBILE_PERFORMANCE_MODE ? 180 : 260) / Math.max(baseVp.width, baseVp.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(vp.width));
    c.height = Math.max(1, Math.floor(vp.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    const rendered = await runPdfPageRender(page, { canvasContext: ctx, viewport: vp });
    if (!rendered || generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      c.width = 0;
      c.height = 0;
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }
    const thumbUrl = quality === 'high'
      ? makeThumbnailUrl(c, 520, 720)
      : makeThumbnailUrl(c, MOBILE_PERFORMANCE_MODE ? 160 : 220, MOBILE_PERFORMANCE_MODE ? 220 : 310);
    const pd = await ensurePageMeta(sourceIndex);
    if (generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      c.width = 0;
      c.height = 0;
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }
    state.pages[sourceIndex] = { ...(pd || {}), thumbUrl, thumbQuality: quality };
    c.width = 0;
    c.height = 0;
    if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
    return thumbUrl;
  }

  function applyThumbnailToElements(sourceIndex, thumbUrl) {
    document.querySelectorAll('[data-thumb-source="' + sourceIndex + '"]').forEach(el => {
      if (el.dataset.editThumbSource != null &&
          isPageEdited(getPageEdit(sourceIndex)) &&
          state.pages[sourceIndex]?.editedThumbUrl) return;
      if (el.tagName === 'IMG') el.src = thumbUrl;
      else el.style.backgroundImage = 'url("' + thumbUrl + '")';
      el.classList.remove('page-thumb-placeholder');
      el.textContent = '';
      el.setAttribute('aria-label', 'Page thumbnail ' + (sourceIndex + 1));
    });
  }

  function touchMobileThumbnailCache(sourceIndex) {
    if (!MOBILE_PERFORMANCE_MODE || sourceIndex == null) return;
    mobileThumbnailCacheOrder = mobileThumbnailCacheOrder.filter(index => index !== sourceIndex);
    mobileThumbnailCacheOrder.push(sourceIndex);
    while (mobileThumbnailCacheOrder.length > MOBILE_THUMBNAIL_CACHE_LIMIT) {
      const evictIndex = mobileThumbnailCacheOrder.shift();
      if (evictIndex === sourceIndex) continue;
      const pd = state.pages[evictIndex];
      if (!pd?.thumbUrl && !pd?.editedThumbUrl) continue;
      pd.thumbUrl = null;
      pd.thumbQuality = null;
      pd.editedThumbUrl = null;
      document.querySelectorAll('[data-thumb-source="' + evictIndex + '"]').forEach(el => {
        el.removeAttribute('src');
        el.style.backgroundImage = '';
        el.classList.add('page-thumb-placeholder');
        el.textContent = 'Page ' + (evictIndex + 1);
        getThumbnailObserver()?.observe(el);
      });
    }
  }

  function applyEditedThumbnailToElements(sourceIndex, thumbUrl) {
    document.querySelectorAll('[data-edit-thumb-source="' + sourceIndex + '"]').forEach(el => {
      if (el.tagName === 'IMG') el.src = thumbUrl;
      else el.style.backgroundImage = 'url("' + thumbUrl + '")';
      el.classList.remove('page-thumb-placeholder');
      el.textContent = '';
      el.setAttribute('aria-label', 'Edited page thumbnail ' + (sourceIndex + 1));
    });
  }

  let editThumbnailTimer = null;
  let editThumbnailToken = 0;
  function requestEditedThumbnailRender(sourceIndex = currentSourceIndex(), delay = 500) {
    if (operationInProgress) return;
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
    signaturePad.width = MOBILE_PERFORMANCE_MODE ? 600 : 900;
    signaturePad.height = MOBILE_PERFORMANCE_MODE ? 400 : 300;
    const ctx = signaturePad.getContext('2d');
    ctx.clearRect(0, 0, signaturePad.width, signaturePad.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = MOBILE_PERFORMANCE_MODE ? 4 : 5;
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
    const mobileSigning = isPhoneViewport() && activeTool === 'sign';
    const currentSelection = getSignatureStamp(signatureState.selectedId)?.pageIndex === currentSourceIndex();
    $('mobileSignUse').disabled = !hasInk || !hasPdf || operationInProgress;
    $('mobileSignActions').hidden = !mobileSigning || !currentSelection;
    if (mobileSigning) mobileControlsLabel.textContent = t('sign.drawSignature');
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
    if (mobileSigning && hasPdf) signSummary.textContent = t(hasInk ? 'sign.useHint' : 'sign.drawFirst');
  }

  function placeMobileSignature() {
    if (operationInProgress || !state.pdfDoc || !signatureState.dataUrl || activeTool !== 'sign') return;
    const rect = previewCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const stamp = clampSignatureStamp(defaultSignaturePlacement(rect));
    signatureState.stamps.push(stamp);
    signatureState.selectedId = stamp.id;
    setMobileControlsOpen(false, { restoreFocus: true });
    updatePageState();
  }

  function resizeMobileSignature(factor) {
    const stamp = getSignatureStamp(signatureState.selectedId);
    if (!stamp || operationInProgress || stamp.pageIndex !== currentSourceIndex()) return;
    const centerX = stamp.xPct + stamp.wPct / 2;
    const centerY = stamp.yPct + stamp.hPct / 2;
    const minScale = Math.max(5 / stamp.wPct, 2 / stamp.hPct);
    const maxScale = Math.min(95 / stamp.wPct, 95 / stamp.hPct);
    const scale = Math.max(minScale, Math.min(maxScale, factor));
    stamp.wPct *= scale;
    stamp.hPct *= scale;
    stamp.xPct = centerX - stamp.wPct / 2;
    stamp.yPct = centerY - stamp.hPct / 2;
    clampSignatureStamp(stamp);
    updateSignatureOverlay();
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
    if (isPhoneViewport()) return;
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
    if (existing?.thumbUrl && (quality === 'low' || existing.thumbQuality === 'high')) {
      touchMobileThumbnailCache(sourceIndex);
      return existing.thumbUrl;
    }
    const jobKey = state.renderGeneration + ':thumb:' + sourceIndex + ':' + quality;
    if (thumbnailJobs.has(jobKey)) return thumbnailJobs.get(jobKey);
    const job = renderThumbnail(sourceIndex, quality)
      .then(url => {
        if (url) {
          applyThumbnailToElements(sourceIndex, url);
          touchMobileThumbnailCache(sourceIndex);
        }
        if (quality === 'low' && (!MOBILE_PERFORMANCE_MODE || isOrganizerThumbnailVisible(sourceIndex))) queueThumbnail(sourceIndex, 'high');
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
        if (MOBILE_PERFORMANCE_MODE && quality === 'high') {
          const generation = state.renderGeneration;
          await new Promise(resolve => setTimeout(resolve, 350));
          if (generation !== state.renderGeneration || !isOrganizerThumbnailVisible(sourceIndex)) continue;
        }
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
    const item = { sourceIndex, quality };
    if (quality === 'low') thumbnailQueue.unshift(item);
    else thumbnailQueue.push(item);
    runThumbnailQueue();
  }

  function isOrganizerThumbnailVisible(sourceIndex) {
    if (activeTool !== 'organize' || document.hidden || organizerDrag.active) return false;
    const thumb = organizerGrid.querySelector('[data-thumb-source="' + sourceIndex + '"]');
    if (!thumb) return false;
    const rect = thumb.getBoundingClientRect();
    const viewport = previewStage.getBoundingClientRect();
    return rect.width > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom
      && rect.right > viewport.left && rect.left < viewport.right;
  }

  function getThumbnailObserver() {
    if (!('IntersectionObserver' in window)) return null;
    if (!thumbnailObserver) {
      thumbnailObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const sourceIndex = Number(entry.target.dataset.thumbSource);
          if (!MOBILE_PERFORMANCE_MODE) observer.unobserve(entry.target);
          queueThumbnail(sourceIndex);
          if (MOBILE_PERFORMANCE_MODE && isOrganizerThumbnailVisible(sourceIndex)) queueThumbnail(sourceIndex, 'high');
        });
      }, { root: previewStage, rootMargin: MOBILE_PERFORMANCE_MODE ? '0px' : '420px' });
    }
    return thumbnailObserver;
  }

  function createPageThumb(sourceIndex, label) {
    const pd = state.pages[sourceIndex];
    if (MOBILE_PERFORMANCE_MODE) {
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb' + (pd?.thumbUrl ? '' : ' page-thumb-placeholder');
      thumb.dataset.thumbSource = sourceIndex;
      thumb.setAttribute('aria-label', label);
      if (pd?.thumbUrl) {
        thumb.style.backgroundImage = 'url("' + pd.thumbUrl + '")';
        touchMobileThumbnailCache(sourceIndex);
      } else {
        thumb.textContent = 'Page ' + (sourceIndex + 1);
      }
      const visibleObserver = getThumbnailObserver();
      if (visibleObserver) visibleObserver.observe(thumb);
      else queueThumbnail(sourceIndex);
      return thumb;
    }
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
  function applyThresholdToCanvas(pd, canvas, settings = state) {
    if (!MOBILE_PERFORMANCE_MODE || canvas.width !== pd.w || canvas.height !== pd.h) {
      canvas.width = pd.w;
      canvas.height = pd.h;
      canvas._mobileProcessedImage = null;
    }
    const ctx = canvas.getContext('2d');
    const img = MOBILE_PERFORMANCE_MODE
      ? (canvas._mobileProcessedImage ||= ctx.createImageData(pd.w, pd.h))
      : ctx.createImageData(pd.w, pd.h);
    const d = img.data; const lum = pd.lum;
    const thresh = settings.threshold; const inv = settings.invert;
    const lut = MOBILE_PERFORMANCE_MODE ? new Uint8ClampedArray(256) : null;
    if (lut) {
      for (let value = 0; value < 256; value++) {
        lut[value] = (inv ? value >= thresh : value < thresh) ? 0 : 255;
      }
    }
    for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
      const v = lut ? lut[lum[j]] : (inv ? lum[j] >= thresh : lum[j] < thresh) ? 0 : 255;
      d[i] = v; d[i+1] = v; d[i+2] = v; d[i+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function applyGreyscaleToCanvas(pd, canvas, settings = state) {
    if (!MOBILE_PERFORMANCE_MODE || canvas.width !== pd.w || canvas.height !== pd.h) {
      canvas.width = pd.w;
      canvas.height = pd.h;
      canvas._mobileProcessedImage = null;
    }
    const ctx = canvas.getContext('2d');
    const img = MOBILE_PERFORMANCE_MODE
      ? (canvas._mobileProcessedImage ||= ctx.createImageData(pd.w, pd.h))
      : ctx.createImageData(pd.w, pd.h);
    const d = img.data; const lum = pd.lum;
    const bf = settings.brightness * 1.28;
    const cf = settings.contrast / 100;
    const inv = settings.greyInvert;
    const sep = settings.sepia;
    const lut = MOBILE_PERFORMANCE_MODE ? new Uint8ClampedArray(256 * 3) : null;
    if (lut) {
      for (let source = 0; source < 256; source++) {
        let value = Math.max(0, Math.min(255, (source - 128) * cf + 128 + bf)) | 0;
        if (inv) value = 255 - value;
        const offset = source * 3;
        lut[offset] = sep ? Math.min(255, (value * 1.12) | 0) : value;
        lut[offset + 1] = value;
        lut[offset + 2] = sep ? Math.max(0, (value * 0.72) | 0) : value;
      }
    }
    for (let j = 0, i = 0; j < lum.length; j++, i += 4) {
      if (lut) {
        const offset = lum[j] * 3;
        d[i] = lut[offset];
        d[i + 1] = lut[offset + 1];
        d[i + 2] = lut[offset + 2];
        d[i + 3] = 255;
        continue;
      }
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

  async function canvasToImageInput(canvas, mimeType, quality) {
    if (!MOBILE_PERFORMANCE_MODE || !canvas.toBlob) {
      return canvas.toDataURL(mimeType, quality);
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, quality));
    if (!blob) throw new Error('Could not encode the rendered page.');
    return new Uint8Array(await blob.arrayBuffer());
  }

  let originalPreviewRenderToken = 0;
  let processedPreviewRenderToken = 0;
  let originalPreviewUpgradeTimer = null;
  let originalPreviewRenderTask = null;

  function cancelOriginalPreviewRender() {
    if (!originalPreviewRenderTask) return;
    try { originalPreviewRenderTask.cancel(); } catch {}
    activePdfRenderTasks.delete(originalPreviewRenderTask);
    originalPreviewRenderTask = null;
  }

  async function renderOriginalPreview(pd, sourceIndex) {
    const token = ++originalPreviewRenderToken;
    cancelOriginalPreviewRender();
    if (originalPreviewUpgradeTimer) {
      clearTimeout(originalPreviewUpgradeTimer);
      originalPreviewUpgradeTimer = null;
    }
    try {
      const rendered = await renderOriginalPreviewPass(pd, sourceIndex, pd.scale, token, false);
      if (rendered && token === originalPreviewRenderToken && isOriginalPreviewTool()) {
        applyZoom();
        queueOriginalPreviewUpgrade(sourceIndex, token);
      }
    } catch (err) {
      console.error(err);
      showError(t('errors.previewFailed', { error: err.message || err }));
    }
  }

  async function renderOriginalPreviewPass(pd, sourceIndex, scale, token, highQuality) {
    const generation = state.renderGeneration;
    const pdfDoc = state.pdfDoc;
    if (!pdfDoc) return false;
    let page;
    try {
      page = await pdfDoc.getPage(sourceIndex + 1);
    } catch (err) {
      if (generation !== state.renderGeneration ||
          pdfDoc !== state.pdfDoc ||
          token !== originalPreviewRenderToken ||
          !isOriginalPreviewTool()) return false;
      throw err;
    }
    if (generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return false;
    }
    if (token !== originalPreviewRenderToken || !isOriginalPreviewTool()) {
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return false;
    }
    const viewport = page.getViewport({ scale });
    const nextW = Math.max(1, Math.floor(viewport.width));
    const nextH = Math.max(1, Math.floor(viewport.height));
    const tmp = highQuality ? document.createElement('canvas') : previewCanvas;
    tmp.width = nextW;
    tmp.height = nextH;
    const ctx = tmp.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, tmp.width, tmp.height);
    const task = page.render({ canvasContext: ctx, viewport });
    originalPreviewRenderTask = task;
    activePdfRenderTasks.add(task);
    try {
      await task.promise;
    } catch (err) {
      if (isCancelledRenderError(err)) {
        if (highQuality) { tmp.width = 0; tmp.height = 0; }
        return false;
      }
      throw err;
    } finally {
      activePdfRenderTasks.delete(task);
      if (originalPreviewRenderTask === task) originalPreviewRenderTask = null;
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
    }
    if (generation !== state.renderGeneration || pdfDoc !== state.pdfDoc || token !== originalPreviewRenderToken || !isOriginalPreviewTool()) {
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
    if (originalPreviewUpgradeTimer) {
      clearTimeout(originalPreviewUpgradeTimer);
      originalPreviewUpgradeTimer = null;
    }
    if (MOBILE_PERFORMANCE_MODE) return;
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
    if (activeTool === 'compress' && state.compressMode !== 'original') {
      await drawCompressedPreview(sourceIndex, token);
      return;
    }
    if (isOriginalPreviewTool() && sourceIndex != null) {
      const pd = await ensurePageMeta(sourceIndex);
      if (!pd || token !== processedPreviewRenderToken || sourceIndex !== currentSourceIndex() || !isOriginalPreviewTool()) return;
      renderOriginalPreview(pd, sourceIndex);
      proofMeta.textContent = t('proof.pagePixels', { w: pd.w, h: pd.h, page: state.curPage, count: activePageCount() });
      return;
    }
    const pd = isRasterTool(activeTool)
      ? await ensureRasterPreviewData(sourceIndex)
      : await ensurePageData(sourceIndex);
    if (!pd || token !== processedPreviewRenderToken || sourceIndex !== currentSourceIndex() || activeTool === 'organize' || activeTool === 'edit') return;
    const previewSettings = effectiveRasterSettings(processTool, sourceIndex);
    if (processTool === 'threshold') applyThresholdToCanvas(pd, previewCanvas, previewSettings);
    else applyGreyscaleToCanvas(pd, previewCanvas, previewSettings);
    proofMeta.textContent = t('proof.pagePixels', { w: pd.w, h: pd.h, page: state.curPage, count: activePageCount() });
    applyZoom();
  }

  async function decodeCompressedPreview(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function drawCompressedPreview(sourceIndex, token) {
    const mode = state.compressMode;
    const preset = COMPRESSION_PRESETS[mode];
    if (!preset?.rasterize) return;
    const tmp = document.createElement('canvas');
    const pixelBudget = MOBILE_PERFORMANCE_MODE
      ? getMobileExportPagePixelBudget(activePageCount())
      : undefined;
    const size = await renderCompressedPageToCanvas(sourceIndex, preset, tmp, pixelBudget);
    if (!size || token !== processedPreviewRenderToken || activeTool !== 'compress' || state.compressMode !== mode || sourceIndex !== currentSourceIndex()) {
      tmp.width = 0;
      tmp.height = 0;
      return;
    }
    const width = tmp.width;
    const height = tmp.height;
    const blob = await new Promise(resolve => tmp.toBlob(resolve, 'image/jpeg', preset.jpegQuality));
    if (!blob) throw new Error('Could not encode the compressed preview.');
    const image = await decodeCompressedPreview(blob);
    if (token !== processedPreviewRenderToken || activeTool !== 'compress' || state.compressMode !== mode || sourceIndex !== currentSourceIndex()) {
      image.close?.();
      tmp.width = 0;
      tmp.height = 0;
      return;
    }
    previewCanvas.width = width;
    previewCanvas.height = height;
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    image.close?.();
    tmp.width = 0;
    tmp.height = 0;
    proofMeta.textContent = t('proof.pagePixels', { w: width, h: height, page: state.curPage, count: activePageCount() });
    applyZoom();
  }

  async function drawHistogram() {
    if (!isRasterTool(activeTool)) return;
    const sourceIndex = currentSourceIndex();
    const pd = await ensureRasterPreviewData(sourceIndex);
    if (!pd || sourceIndex !== currentSourceIndex() || !isRasterTool(activeTool)) return;
    const cw = histoCanvas.clientWidth || 300;
    const ch = histoCanvas.clientHeight || 56;
    const pixelRatio = MOBILE_PERFORMANCE_MODE ? Math.min(2, devicePixelRatio || 1) : devicePixelRatio;
    histoCanvas.width = cw * pixelRatio;
    histoCanvas.height = ch * pixelRatio;
    const ctx = histoCanvas.getContext('2d');
    ctx.scale(pixelRatio, pixelRatio);
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
  let mobilePreviewRenderInFlight = false;
  let mobilePreviewRenderQueued = false;
  function requestPreviewRender(withHistogram = false) {
    if (operationInProgress) return;
    previewNeedsHistogram = previewNeedsHistogram || withHistogram;
    if (MOBILE_PERFORMANCE_MODE) {
      mobilePreviewRenderQueued = true;
      if (previewRenderFrame || mobilePreviewRenderInFlight) return;
      previewRenderFrame = requestAnimationFrame(async () => {
        previewRenderFrame = null;
        mobilePreviewRenderQueued = false;
        mobilePreviewRenderInFlight = true;
        const needsHistogram = previewNeedsHistogram;
        previewNeedsHistogram = false;
        try {
          await drawPreview();
          if (needsHistogram) await drawHistogram();
        } catch (err) {
          if (!isCancelledRenderError(err)) console.warn('Preview render failed', err);
        } finally {
          mobilePreviewRenderInFlight = false;
          if (mobilePreviewRenderQueued) requestPreviewRender(false);
        }
      });
      return;
    }
    if (previewRenderFrame) return;
    previewRenderFrame = requestAnimationFrame(() => {
      previewRenderFrame = null;
      drawPreview();
      if (previewNeedsHistogram) drawHistogram();
      previewNeedsHistogram = false;
    });
  }

  let editPreviewFrame = null;
  let editPreviewInFlight = false;
  let editPreviewQueued = false;
  function requestEditedPreviewRender() {
    if (operationInProgress) return;
    if (isMobileEditLayout() && !mobileEditFocused) return;
    editPreviewQueued = true;
    if (editPreviewFrame || editPreviewInFlight) return;
    editPreviewFrame = requestAnimationFrame(async () => {
      editPreviewFrame = null;
      editPreviewQueued = false;
      editPreviewInFlight = true;
      try {
        await drawEditedPagePreview();
      } catch (err) {
        if (!isCancelledRenderError(err)) console.warn('Edit preview failed', err);
      } finally {
        editPreviewInFlight = false;
        if (editPreviewQueued) requestEditedPreviewRender();
      }
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

  const MOBILE_EDIT_HOLD_MS = 520;

  function selectPageForEditing(outputIndex) {
    state.curPage = outputIndex + 1;
    updatePageState();
    syncEditControls();
    requestEditedPreviewRender();
  }

  function bindPageEditCard(card, outputIndex) {
    let holdTimer = null;
    let holdStartX = 0;
    let holdStartY = 0;
    let longPressed = false;

    const cancelHold = () => {
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
      card.classList.remove('is-pressing');
    };

    card.addEventListener('pointerdown', e => {
      if (!isMobileEditLayout() || mobileEditFocused || operationInProgress) return;
      if (e.button != null && e.button !== 0) return;
      cancelHold();
      longPressed = false;
      holdStartX = e.clientX;
      holdStartY = e.clientY;
      card.classList.add('is-pressing');
      holdTimer = setTimeout(() => {
        holdTimer = null;
        longPressed = true;
        card.classList.remove('is-pressing');
        openMobilePageEditor(outputIndex);
      }, MOBILE_EDIT_HOLD_MS);
    });
    card.addEventListener('pointermove', e => {
      if (!holdTimer) return;
      if (Math.hypot(e.clientX - holdStartX, e.clientY - holdStartY) > 10) cancelHold();
    });
    card.addEventListener('pointerup', cancelHold);
    card.addEventListener('pointercancel', cancelHold);
    card.addEventListener('pointerleave', cancelHold);
    card.addEventListener('contextmenu', e => {
      if (isMobileEditLayout()) e.preventDefault();
    });
    card.addEventListener('keydown', e => {
      if (!isMobileEditLayout() || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      openMobilePageEditor(outputIndex);
    });
    card.addEventListener('click', e => {
      if (isMobileEditLayout()) {
        e.preventDefault();
        if (!longPressed) openMobilePageEditor(outputIndex);
        longPressed = false;
        return;
      }
      selectPageForEditing(outputIndex);
    });
  }

  function renderPageEditor() {
    if (!pageEditorStrip || activeTool !== 'edit') return;
    if (thumbnailObserver) {
      thumbnailObserver.disconnect();
      thumbnailObserver = null;
    }
    pageEditorStrip.innerHTML = '';
    const count = activePageCount();
    const hasPages = !!state.pdfDoc && count > 0;
    const mobileOverview = isMobileEditLayout() && !mobileEditFocused;
    pageEditor.classList.toggle('is-empty', !hasPages);
    pageEditorEmpty.classList.toggle('on', !hasPages);
    pageEditorCanvasWrap.style.display = hasPages && !mobileOverview ? 'block' : 'none';
    pageEditorBottom.style.display = hasPages && !mobileOverview ? 'flex' : 'none';
    if (!hasPages) {
      pageEditorEmpty.textContent = t('empty.edit');
      cropOverlay.hidden = true;
      return;
    }
    for (let outputIndex = 0; outputIndex < count; outputIndex++) {
      const sourceIndex = state.pageOrder[outputIndex];
      const card = document.createElement('button');
      card.type = 'button';
      const selected = !mobileOverview && state.curPage === outputIndex + 1;
      card.className = 'page-edit-card' + (selected ? ' active' : '');
      card.dataset.outputIndex = outputIndex;
      card.dataset.sourceIndex = sourceIndex;
      if (mobileOverview) card.setAttribute('aria-describedby', 'mobileEditOverviewHint');

      const thumb = createPageThumb(sourceIndex, 'Page ' + (outputIndex + 1));
      thumb.dataset.editThumbSource = sourceIndex;
      const edit = getPageEdit(sourceIndex);
      const edited = isPageEdited(edit);
      card.classList.toggle('edited', edited);
      const editedThumbUrl = state.pages[sourceIndex]?.editedThumbUrl;
      if (edited && editedThumbUrl) {
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
      badge.textContent = mobileOverview && !edited ? '' : editedLabel(edit);
      const num = document.createElement('div');
      num.className = 'page-number';
      num.textContent = outputIndex + 1;
      actions.appendChild(badge);
      actions.appendChild(num);
      card.appendChild(actions);

      bindPageEditCard(card, outputIndex);
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
    if (mobileEditCropLabel) mobileEditCropLabel.textContent = cropReadout.textContent;
    updateCropOverlay();
  }

  function syncEditControls() {
    const hasPages = !!state.pdfDoc && activePageCount() > 0;
    const mobileOverview = isMobileEditLayout() && !mobileEditFocused;
    rotateLeftBtn.disabled = !hasPages;
    rotateRightBtn.disabled = !hasPages;
    bottomRotateLeftBtn.disabled = !hasPages;
    bottomRotateRightBtn.disabled = !hasPages;
    resetEditBtn.disabled = !hasPages || !isPageEdited(currentPageEdit());
    mobileEditResetBtn.disabled = resetEditBtn.disabled;
    editHint.textContent = hasPages
      ? (mobileOverview ? t('organize.pages', { count: activePageCount() }) : t('edit.pageHint', { page: state.curPage }))
      : t('edit.selectPage');
    editSummary.textContent = hasPages
      ? (mobileOverview ? t('edit.mobileHold') : t('edit.summaryActive', { page: state.curPage, count: activePageCount() }))
      : t('edit.summaryEmpty');
    editRotateSlider.disabled = !hasPages;
    bottomRotateSlider.disabled = !hasPages;
    cropOverlay.hidden = !hasPages || mobileOverview;
    if (mobileEditPageLabel) {
      mobileEditPageLabel.textContent = t('edit.mobilePage', { page: state.curPage, count: activePageCount() });
    }
    if (!hasPages) {
      cropHint.textContent = '0%';
      cropReadout.textContent = t('edit.fullPage');
      if (mobileEditCropLabel) mobileEditCropLabel.textContent = cropReadout.textContent;
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
    return activeTool === 'edit' &&
      (!isMobileEditLayout() || mobileEditFocused) &&
      !!state.pdfDoc && activePageCount() > 0 && !!pageEditorCanvas.width;
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
    const resetDisabled = !isPageEdited(edit);
    resetEditBtn.disabled = resetDisabled;
    mobileEditResetBtn.disabled = resetDisabled;
    proofMeta.textContent = t('proof.editPage', { page: state.curPage, count: activePageCount(), edit: editedLabel(edit) });
    if (final) {
      renderPageEditor();
      requestEditedThumbnailRender();
    }
  }

  function beginCropDrag(e) {
    if (operationInProgress) return;
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
    const generation = state.renderGeneration;
    const pdfDoc = state.pdfDoc;
    const page = await pdfDoc.getPage(sourceIndex + 1);
    if (generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }
    const baseVp = page.getViewport({ scale: 1 });
    const scale = getRasterPreviewScale(baseVp);
    const vp = page.getViewport({ scale });
    const base = document.createElement('canvas');
    base.width = Math.max(1, Math.floor(vp.width));
    base.height = Math.max(1, Math.floor(vp.height));
    const bctx = base.getContext('2d');
    bctx.fillStyle = '#fff';
    bctx.fillRect(0, 0, base.width, base.height);
    const rendered = await runPdfPageRender(page, { canvasContext: bctx, viewport: vp });
    if (!rendered || generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      base.width = 0;
      base.height = 0;
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }

    const e = clonePageEdit(edit);
    if (!includeCrop) e.crop = { left: 0, top: 0, right: 0, bottom: 0 };
    const cropLeft = Math.round(base.width * e.crop.left / 100);
    const cropTop = Math.round(base.height * e.crop.top / 100);
    const cropRight = Math.round(base.width * e.crop.right / 100);
    const cropBottom = Math.round(base.height * e.crop.bottom / 100);
    const cropW = Math.max(1, base.width - cropLeft - cropRight);
    const cropH = Math.max(1, base.height - cropTop - cropBottom);
    const crop = MOBILE_PERFORMANCE_MODE ? null : document.createElement('canvas');
    if (crop) {
      crop.width = cropW;
      crop.height = cropH;
      const cctx = crop.getContext('2d');
      cctx.fillStyle = '#fff';
      cctx.fillRect(0, 0, cropW, cropH);
      cctx.drawImage(base, cropLeft, cropTop, cropW, cropH, 0, 0, cropW, cropH);
    }
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
    if (crop) ctx.drawImage(crop, -cropW / 2, -cropH / 2);
    else ctx.drawImage(base, cropLeft, cropTop, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);

    base.width = 0;
    base.height = 0;
    if (crop) { crop.width = 0; crop.height = 0; }
    if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
    return { w: outW, h: outH };
  }

  async function renderEditedThumbnail(sourceIndex, edit) {
    const generation = state.renderGeneration;
    const pdfDoc = state.pdfDoc;
    if (!pdfDoc) return null;
    const tmp = document.createElement('canvas');
    const size = await renderEditedColorPreviewToCanvas(sourceIndex, edit, tmp);
    if (!size || generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      tmp.width = 0;
      tmp.height = 0;
      return null;
    }
    const thumbUrl = makeThumbnailUrl(
      tmp,
      MOBILE_PERFORMANCE_MODE ? 160 : 520,
      MOBILE_PERFORMANCE_MODE ? 220 : 720,
    );
    const pd = await ensurePageMeta(sourceIndex);
    if (!pd || generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      tmp.width = 0;
      tmp.height = 0;
      return null;
    }
    state.pages[sourceIndex] = { ...(pd || {}), editedThumbUrl: thumbUrl };
    touchMobileThumbnailCache(sourceIndex);
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
    if (!size || token !== editedPreviewRenderToken || sourceIndex !== currentSourceIndex() || activeTool !== 'edit' ||
        (isMobileEditLayout() && !mobileEditFocused)) {
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

  async function renderEditedPageImageToCanvas(
    sourceIndex,
    edit,
    canvas,
    exportDpi = fineRotationExportDpi(),
    pixelBudget = MOBILE_RASTER_EXPORT_MAX_PIXELS,
  ) {
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    const pd = state.pages[sourceIndex];
    const baseVp = page.getViewport({ scale: 1 });
    const e = clonePageEdit(edit);
    const requestedScale = hasFineRotation(edit)
      ? Math.max(pd?.scale || 0, exportDpi / 72)
      : (pd?.scale || getRenderScale(baseVp));
    let baseScale = requestedScale;
    if (MOBILE_PERFORMANCE_MODE) {
      const cropBaseW = baseVp.width * Math.max(0.01, (100 - e.crop.left - e.crop.right) / 100);
      const cropBaseH = baseVp.height * Math.max(0.01, (100 - e.crop.top - e.crop.bottom) / 100);
      const angle = editAngle(e) * Math.PI / 180;
      const cos = Math.abs(Math.cos(angle));
      const sin = Math.abs(Math.sin(angle));
      const outputAreaAtScaleOne = (cropBaseW * cos + cropBaseH * sin) * (cropBaseW * sin + cropBaseH * cos);
      const outputWidthAtScaleOne = cropBaseW * cos + cropBaseH * sin;
      const outputHeightAtScaleOne = cropBaseW * sin + cropBaseH * cos;
      const workingAreaAtScaleOne = (baseVp.width * baseVp.height) + outputAreaAtScaleOne;
      const peakSideAtScaleOne = Math.max(baseVp.width, baseVp.height, outputWidthAtScaleOne, outputHeightAtScaleOne);
      baseScale = Math.min(
        requestedScale,
        Math.sqrt(pixelBudget / Math.max(1, workingAreaAtScaleOne)),
        MOBILE_CANVAS_MAX_SIDE / Math.max(1, peakSideAtScaleOne),
      );
    }
    const vp = page.getViewport({ scale: baseScale });
    const base = document.createElement('canvas');
    base.width = Math.max(1, Math.floor(vp.width));
    base.height = Math.max(1, Math.floor(vp.height));
    const bctx = base.getContext('2d');
    bctx.fillStyle = '#fff';
    bctx.fillRect(0, 0, base.width, base.height);
    const rendered = await runPdfPageRender(page, { canvasContext: bctx, viewport: vp });
    if (!rendered) {
      base.width = 0;
      base.height = 0;
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }

    const cropLeft = Math.round(base.width * e.crop.left / 100);
    const cropTop = Math.round(base.height * e.crop.top / 100);
    const cropRight = Math.round(base.width * e.crop.right / 100);
    const cropBottom = Math.round(base.height * e.crop.bottom / 100);
    const cropW = Math.max(1, base.width - cropLeft - cropRight);
    const cropH = Math.max(1, base.height - cropTop - cropBottom);
    const crop = MOBILE_PERFORMANCE_MODE ? null : document.createElement('canvas');
    if (crop) {
      crop.width = cropW;
      crop.height = cropH;
      const cctx = crop.getContext('2d');
      cctx.fillStyle = '#fff';
      cctx.fillRect(0, 0, cropW, cropH);
      cctx.drawImage(base, cropLeft, cropTop, cropW, cropH, 0, 0, cropW, cropH);
    }
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
    if (crop) ctx.drawImage(crop, -cropW / 2, -cropH / 2);
    else ctx.drawImage(base, cropLeft, cropTop, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
    base.width = 0;
    base.height = 0;
    if (crop) { crop.width = 0; crop.height = 0; }
    if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
    return { wPt: outW / baseScale, hPt: outH / baseScale };
  }

  const organizerDrag = {
    active: false,
    sourceOutputIndex: null,
    sourcePageIndex: null,
    sourceFlowIndex: null,
    insertIndex: null,
    targetInsertIndex: null,
    clone: null,
    offsetX: 0,
    offsetY: 0,
    pointerX: 0,
    pointerY: 0,
    spatialX: 0,
    spatialY: 0,
    candidateOriginX: 0,
    candidateOriginY: 0,
    pointerHistory: [],
    autoScrollFrame: null,
    pointerMoveFrame: null,
  };
  const organizerTapState = {
    sourceIndex: null,
    outputIndex: null,
    time: 0,
    x: 0,
    y: 0,
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
    const previous = capturePageStructure(state);
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
    pageHistory.record(previous, state);
  }

  function captureOrganizerRects() {
    const rects = new Map();
    if (!organizerGrid) return rects;
    const viewport = previewStage.getBoundingClientRect();
    organizerGrid.querySelectorAll('.page-card[data-source-index], .page-placeholder, .page-split-divider').forEach(el => {
      const key = el.classList.contains('page-placeholder')
        ? '__placeholder__'
        : el.classList.contains('page-split-divider')
          ? '__split_' + el.dataset.splitIndex
        : el.dataset.sourceIndex;
      const rect = el.getBoundingClientRect();
      if (!MOBILE_PERFORMANCE_MODE || (rect.bottom >= viewport.top && rect.top <= viewport.bottom)) rects.set(key, rect);
    });
    return rects;
  }

  function animateOrganizerFrom(firstRects, opts = {}) {
    if (prefersReducedMotion() || !firstRects?.size || !organizerGrid) return;
    const baseDuration = opts.duration ?? 200;
    organizerGrid.querySelectorAll('.page-card[data-source-index], .page-placeholder, .page-split-divider').forEach(el => {
      if (opts.skipPlaceholder && el.classList.contains('page-placeholder')) return;
      const key = el.classList.contains('page-placeholder') ? '__placeholder__'
        : el.classList.contains('page-split-divider') ? '__split_' + el.dataset.splitIndex : el.dataset.sourceIndex;
      const first = firstRects.get(key);
      if (!first) return;
      const last = el.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      const duration = Math.min(opts.maxDuration ?? baseDuration, baseDuration + Math.hypot(dx, dy) * (opts.distanceDuration ?? 0));
      el._organizerMove = el.animate([
        { transform: 'translate(' + dx + 'px, ' + dy + 'px)' },
        { transform: 'translate(0, 0)' },
      ], { duration, easing: opts.easing || 'cubic-bezier(.2, .8, .2, 1)' });
    });
  }

  function rerenderOrganizerAnimated(opts) {
    const firstRects = captureOrganizerRects();
    renderOrganizer();
    animateOrganizerFrom(firstRects, opts);
  }

  function rerenderOrganizerDuringDrag() {
    rerenderOrganizerAnimated({
      duration: 220,
      maxDuration: 380,
      distanceDuration: 0.24,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      skipPlaceholder: true,
    });
  }

  function renderOrganizer() {
    if (!organizerGrid || activeTool !== 'organize') return;
    if (thumbnailObserver) {
      thumbnailObserver.disconnect();
      thumbnailObserver = null;
    }
    if (organizerGrid._pdfDoc !== state.pdfDoc) {
      organizerGrid.replaceChildren();
      organizerGrid._pdfDoc = state.pdfDoc;
    }
    const existingCards = new Map(Array.from(organizerGrid.querySelectorAll('.page-card[data-source-index]'), card => [Number(card.dataset.sourceIndex), card]));
    for (const card of organizerGrid.children) card._organizerMove?.cancel();
    const nextChildren = [];
    const count = activePageCount();
    organizerEmpty.classList.toggle('on', !state.pdfDoc || count === 0);
    organizerEmpty.textContent = state.pdfDoc
      ? t('empty.organizeRemoved')
      : t('empty.organize');
    if (!state.pdfDoc || count === 0) { organizerGrid.replaceChildren(); return; }

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
        const placeholder = organizerDrag.touchAnchor || document.createElement('div');
        if (!organizerDrag.touchAnchor) {
          placeholder.className = 'page-card page-placeholder';
          const marker = document.createElement('div');
          marker.className = 'page-insert-marker';
          placeholder.appendChild(marker);
        }
        nextChildren.push(placeholder);
      }
      if (slot === visibleFlow.length) break;
      const item = visibleFlow[slot];
      if (item.type === 'split') {
        nextChildren.push(appendSplitDivider(item.splitIndex, slot));
        continue;
      }
      const sourceIndex = item.sourceIndex;
      const outputIndex = state.pageOrder.indexOf(sourceIndex);
      const reused = existingCards.get(sourceIndex);
      const card = reused || document.createElement('div');
      card.className = 'page-card organizer-flow-item';
      card.dataset.flowIndex = slot;
      card.dataset.outputIndex = outputIndex;
      card.dataset.sourceIndex = sourceIndex;

      if (!reused) card.appendChild(createPageThumb(sourceIndex, 'Original page ' + (sourceIndex + 1)));
      else {
        card.querySelector('.page-card-actions')?.remove();
        getThumbnailObserver()?.observe(card.querySelector('[data-thumb-source]'));
      }

      const actions = document.createElement('div');
      actions.className = 'page-card-actions';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'page-delete';
      del.setAttribute('aria-label', 'Delete original page ' + (sourceIndex + 1));
      del.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="m6 6 8 8M14 6l-8 8"/></svg>';
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
      split.innerHTML = '<svg class="page-split-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M4 7V3.5h12V7M4 13v3.5h12V13M2 10h2m3 0h2m3 0h2m3 0h1"/></svg>';
      const splitLabel = document.createElement('span');
      splitLabel.className = 'page-split-text';
      splitLabel.textContent = t('split.button');
      split.appendChild(splitLabel);
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

      if (!reused) {
        card.addEventListener('pointerdown', e => beginOrganizerDrag(e, card, sourceIndex));
        card.addEventListener('touchstart', e => prepareOrganizerTouch(e, card, sourceIndex), { passive: true });
      }
      nextChildren.push(card);
    }
    const retained = new Set(nextChildren);
    for (const child of Array.from(organizerGrid.children)) if (!retained.has(child)) child.remove();
    nextChildren.forEach((child, index) => {
      if (organizerGrid.children[index] !== child) organizerGrid.insertBefore(child, organizerGrid.children[index] || null);
    });
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
    return divider;
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

  function showPageContextMenuAt(x, y, outputIndex, sourceIndex) {
    if (!state.pdfDoc || activeTool !== 'organize' || organizerDrag.active) return;
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
    positionPageContextMenu(x, y);
  }

  function showPageContextMenu(e, outputIndex, sourceIndex) {
    if (!state.pdfDoc || activeTool !== 'organize' || organizerDrag.active) return;
    e.preventDefault();
    e.stopPropagation();
    showPageContextMenuAt(e.clientX, e.clientY, outputIndex, sourceIndex);
  }

  organizerGrid.addEventListener('contextmenu', e => {
    const card = e.target.closest('.page-card[data-source-index]');
    if (!card || !organizerGrid.contains(card)) return;
    showPageContextMenu(e, Number(card.dataset.outputIndex), Number(card.dataset.sourceIndex));
  }, true);

  function toggleSplitAfter(outputIndex) {
    if (operationInProgress || !state.pdfDoc || typeof outputIndex !== 'number' || outputIndex < 0 || outputIndex >= activePageCount() - 1) return;
    normalizeSplitState();
    const previous = capturePageStructure(state);
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
    pageHistory.record(previous, state);
    updatePageState();
  }

  function removeSplit(splitIndex) {
    if (operationInProgress) return;
    normalizeSplitState();
    if (splitIndex < 0 || splitIndex >= state.splitPoints.length) return;
    const previous = capturePageStructure(state);
    state.splitPoints.splice(splitIndex, 1);
    state.splitNames.splice(splitIndex + 1, 1);
    pageHistory.record(previous, state);
    updatePageState();
  }

  function isOrganizerDoubleTap(e, outputIndex, sourceIndex) {
    if (e.pointerType === 'mouse') return false;
    const now = Date.now();
    return organizerTapState.sourceIndex === sourceIndex
      && organizerTapState.outputIndex === outputIndex
      && now - organizerTapState.time < 420
      && Math.abs(e.clientX - organizerTapState.x) < 36
      && Math.abs(e.clientY - organizerTapState.y) < 36;
  }

  function rememberOrganizerTap(e, outputIndex, sourceIndex) {
    if (e.pointerType === 'mouse') return;
    organizerTapState.sourceIndex = sourceIndex;
    organizerTapState.outputIndex = outputIndex;
    organizerTapState.time = Date.now();
    organizerTapState.x = e.clientX;
    organizerTapState.y = e.clientY;
  }

  function clearOrganizerTap() {
    organizerTapState.sourceIndex = null;
    organizerTapState.outputIndex = null;
    organizerTapState.time = 0;
    organizerTapState.x = 0;
    organizerTapState.y = 0;
  }

  let stopOrganizerTouch = null;

  // Register before a gesture starts so Safari can keep a held drag off its
  // native scrolling path. Ordinary swipes are left to the browser.
  document.addEventListener('touchmove', event => {
    if (organizerDrag.active && organizerDrag.touchAnchor && event.cancelable) event.preventDefault();
  }, { capture: true, passive: false });

  function prepareOrganizerTouch(event, card, sourceIndex) {
    if (event.touches.length !== 1 || event.target.closest('button') || operationInProgress || organizerDrag.active) return;
    stopOrganizerTouch?.();
    const start = event.touches[0];
    const startX = start.clientX;
    const startY = start.clientY;
    // Touch events keep their initial target even when the drag rebuilds the grid.
    const touchTarget = event.target;
    const pointer = touch => ({ clientX: touch.clientX, clientY: touch.clientY, pointerType: 'touch', target: card, preventDefault() {} });
    const timer = setTimeout(() => {
      if (!card.isConnected || activeTool !== 'organize') { stopOrganizerTouch?.(); return; }
      beginOrganizerDrag(pointer({ clientX: startX, clientY: startY }), card, sourceIndex, true);
    }, 400);
    const move = e => {
      if (e.touches.length !== 1) { cancel(); return; }
      const touch = e.touches[0];
      if (organizerDrag.active) {
        e.preventDefault();
        onOrganizerPointerMove(pointer(touch));
      } else if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 8) {
        stopOrganizerTouch?.();
      }
    };
    const end = e => {
      if (organizerDrag.active) {
        if (e.cancelable) e.preventDefault();
        finishOrganizerDrag(e.changedTouches[0]);
      }
      stopOrganizerTouch?.();
    };
    const cancel = () => {
      stopOrganizerTouch?.();
      cancelOrganizerDrag();
    };
    stopOrganizerTouch = () => {
      clearTimeout(timer);
      touchTarget.removeEventListener('touchmove', move);
      touchTarget.removeEventListener('touchend', end);
      touchTarget.removeEventListener('touchcancel', cancel);
      stopOrganizerTouch = null;
    };
    touchTarget.addEventListener('touchmove', move, { passive: false });
    touchTarget.addEventListener('touchend', end, { passive: false });
    touchTarget.addEventListener('touchcancel', cancel);
  }

  function beginOrganizerDrag(e, card, sourceIndex, touchHold = false) {
    if (e.pointerType === 'touch' && !touchHold) return;
    if (operationInProgress || !state.pdfDoc || organizerDrag.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('.page-delete, .page-split-toggle')) return;
    hidePageContextMenu();
    const outputIndex = state.pageOrder.indexOf(sourceIndex);
    if (outputIndex < 0) return;
    if (!touchHold && isOrganizerDoubleTap(e, outputIndex, sourceIndex)) {
      clearOrganizerTap();
      showPageContextMenuAt(e.clientX, e.clientY, outputIndex, sourceIndex);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    rememberOrganizerTap(e, outputIndex, sourceIndex);
    const sourceFlowIndex = buildOrganizerFlow().findIndex(item =>
      item.type === 'page' && item.sourceIndex === sourceIndex);
    const rect = card.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const clone = card.cloneNode(true);
    clone.classList.add('page-drag-clone');
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    // Place the clone before it can paint. Starting at translate3d(0, 0, 0)
    // makes the inherited page-card transform transition race in from the
    // viewport origin on the first pointer update.
    clone.style.transform = 'translate3d(' + rect.left + 'px, ' + rect.top + 'px, 0) scale(1.02)';
    clone.style.transformOrigin = offsetX + 'px ' + offsetY + 'px';
    clone.querySelectorAll('button').forEach(button => button.tabIndex = -1);
    document.body.appendChild(clone);

    organizerDrag.active = true;
    document.body.classList.add('organizer-dragging');
    if (touchHold) {
      // Keep the original touch target connected; only the floating copy moves
      // with the finger. The original card occupies the insertion slot.
      organizerDrag.touchAnchor = card;
      card.classList.add('organizer-touch-anchor', 'page-placeholder');
      card.classList.remove('organizer-flow-item');
    }
    organizerDrag.sourceOutputIndex = outputIndex;
    organizerDrag.sourcePageIndex = sourceIndex;
    organizerDrag.sourceFlowIndex = sourceFlowIndex;
    organizerDrag.insertIndex = sourceFlowIndex < 0 ? null : sourceFlowIndex;
    organizerDrag.targetInsertIndex = organizerDrag.insertIndex;
    organizerDrag.clone = clone;
    organizerDrag.offsetX = offsetX;
    organizerDrag.offsetY = offsetY;
    organizerDrag.pointerX = e.clientX;
    organizerDrag.pointerY = e.clientY;
    const spatialPoint = organizerSpatialPoint(e.clientX, e.clientY);
    organizerDrag.spatialX = spatialPoint.x;
    organizerDrag.spatialY = spatialPoint.y;
    organizerDrag.candidateOriginX = spatialPoint.x;
    organizerDrag.candidateOriginY = spatialPoint.y;
    organizerDrag.pointerHistory = [];
    recordOrganizerPointer(e.clientX, e.clientY);

    moveOrganizerClone(e.clientX, e.clientY);
    startOrganizerAutoScroll();
    if (!touchHold) {
      window.addEventListener('pointermove', onOrganizerPointerMove, { passive: false });
      window.addEventListener('pointerup', finishOrganizerDrag, { once: true });
      window.addEventListener('pointercancel', cancelOrganizerDrag, { once: true });
    }
    e.preventDefault();
    rerenderOrganizerDuringDrag();
  }

  function moveOrganizerClone(x, y) {
    if (!organizerDrag.clone) return;
    organizerDrag.clone.style.transform = 'translate3d(' +
      (x - organizerDrag.offsetX) + 'px, ' +
      (y - organizerDrag.offsetY) + 'px, 0) scale(1.02)';
  }

  function recordOrganizerPointer(x, y) {
    const time = performance.now();
    organizerDrag.pointerHistory.push({ x, y, time });
    while (organizerDrag.pointerHistory.length > 8
      || (organizerDrag.pointerHistory[0] && time - organizerDrag.pointerHistory[0].time > 120)) {
      organizerDrag.pointerHistory.shift();
    }
  }

  function organizerReleaseVelocity() {
    const history = organizerDrag.pointerHistory;
    if (history.length < 2) return { x: 0, y: 0 };
    const last = history[history.length - 1];
    const first = history[0];
    const seconds = (last.time - first.time) / 1000;
    if (seconds <= 0) return { x: 0, y: 0 };
    const clamp = value => Math.max(-2600, Math.min(2600, value));
    return {
      x: clamp((last.x - first.x) / seconds),
      y: clamp((last.y - first.y) / seconds),
    };
  }

  function organizerSpatialPoint(x, y) {
    return {
      x: x + (previewStage?.scrollLeft || 0),
      y: y + (previewStage?.scrollTop || 0),
    };
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

  function updateOrganizerInsertIndex(x, y) {
    if (!organizerDrag.active) return;
    const previousPoint = { x: organizerDrag.spatialX, y: organizerDrag.spatialY };
    const spatialPoint = organizerSpatialPoint(x, y);
    organizerDrag.spatialX = spatialPoint.x;
    organizerDrag.spatialY = spatialPoint.y;
    const nextIndex = getOrganizerInsertIndex(x, y);
    if (nextIndex === organizerDrag.insertIndex) {
      organizerDrag.targetInsertIndex = nextIndex;
      organizerDrag.candidateOriginX = spatialPoint.x;
      organizerDrag.candidateOriginY = spatialPoint.y;
      return;
    }
    if (nextIndex !== organizerDrag.targetInsertIndex) {
      organizerDrag.targetInsertIndex = nextIndex;
      organizerDrag.candidateOriginX = previousPoint.x;
      organizerDrag.candidateOriginY = previousPoint.y;
    }
    const distanceIntoCandidate = Math.hypot(
      spatialPoint.x - organizerDrag.candidateOriginX,
      spatialPoint.y - organizerDrag.candidateOriginY,
    );
    if (distanceIntoCandidate < 12) return;
    organizerDrag.insertIndex = organizerDrag.targetInsertIndex;
    organizerDrag.candidateOriginX = spatialPoint.x;
    organizerDrag.candidateOriginY = spatialPoint.y;
    rerenderOrganizerDuringDrag();
  }

  function organizerAutoScrollDelta(pointerY) {
    const rect = previewStage.getBoundingClientRect();
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, window.innerHeight || document.documentElement.clientHeight || rect.bottom);
    const visibleHeight = Math.max(1, visibleBottom - visibleTop);
    const edge = Math.min(130, Math.max(72, visibleHeight * 0.18));
    const maxStep = 9;
    if (pointerY < visibleTop + edge && previewStage.scrollTop > 0) {
      const pressure = (visibleTop + edge - pointerY) / edge;
      return -Math.max(1, Math.round(maxStep * pressure * pressure));
    }
    const maxTop = Math.max(0, previewStage.scrollHeight - previewStage.clientHeight);
    if (pointerY > visibleBottom - edge && previewStage.scrollTop < maxTop) {
      const pressure = (pointerY - (visibleBottom - edge)) / edge;
      return Math.max(1, Math.round(maxStep * pressure * pressure));
    }
    return 0;
  }

  function runOrganizerAutoScroll() {
    if (!organizerDrag.active) {
      organizerDrag.autoScrollFrame = null;
      return;
    }
    const delta = organizerAutoScrollDelta(organizerDrag.pointerY);
    if (delta) {
      const before = previewStage.scrollTop;
      previewStage.scrollTop += delta;
      if (previewStage.scrollTop !== before) {
        updateOrganizerInsertIndex(organizerDrag.pointerX, organizerDrag.pointerY);
      }
    }
    organizerDrag.autoScrollFrame = requestAnimationFrame(runOrganizerAutoScroll);
  }

  function startOrganizerAutoScroll() {
    if (organizerDrag.autoScrollFrame) return;
    organizerDrag.autoScrollFrame = requestAnimationFrame(runOrganizerAutoScroll);
  }

  function stopOrganizerAutoScroll() {
    if (!organizerDrag.autoScrollFrame) return;
    cancelAnimationFrame(organizerDrag.autoScrollFrame);
    organizerDrag.autoScrollFrame = null;
  }

  function onOrganizerPointerMove(e) {
    if (!organizerDrag.active) return;
    e.preventDefault();
    organizerDrag.pointerX = e.clientX;
    organizerDrag.pointerY = e.clientY;
    recordOrganizerPointer(e.clientX, e.clientY);
    moveOrganizerClone(e.clientX, e.clientY);
    if (MOBILE_PERFORMANCE_MODE) {
      if (organizerDrag.pointerMoveFrame) return;
      organizerDrag.pointerMoveFrame = requestAnimationFrame(() => {
        organizerDrag.pointerMoveFrame = null;
        updateOrganizerInsertIndex(organizerDrag.pointerX, organizerDrag.pointerY);
      });
    } else {
      updateOrganizerInsertIndex(e.clientX, e.clientY);
    }
  }

  function cleanupOrganizerDrag({ preserveClone = false } = {}) {
    document.body.classList.remove('organizer-dragging');
    if (organizerDrag.touchAnchor) {
      organizerDrag.touchAnchor.classList.remove('organizer-touch-anchor', 'page-placeholder');
      organizerDrag.touchAnchor.classList.add('organizer-flow-item');
      organizerDrag.touchAnchor = null;
    }
    stopOrganizerTouch?.();
    window.removeEventListener('pointermove', onOrganizerPointerMove);
    window.removeEventListener('pointerup', finishOrganizerDrag);
    window.removeEventListener('pointercancel', cancelOrganizerDrag);
    stopOrganizerAutoScroll();
    if (organizerDrag.pointerMoveFrame) cancelAnimationFrame(organizerDrag.pointerMoveFrame);
    organizerDrag.pointerMoveFrame = null;
    if (organizerDrag.clone && !preserveClone) organizerDrag.clone.remove();
    organizerDrag.active = false;
    organizerDrag.sourceOutputIndex = null;
    organizerDrag.sourcePageIndex = null;
    organizerDrag.sourceFlowIndex = null;
    organizerDrag.insertIndex = null;
    organizerDrag.targetInsertIndex = null;
    organizerDrag.clone = null;
    organizerDrag.pointerX = 0;
    organizerDrag.pointerY = 0;
    organizerDrag.spatialX = 0;
    organizerDrag.spatialY = 0;
    organizerDrag.candidateOriginX = 0;
    organizerDrag.candidateOriginY = 0;
    organizerDrag.pointerHistory = [];
  }

  function settleOrganizerClone(clone, destination, start, velocity) {
    if (!clone) return;
    if (!destination || prefersReducedMotion()) {
      clone.remove();
      if (destination) destination.style.visibility = '';
      return;
    }
    const target = destination.getBoundingClientRect();
    destination.style.visibility = 'hidden';
    let x = start.x;
    let y = start.y;
    let scale = 1.02;
    let velocityX = velocity.x;
    let velocityY = velocity.y;
    let scaleVelocity = 0;
    let previousTime = performance.now();
    const startTime = previousTime;
    const stiffness = 360;
    const damping = 38;

    const finish = () => {
      // A viewport update may have rebuilt the grid during the spring.
      const current = organizerGrid.querySelector('[data-source-index="' + clone.dataset.sourceIndex + '"]');
      if (current) current.style.visibility = '';
      clone.remove();
    };

    const step = now => {
      const dt = Math.min(0.032, Math.max(0.001, (now - previousTime) / 1000));
      previousTime = now;
      velocityX += (stiffness * (target.left - x) - damping * velocityX) * dt;
      velocityY += (stiffness * (target.top - y) - damping * velocityY) * dt;
      scaleVelocity += (stiffness * (1 - scale) - damping * scaleVelocity) * dt;
      x += velocityX * dt;
      y += velocityY * dt;
      scale += scaleVelocity * dt;
      clone.style.transform = 'translate3d(' + x + 'px, ' + y + 'px, 0) scale(' + scale + ')';

      const settled = Math.abs(target.left - x) < 0.5
        && Math.abs(target.top - y) < 0.5
        && Math.abs(velocityX) < 8
        && Math.abs(velocityY) < 8
        && Math.abs(scale - 1) < 0.002;
      if (settled || now - startTime > 650) {
        finish();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function finishOrganizerDrag(e) {
    if (!organizerDrag.active) return;
    if (e?.clientX != null && e?.clientY != null) {
      if (organizerDrag.pointerMoveFrame) cancelAnimationFrame(organizerDrag.pointerMoveFrame);
      organizerDrag.pointerMoveFrame = null;
      organizerDrag.pointerX = e.clientX;
      organizerDrag.pointerY = e.clientY;
      recordOrganizerPointer(e.clientX, e.clientY);
      updateOrganizerInsertIndex(e.clientX, e.clientY);
    }
    const firstRects = captureOrganizerRects();
    const sourceIndex = organizerDrag.sourcePageIndex;
    const targetInsertIndex = organizerDrag.insertIndex;
    const clone = organizerDrag.clone;
    const cloneStart = {
      x: organizerDrag.pointerX - organizerDrag.offsetX,
      y: organizerDrag.pointerY - organizerDrag.offsetY,
    };
    const releaseVelocity = organizerReleaseVelocity();
    const nextFlow = buildOrganizerFlow().filter(item =>
      item.type !== 'page' || item.sourceIndex !== sourceIndex);
    const insertionIndex = targetInsertIndex == null
      ? Math.max(0, Math.min(organizerDrag.sourceFlowIndex ?? 0, nextFlow.length))
      : Math.max(0, Math.min(targetInsertIndex, nextFlow.length));
    cleanupOrganizerDrag({ preserveClone: true });
    nextFlow.splice(insertionIndex, 0, { type: 'page', sourceIndex });
    applyOrganizerFlow(nextFlow);
    state.curPage = state.pageOrder.indexOf(sourceIndex) + 1;
    updatePageState();
    animateOrganizerFrom(firstRects);
    const destination = organizerGrid?.querySelector('[data-source-index="' + sourceIndex + '"]');
    settleOrganizerClone(clone, destination, cloneStart, releaseVelocity);
    if (activeTool !== 'organize') requestPreviewRender(isRasterTool(activeTool));
  }

  function cancelOrganizerDrag() {
    if (!organizerDrag.active) return;
    const firstRects = captureOrganizerRects();
    const sourceIndex = organizerDrag.sourcePageIndex;
    const clone = organizerDrag.clone;
    const start = { x: organizerDrag.pointerX - organizerDrag.offsetX, y: organizerDrag.pointerY - organizerDrag.offsetY };
    cleanupOrganizerDrag({ preserveClone: true });
    renderOrganizer();
    animateOrganizerFrom(firstRects);
    settleOrganizerClone(clone, organizerGrid.querySelector('[data-source-index="' + sourceIndex + '"]'), start, { x: 0, y: 0 });
  }

  function deleteOutputPage(outputIndex) {
    if (operationInProgress || !state.pdfDoc || outputIndex < 0 || outputIndex >= activePageCount()) return;
    hidePageContextMenu();
    const sourceIndex = state.pageOrder[outputIndex];
    if (MOBILE_PERFORMANCE_MODE && state.pages[sourceIndex]) {
      state.pages[sourceIndex].lum = null;
      state.pages[sourceIndex].histo = null;
      state.pages[sourceIndex].renderKey = null;
      state.pages[sourceIndex].thumbUrl = null;
      state.pages[sourceIndex].thumbQuality = null;
      state.pages[sourceIndex].editedThumbUrl = null;
      state.fullPageCacheOrder = state.fullPageCacheOrder.filter(index => index !== sourceIndex);
      mobileThumbnailCacheOrder = mobileThumbnailCacheOrder.filter(index => index !== sourceIndex);
    }
    const nextFlow = buildOrganizerFlow().filter(item =>
      item.type !== 'page' || item.sourceIndex !== sourceIndex);
    applyOrganizerFlow(nextFlow);
    if (state.curPage > activePageCount()) state.curPage = Math.max(1, activePageCount());
    updatePageState();
    if (activeTool !== 'organize') requestPreviewRender(isRasterTool(activeTool));
  }

  function canReuseOriginalPdf(pageOrder, context) {
    return MOBILE_PERFORMANCE_MODE
      && hasOriginalPdfSource()
      && context?.toolId !== 'compress'
      && !context?.advanced?.password
      && pageOrder.length === state.numPages
      && pageOrder.every((sourceIndex, index) => sourceIndex === index);
  }

  async function createPageOrderPdfArtifact(pageOrder, fileBase, context) {
    if (!pageOrder.length) throw new Error(t('errors.noPagesExport'));
    if (canReuseOriginalPdf(pageOrder, context)) {
      const meta = {
        source: 'original',
        rasterized: false,
        preservesOriginalQuality: true,
      };
      return createOriginalSourceArtifact(fileBase, meta);
    }
    const pdfLib = await ensurePdfLib();
    const src = await pdfLib.PDFDocument.load(await readOriginalPdfBytes());
    const out = await pdfLib.PDFDocument.create();
    const copiedPages = await out.copyPages(src, pageOrder);
    for (const page of copiedPages) {
      out.addPage(page);
      if (MOBILE_PERFORMANCE_MODE) await yieldToMainThread();
    }
    const bytes = await out.save();
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
    if (!pageOrder.length) throw new Error(t('errors.noPagesExport'));
    if (canReuseOriginalPdf(pageOrder, context) && pageOrder.every(sourceIndex => !isPageEdited(context.settings.pageEdits[sourceIndex]))) {
      const meta = {
        source: 'original',
        rasterized: false,
        preservesOriginalQuality: true,
      };
      return createOriginalSourceArtifact(fileBase, meta);
    }
    const pdfLib = await ensurePdfLib();
    const src = await pdfLib.PDFDocument.load(await readOriginalPdfBytes());
    const out = await pdfLib.PDFDocument.create();
    let rasterized = false;
    const count = pageOrder.length;
    const mobileRasterCanvas = MOBILE_PERFORMANCE_MODE ? document.createElement('canvas') : null;
    const mobileRasterPageCount = MOBILE_PERFORMANCE_MODE
      ? pageOrder.reduce((total, sourceIndex) => total + (hasFineRotation(context.settings.pageEdits[sourceIndex]) ? 1 : 0), 0)
      : 0;
    const mobileRasterPixelBudget = getMobileExportPagePixelBudget(mobileRasterPageCount || 1);
    for (let i = 0; i < count; i++) {
      const progress = currentPageProgress(i, count);
      setLoader(true, t('progress.exportingEditedPage', { page: i + 1, count }), progress);
      const sourceIndex = pageOrder[i];
      const edit = clonePageEdit(context.settings.pageEdits[sourceIndex]);
      if (hasFineRotation(edit)) {
        setLoader(true, t('progress.rasterizingFineRotation', { dpi: context.settings.fineRotationDpi, page: i + 1, count }), progress);
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
      const canvas = mobileRasterCanvas || document.createElement('canvas');
      try {
        const size = await renderEditedPageImageToCanvas(
          sourceIndex,
          edit,
          canvas,
          context.settings.fineRotationDpi,
          mobileRasterPixelBudget,
        );
        if (!size) throw new Error(t('errors.renderPageFailed', { page: i + 1 }));
        const image = MOBILE_PERFORMANCE_MODE
          ? await out.embedJpg(await canvasToImageInput(canvas, 'image/jpeg', getMobileGreyscaleJpegQuality(mobileRasterPageCount)))
          : await out.embedPng(await canvasToImageInput(canvas, 'image/png'));
        const page = out.addPage([size.wPt, size.hPt]);
        page.drawImage(image, { x: 0, y: 0, width: size.wPt, height: size.hPt });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
      await yieldToMainThread();
    }
    const bytes = await out.save();
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
    if (!pageOrder.length) throw new Error(t('errors.noPagesExport'));
    if (!context.settings.signatureStamps.length) throw new Error(t('errors.noSignature'));
    const includedPages = new Set(pageOrder);
    const exportStamps = context.settings.signatureStamps.filter(stamp => includedPages.has(stamp.pageIndex));
    if (!exportStamps.length) {
      throw new Error(t('errors.signaturePageMissing'));
    }

    const src = await pdfLib.PDFDocument.load(await readOriginalPdfBytes());
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

    const bytes = await out.save();
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
    if (operationInProgress) return;
    const part = splitParts()[partIndex];
    if (!part || !part.pageOrder.length) return;
    if (advancedPasswordToggle.checked && canPasswordProtectExport('split') && !advancedPasswordValue()) {
      showError(t('errors.password'));
      advancedPasswordInput.focus();
      return;
    }
    operationInProgress = true;
    beginPdfLoad();
    downloadBtn.disabled = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
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
      operationInProgress = false;
      updatePageState();
    }
  }

  async function renderMobileProcessedPageToCanvas(sourceIndex, canvas, settings, pixelBudget) {
    const generation = state.renderGeneration;
    const pdfDoc = state.pdfDoc;
    const page = await pdfDoc.getPage(sourceIndex + 1);
    const baseVp = page.getViewport({ scale: 1 });
    const scale = getRenderScale(baseVp, settings.resolution, pixelBudget);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rendered = await runPdfPageRender(page, { canvasContext: ctx, viewport });
    if (!rendered || generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();
      return null;
    }

    let image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;
    const rowStride = canvas.width * 4;
    const rowsPerChunk = 128;
    const rasterTool = settings.processTool;
    const threshold = settings.threshold;
    const thresholdInverted = settings.invert;
    const brightness = settings.brightness * 1.28;
    const contrast = settings.contrast / 100;
    const greyInverted = settings.greyInvert;
    const sepia = settings.sepia;
    for (let startY = 0; startY < canvas.height; startY += rowsPerChunk) {
      const end = Math.min(data.length, (startY + rowsPerChunk) * rowStride);
      if (rasterTool === 'threshold') {
        for (let i = startY * rowStride; i < end; i += 4) {
          const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) | 0;
          const value = (thresholdInverted ? lum >= threshold : lum < threshold) ? 0 : 255;
          data[i] = value;
          data[i + 1] = value;
          data[i + 2] = value;
          data[i + 3] = 255;
        }
      } else {
        for (let i = startY * rowStride; i < end; i += 4) {
          let value = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) | 0;
          value = Math.max(0, Math.min(255, (value - 128) * contrast + 128 + brightness)) | 0;
          if (greyInverted) value = 255 - value;
          data[i] = sepia ? Math.min(255, (value * 1.12) | 0) : value;
          data[i + 1] = value;
          data[i + 2] = sepia ? Math.max(0, (value * 0.72) | 0) : value;
          data[i + 3] = 255;
        }
      }
      if (startY + rowsPerChunk < canvas.height) await yieldToMainThread();
    }
    ctx.putImageData(image, 0, 0);
    image = null;
    page.cleanup?.();
    return { w: canvas.width, h: canvas.height, scale, wPt: baseVp.width, hPt: baseVp.height };
  }

  async function createRasterProcessedPdfArtifact(context) {
    const { jsPDF } = await ensureJsPdf();
    const tmp = document.createElement('canvas');
    let pdf = null;
    const count = context.pageOrder.length;
    if (!count) throw new Error(t('errors.noPagesExport'));
    const mobilePixelBudget = getMobileExportPagePixelBudget(count);
    const mobileGreyscaleJpeg = MOBILE_PERFORMANCE_MODE && context.settings.processTool === 'greyscale';
    const mobileGreyscaleQuality = getMobileGreyscaleJpegQuality(count);
    for (let i = 0; i < count; i++) {
      setLoader(true, t('progress.exportingPage', { page: i + 1, count }), currentPageProgress(i, count));
      const sourceIndex = context.pageOrder[i];
      const pageSettings = {
        ...context.settings,
        ...effectiveRasterSettings(context.settings.processTool, sourceIndex, context.settings),
      };
      let wPt;
      let hPt;
      if (MOBILE_PERFORMANCE_MODE) {
        const size = await renderMobileProcessedPageToCanvas(
          sourceIndex,
          tmp,
          pageSettings,
          mobilePixelBudget,
        );
        if (!size) throw new Error(t('errors.renderPageFailed', { page: i + 1 }));
        wPt = size.wPt;
        hPt = size.hPt;
      } else {
        const pd = await ensurePageData(sourceIndex);
        if (!pd) throw new Error(t('errors.renderPageFailed', { page: i + 1 }));
        if (context.settings.processTool === 'threshold') applyThresholdToCanvas(pd, tmp, pageSettings);
        else applyGreyscaleToCanvas(pd, tmp, pageSettings);
        wPt = pd.w / pd.scale;
        hPt = pd.h / pd.scale;
      }
      const orient = wPt > hPt ? 'l' : 'p';
      let imageInput = await canvasToImageInput(
        tmp,
        mobileGreyscaleJpeg ? 'image/jpeg' : 'image/png',
        mobileGreyscaleJpeg ? mobileGreyscaleQuality : undefined,
      );
      if (i === 0) {
        pdf = new jsPDF({
          orientation: orient,
          unit: 'pt',
          format: [wPt, hPt],
        });
      } else {
        pdf.addPage([wPt, hPt], orient);
      }
      pdf.addImage(imageInput, mobileGreyscaleJpeg ? 'JPEG' : 'PNG', 0, 0, wPt, hPt, undefined, 'FAST');
      imageInput = null;
      tmp.width = 0;
      tmp.height = 0;
      await yieldToMainThread();
    }
    return createJsPdfOutputArtifact(pdf, context.fileBase, {
      source: 'jsPDF',
      rasterized: true,
      preservesOriginalQuality: false,
    });
  }

  async function renderCompressedPageToCanvas(sourceIndex, preset, canvas, pixelBudget) {
    const generation = state.renderGeneration;
    const pdfDoc = state.pdfDoc;
    const page = await state.pdfDoc.getPage(sourceIndex + 1);
    const baseVp = page.getViewport({ scale: 1 });
    const requestedScale = (preset.dpi || 144) / 72;
    let cappedScale = Math.min(requestedScale, (preset.maxDimension || 2400) / Math.max(baseVp.width, baseVp.height));
    if (MOBILE_PERFORMANCE_MODE) {
      cappedScale = capScaleToPixelBudget(baseVp, cappedScale, pixelBudget);
    }
    const scale = MOBILE_PERFORMANCE_MODE ? cappedScale : Math.max(0.5, cappedScale);
    const vp = page.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const rendered = await runPdfPageRender(page, { canvasContext: ctx, viewport: vp });
    if (!rendered || generation !== state.renderGeneration || pdfDoc !== state.pdfDoc) {
      canvas.width = 0;
      canvas.height = 0;
      if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
      return null;
    }
    if (MOBILE_PERFORMANCE_MODE) page.cleanup?.();
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
    const mobilePixelBudget = getMobileExportPagePixelBudget(count);
    for (let i = 0; i < count; i++) {
      setLoader(true, t('progress.compressingPage', { page: i + 1, count }), currentPageProgress(i, count));
      const size = await renderCompressedPageToCanvas(context.pageOrder[i], preset, tmp, mobilePixelBudget);
      if (!size) throw new Error(t('errors.renderPageFailed', { page: i + 1 }));
      const orient = size.wPt > size.hPt ? 'l' : 'p';
      let imageInput = await canvasToImageInput(tmp, 'image/jpeg', preset.jpegQuality);
      if (i === 0) {
        pdf = new jsPDF({
          orientation: orient,
          unit: 'pt',
          format: [size.wPt, size.hPt],
          compress: true,
        });
      } else {
        pdf.addPage([size.wPt, size.hPt], orient);
      }
      pdf.addImage(imageInput, 'JPEG', 0, 0, size.wPt, size.hPt, undefined, 'FAST');
      imageInput = null;
      tmp.width = 0;
      tmp.height = 0;
      await yieldToMainThread();
    }
    return createJsPdfOutputArtifact(pdf, context.fileBase, {
      source: 'jsPDF',
      compressionMode: context.settings.compressMode,
      rasterized: true,
      preservesOriginalQuality: false,
    });
  }

  async function createCompressedPdfArtifact(context) {
    const preset = COMPRESSION_PRESETS[context.settings.compressMode] || COMPRESSION_PRESETS.original;
    if (!preset.rasterize) {
      const artifact = await createPageOrderPdfArtifact(context.pageOrder, context.fileBase, context);
      return clonePdfArtifact(artifact, {
        meta: {
          ...artifact.meta,
          compressionMode: context.settings.compressMode,
        },
      });
    }
    return createRasterCompressedPdfArtifact(context, preset);
  }

  // ── Threshold controls ──
  function setRasterScope(tool, scope) {
    if (operationInProgress || (scope === 'page' && !state.pdfDoc)) return;
    state.rasterScopes[tool] = scope;
    syncRasterControls();
    if (state.pdfDoc && activeTool === tool) requestPreviewRender(false);
  }

  function copyCurrentRasterSettingsToAll(tool) {
    if (operationInProgress || !state.pdfDoc) return;
    const sourceIndex = currentSourceIndex();
    const settings = effectiveRasterSettings(tool, sourceIndex);
    Object.assign(state, settings);
    Object.keys(state.rasterPageSettings).forEach(key => {
      delete state.rasterPageSettings[key][tool];
      if (!state.rasterPageSettings[key].threshold && !state.rasterPageSettings[key].greyscale) {
        delete state.rasterPageSettings[key];
      }
    });
    state.rasterScopes[tool] = 'all';
    syncRasterControls();
    if (activeTool === tool) requestPreviewRender(false);
  }

  thresholdScopeAll.addEventListener('click', () => setRasterScope('threshold', 'all'));
  thresholdScopePage.addEventListener('click', () => setRasterScope('threshold', 'page'));
  greyscaleScopeAll.addEventListener('click', () => setRasterScope('greyscale', 'all'));
  greyscaleScopePage.addEventListener('click', () => setRasterScope('greyscale', 'page'));
  thresholdCopyToAll.addEventListener('click', () => copyCurrentRasterSettingsToAll('threshold'));
  greyscaleCopyToAll.addEventListener('click', () => copyCurrentRasterSettingsToAll('greyscale'));

  function setThresholdValue(value, render = true) {
    if (operationInProgress && render) return;
    const v = Math.max(0, Math.min(255, Math.round(+value || 0)));
    editableRasterSettings('threshold').threshold = v;
    threshSlider.value = String(v);
    threshNum.textContent = v;
    threshPct.textContent = Math.round((v / 255) * 100) + '%';
    threshHint.textContent = threshHintText(v);
    threshNeedle.style.left = ((v / 255) * 100) + '%';
    syncRasterScopeUI();
    if (render && state.pdfDoc) requestPreviewRender(false);
  }

  threshSlider.addEventListener('input', e => setThresholdValue(e.target.value));
  thresholdResetBtn.addEventListener('click', () => setThresholdValue(128));
  invertToggle.addEventListener('click', () => {
    if (operationInProgress) return;
    const settings = editableRasterSettings('threshold');
    settings.invert = !settings.invert;
    setTogglePressed(invertToggle, settings.invert);
    syncRasterScopeUI();
    if (state.pdfDoc) requestPreviewRender(false);
  });

  // ── Greyscale controls ──
  function setBrightnessValue(value, render = true) {
    if (operationInProgress && render) return;
    const v = Math.max(-100, Math.min(100, Math.round(+value || 0)));
    const settings = editableRasterSettings('greyscale');
    settings.brightness = v;
    brightSlider.value = String(v);
    brightNum.textContent = v > 0 ? '+' + v : String(v);
    brightTag.textContent = brightnessHintText(v);
    $('greyHint').textContent = greyHintText(settings);
    syncRasterScopeUI();
    if (render && state.pdfDoc) requestPreviewRender(false);
  }

  function setContrastValue(value, render = true) {
    if (operationInProgress && render) return;
    const v = Math.max(50, Math.min(200, Math.round(+value || 0)));
    const settings = editableRasterSettings('greyscale');
    settings.contrast = v;
    contrastSlider.value = String(v);
    contrastNum.textContent = v;
    contrastTag.textContent = contrastHintText(v);
    $('greyHint').textContent = greyHintText(settings);
    syncRasterScopeUI();
    if (render && state.pdfDoc) requestPreviewRender(false);
  }

  brightSlider.addEventListener('input', e => setBrightnessValue(e.target.value));
  brightnessResetBtn.addEventListener('click', () => setBrightnessValue(0));
  contrastSlider.addEventListener('input', e => setContrastValue(e.target.value));
  contrastResetBtn.addEventListener('click', () => setContrastValue(100));
  greyInvertToggle.addEventListener('click', () => {
    if (operationInProgress) return;
    const settings = editableRasterSettings('greyscale');
    settings.greyInvert = !settings.greyInvert;
    setTogglePressed(greyInvertToggle, settings.greyInvert);
    $('greyHint').textContent = greyHintText(settings);
    syncRasterScopeUI();
    if (state.pdfDoc) requestPreviewRender(false);
  });
  sepiaToggle.addEventListener('click', () => {
    if (operationInProgress) return;
    const settings = editableRasterSettings('greyscale');
    settings.sepia = !settings.sepia;
    setTogglePressed(sepiaToggle, settings.sepia);
    $('greyHint').textContent = greyHintText(settings);
    syncRasterScopeUI();
    if (state.pdfDoc) requestPreviewRender(false);
  });

  compressOriginal.addEventListener('click', () => setCompressMode('original'));
  compressBalanced.addEventListener('click', () => setCompressMode('balanced'));
  compressSmall.addEventListener('click', () => setCompressMode('small'));

  function setFineRotation(value) {
    if (operationInProgress) return;
    if (!state.pdfDoc) return;
    const edit = currentPageEdit();
    edit.fineRotation = Math.round((+value || 0) * 10) / 10;
    syncEditControls();
    requestEditedPreviewRender();
    requestEditedThumbnailRender();
  }

  function rotateSelectedPage90(delta) {
    if (operationInProgress) return;
    if (!state.pdfDoc) return;
    const edit = currentPageEdit();
    edit.quarterTurns = (edit.quarterTurns + delta + 4) % 4;
    syncEditControls();
    renderPageEditor();
    requestEditedPreviewRender();
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
    if (operationInProgress) return;
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
  $('mobileSignUse').addEventListener('click', placeMobileSignature);
  $('mobileSignSmaller').addEventListener('click', () => resizeMobileSignature(0.88));
  $('mobileSignLarger').addEventListener('click', () => resizeMobileSignature(1.12));
  $('mobileSignDelete').addEventListener('click', deleteSelectedSignatureStamp);
  signatureDragSource.addEventListener('pointerdown', beginSignatureDragFromSource);
  signatureOverlay.addEventListener('pointerdown', beginSignatureOverlayDrag);

  function toggleFineRotationQuality() {
    if (operationInProgress) return;
    state.fineRotationQuality = state.fineRotationQuality === 'ultra' ? 'high' : 'ultra';
    syncFineQualityToggle();
  }

  function resetSelectedPageEdit() {
    if (operationInProgress) return;
    const sourceIndex = currentSourceIndex();
    if (sourceIndex == null) return;
    state.pageEdits[sourceIndex] = defaultPageEdit();
    if (MOBILE_PERFORMANCE_MODE && state.pages[sourceIndex]) {
      state.pages[sourceIndex].editedThumbUrl = null;
    }
    syncEditControls();
    renderPageEditor();
    requestEditedPreviewRender();
    requestEditedThumbnailRender(sourceIndex);
  }

  fineQualityToggle.addEventListener('click', toggleFineRotationQuality);
  mobileEditQualityBtn.addEventListener('click', toggleFineRotationQuality);
  resetEditBtn.addEventListener('click', resetSelectedPageEdit);
  mobileEditResetBtn.addEventListener('click', resetSelectedPageEdit);
  mobileEditCloseBtn.addEventListener('click', e => closeMobilePageEditor({ restoreFocus: e.detail === 0 }));

  contextSplitBtn.addEventListener('click', () => {
    const outputIndex = contextMenuState.outputIndex;
    hidePageContextMenu();
    toggleSplitAfter(outputIndex);
  });

  clearSplitBtn.addEventListener('click', () => {
    if (operationInProgress) return;
    const previous = capturePageStructure(state);
    state.splitPoints = [];
    state.splitNames = [];
    pageHistory.record(previous, state);
    updatePageState();
  });

  document.addEventListener('click', e => {
    if (!pageContextMenu.hidden && !pageContextMenu.contains(e.target)) hidePageContextMenu();
  });

  document.addEventListener('keydown', e => {
    const editingText = e.target.closest?.('input, textarea, [contenteditable="true"]');
    if (!editingText && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z' && activeTool === 'organize') {
      e.preventDefault();
      undoPageChange();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && activeTool === 'sign' && !editingText) {
      if (deleteSelectedSignatureStamp()) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Escape' && mobileControlsOpen) {
      e.preventDefault();
      setMobileControlsOpen(false, { restoreFocus: true, instant: true });
      return;
    }
    if (e.key === 'Escape' && mobileEditFocused) {
      e.preventDefault();
      closeMobilePageEditor();
      return;
    }
    if (e.key === 'Escape') hidePageContextMenu();
  });

  window.addEventListener('scroll', hidePageContextMenu, true);

  undoPagesBtn.addEventListener('click', undoPageChange);

  resetPagesBtn.addEventListener('click', () => {
    if (operationInProgress || !state.pdfDoc) return;
    hidePageContextMenu();
    const previous = capturePageStructure(state);
    state.pageOrder = Array.from({ length: state.numPages }, (_, i) => i);
    state.curPage = 1;
    pageHistory.record(previous, state);
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
      if (operationInProgress) return;
      if (state.resolution === key) return;
      if (key === '900' && !window.confirm(t('resolution.900Warning'))) {
        syncResolutionToggles();
        return;
      }
      state.resolution = key;
      syncResolutionToggles();
      if (!state.pdfDoc) return;
      resetRenderCaches({ preserveThumbnailCache: true });
      forgetFullPageData();
      const sourceIndex = currentSourceIndex();
      const label = key === 'fast'
        ? t('progress.renderingPage', { page: state.curPage, count: activePageCount() })
        : t('progress.renderingAtDpi', { dpi: key, page: state.curPage, count: activePageCount() });
      setLoader(true, label, 35);
      if (isRasterTool(activeTool)) {
        await ensureRasterPreviewData(sourceIndex);
      } else if (activeTool === 'edit') {
        await ensurePageData(sourceIndex);
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
  const pageCounter = $('pageCounter');
  const pageJumpInput = $('pageJumpInput');
  let pageJumpDocument = null;
  let lastPageCounterTap = null;
  function beginPageJump() {
    if (operationInProgress || !state.pdfDoc || !activePageCount() || !pageJumpInput.hidden) return;
    pageJumpDocument = state.pdfDoc;
    pageJumpInput.value = String(state.curPage);
    pageJumpInput.style.width = Math.max(2, String(activePageCount()).length) + 'ch';
    curPageEl.hidden = true;
    pageJumpInput.hidden = false;
    pageJumpInput.focus();
    pageJumpInput.select();
  }
  function finishPageJump(commit) {
    if (pageJumpInput.hidden) return;
    const raw = pageJumpInput.value.trim();
    const target = /^\d+$/.test(raw) ? Math.max(1, Math.min(activePageCount(), Number(raw))) : null;
    const canJump = commit && target && !operationInProgress && state.pdfDoc === pageJumpDocument;
    pageJumpInput.hidden = true;
    curPageEl.hidden = false;
    pageJumpInput.blur();
    pageJumpDocument = null;
    if (!canJump) return;
    if (MOBILE_PERFORMANCE_MODE && isRasterTool(activeTool)) {
      resetRenderCaches({ preserveThumbnailCache: true });
      forgetFullPageData();
    }
    state.curPage = target;
    updatePageButtons();
    if (activeTool === 'edit') { syncEditControls(); requestEditedPreviewRender(); }
    else if (activeTool === 'organize') organizerGrid.querySelector('[data-source-index="' + currentSourceIndex() + '"]')?.scrollIntoView({ block: 'center' });
    else requestPreviewRender(isRasterTool(activeTool));
  }
  pageCounter.addEventListener('dblclick', beginPageJump);
  pageCounter.addEventListener('pointerup', e => {
    if (e.pointerType !== 'touch' || !pageJumpInput.hidden) return;
    const now = performance.now();
    if (lastPageCounterTap && now - lastPageCounterTap.time < 350 && Math.hypot(e.clientX - lastPageCounterTap.x, e.clientY - lastPageCounterTap.y) < 24) {
      lastPageCounterTap = null;
      beginPageJump();
    } else lastPageCounterTap = { time: now, x: e.clientX, y: e.clientY };
  });
  pageCounter.addEventListener('keydown', e => {
    if (e.target !== pageCounter || !['Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    beginPageJump();
  });
  pageJumpInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      finishPageJump(e.key === 'Enter');
      pageCounter.focus({ preventScroll: true });
    }
  });
  pageJumpInput.addEventListener('blur', () => finishPageJump(true));
  prevBtn.addEventListener('click', () => {
    if (operationInProgress) return;
    if (state.curPage > 1) {
      if (MOBILE_PERFORMANCE_MODE && isRasterTool(activeTool)) {
        resetRenderCaches({ preserveThumbnailCache: true });
        forgetFullPageData();
      }
      state.curPage--;
      updatePageButtons();
      if (activeTool === 'edit') { syncEditControls(); requestEditedPreviewRender(); }
      else requestPreviewRender(isRasterTool(activeTool));
    }
  });
  nextBtn.addEventListener('click', () => {
    if (operationInProgress) return;
    if (state.curPage < activePageCount()) {
      if (MOBILE_PERFORMANCE_MODE && isRasterTool(activeTool)) {
        resetRenderCaches({ preserveThumbnailCache: true });
        forgetFullPageData();
      }
      state.curPage++;
      updatePageButtons();
      if (activeTool === 'edit') { syncEditControls(); requestEditedPreviewRender(); }
      else requestPreviewRender(isRasterTool(activeTool));
    }
  });

  // ── Download ──
  downloadBtn.addEventListener('click', async () => {
    if (operationInProgress) return;
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
    operationInProgress = true;
    beginPdfLoad();
    downloadBtn.disabled = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
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
      operationInProgress = false;
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
  const panState = { active: false, pointerId: null, x: 0, y: 0, scrollLeft: 0, scrollTop: 0 };

  function syncPreviewStageHeight() {
    if (previewHeightRaf) cancelAnimationFrame(previewHeightRaf);
    previewHeightRaf = requestAnimationFrame(() => {
      previewHeightRaf = null;
      // Phone layout is sized by the viewport grid, including the live browser bars.
      if (isPhoneViewport()) {
        if (state.pdfDoc) applyZoom();
        return;
      }
      const isTablet = window.matchMedia('(max-width: 900px)').matches;
      const minHeight = isTablet ? 520 : 620;
      const maxHeight = isTablet ? 820 : 1100;
      const rawViewportHeight = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
      const mainPanel = previewStage.closest('main');
      const stageRect = previewStage.getBoundingClientRect();
      const mainRect = mainPanel ? mainPanel.getBoundingClientRect() : null;
      const panelStyle = getComputedStyle(previewStage.parentElement);
      const panelBottomInset = parseFloat(panelStyle.paddingBottom) || 0;
      const panelBottom = mainRect ? Math.max(0, mainRect.bottom - stageRect.top - panelBottomInset) : 0;
      const preferredHeight = Math.max(rawViewportHeight * 0.82, panelBottom);
      const targetHeight = Math.max(minHeight, Math.min(maxHeight, preferredHeight));
      const roundedHeight = Math.round(targetHeight);
      previewStage.style.setProperty('--preview-stage-height', roundedHeight + 'px');
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
    const captionHeight = isPhoneViewport() && !previewStage.classList.contains('zoomed') ? 24 : 0;
    const stageH = Math.max(1, previewStage.clientHeight - pad.y - captionHeight - 1);
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
    const siblings = [...pageEditorMain.children].filter(element =>
      element !== pageEditorCanvasWrap && getComputedStyle(element).display !== 'none');
    const bottomH = siblings.reduce((height, element) => height + element.offsetHeight, 0);
    const gap = parseFloat(cs.gap) || 0;
    const viewW = Math.max(1, pageEditorMain.clientWidth - padX - 1);
    const viewH = Math.max(1, pageEditorMain.clientHeight - padY - bottomH - gap * siblings.length - 1);
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
    requestAnimationFrame(positionDocumentName);
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
    if (isPhoneViewport()) {
      setZoom(1, { preserveCenter: false });
      return;
    }
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
      input.remove();
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
  let mobileResizeFrame = null;
  window.addEventListener('resize', () => {
    const updateLayout = () => {
      mobileResizeFrame = null;
      const wasMobileEditor = document.body.classList.contains('mobile-edit-tool');
      syncMobileEditMode();
      if (activeTool === 'edit' && wasMobileEditor !== isMobileEditLayout()) {
        renderPageEditor();
        syncEditControls();
        if (!isMobileEditLayout()) requestEditedPreviewRender();
      }
      syncMobileDockLayout();
      syncMobilePreviewWorkspace();
      previewTools.classList.toggle('preview-tools-hidden', !isPhoneViewport() && (activeTool === 'organize' || activeTool === 'edit'));
      previewTools.querySelector('.zoom-bar').hidden = isPhoneViewport() && (activeTool === 'organize' || activeTool === 'edit');
      syncPreviewStageHeight();
      updateToolIndicator();
      updateSignatureOverlay();
    };
    if (!MOBILE_PERFORMANCE_MODE) {
      updateLayout();
      return;
    }
    if (mobileResizeFrame) return;
    mobileResizeFrame = requestAnimationFrame(updateLayout);
  });
  document.querySelector('.tool-nav').addEventListener('scroll', updateToolIndicator);

  // Browser chrome, rotation, and dock changes can resize the canvas without a window resize.
  const workspaceResizeObserver = new ResizeObserver(() => {
    if (isPhoneViewport()) syncPreviewStageHeight();
  });

  zoomValEl.addEventListener('keydown', e => {
    if (e.target !== zoomValEl || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    zoomValEl.click();
  });
  workspaceResizeObserver.observe(previewStage);
  workspaceResizeObserver.observe(pageEditorMain);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncPreviewStageHeight);
  }
  currentLocale = readSavedLocale();
  applyStaticLocale();
  applyToolLocale();
  setDarkMode(readSavedTheme() === 'dark');
  syncPreviewStageHeight();
  syncToolTabA11y();
  updateSourceDropMode();
  resolutionOptions.classList.toggle('hidden', !isRasterTool(activeTool));
  actionsDock.style.display = activeTool === 'preview' ? 'none' : '';
  syncBottomDockState();
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
