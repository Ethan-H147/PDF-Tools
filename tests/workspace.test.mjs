import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));

function fixture(count = 3) {
  const kids = Array.from({ length: count }, (_, index) => `${3 + index * 2} 0 R`).join(' ');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${count} >>`];
  for (let index = 0; index < count; index++) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + count * 2} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`);
    const content = `BT /F1 24 Tf 50 680 Td (Document page ${index + 1}) Tj ET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(pdf);
}

test('opening index.html directly initializes controls and renders a PDF', { timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(new URL('../index.html', import.meta.url).href);
    await page.locator('#tab-organize').click();
    await page.waitForFunction(() => document.querySelector('#tab-organize').getAttribute('aria-selected') === 'true', null, { timeout: 5000 });
    await page.locator('#fileInput').setInputFiles({ name: 'Local document.pdf', mimeType: 'application/pdf', buffer: fixture() });
    await page.waitForFunction(() => Number(document.querySelector('#totPage').textContent) === 3 && !document.querySelector('#loader').classList.contains('on'));
    assert.equal(await page.locator('#errBox').innerText(), '', 'Local PDF load failed');
    assert.equal(Number(await page.locator('#totPage').textContent()), 3);
    assert.equal(await page.locator('#mobileDocumentName').textContent(), 'Local document.pdf');
    await page.locator('[data-source-index="0"] .page-delete').click();
    assert.equal(Number(await page.locator('#totPage').textContent()), 2);
    await page.locator('#undoPagesBtn').click();
    assert.equal(Number(await page.locator('#totPage').textContent()), 3);
    await page.locator('#tab-preview').click();
    await page.waitForFunction(() => document.querySelector('#previewCanvas').width > 0 && !document.querySelector('#loader').classList.contains('on'));
    await page.locator('#tab-organize').click();
    await page.locator('#mobileControlsToggle').click();
    await page.locator('#advancedToggle').click();
    await page.locator('#advancedPasswordToggle').check();
    await page.locator('#advancedPasswordInput').fill('Local protected export');
    await page.locator('#mobileControlsClose').click();
    const protectedBytes = await downloadBytes(page);
    assert.match(protectedBytes.toString('latin1'), /\/AESV3/);
    assert.match(protectedBytes.toString('latin1'), /\/R\s+6\b/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

async function downloadBytes(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#downloadBtn').click();
  const download = await pending;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function inspectPdf(page, bytes, password) {
  return page.evaluate(async ({ bytes, password }) => {
    const pdfjs = await import('/vendor/pdfjs-6.3.289/legacy/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs-6.3.289/legacy/build/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({
      data: new Uint8Array(bytes), password, isEvalSupported: false,
      standardFontDataUrl: location.origin + '/vendor/pdfjs-6.3.289/standard_fonts/',
      wasmUrl: location.origin + '/vendor/pdfjs-6.3.289/wasm/',
    });
    try {
      const document = await task.promise;
      const first = await document.getPage(1);
      const text = await first.getTextContent();
      const canvas = window.document.createElement('canvas');
      const viewport = first.getViewport({ scale: .25 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await first.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return { pages: document.numPages, text: text.items.map(item => item.str).join(' '), version: pdfjs.version };
    } catch (error) {
      return { error: error.name, code: error.code };
    } finally {
      await task.destroy();
    }
  }, { bytes: Array.from(bytes), password });
}

test('secure PDF exports and mobile document controls', { timeout: 180000 }, async t => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root)) throw new Error('Outside test root');
      const bytes = await readFile(file);
      const type = /\.m?js$/.test(file) ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': type });
      response.end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const openPdf = async (name = 'Review document.pdf') => {
      await page.locator('#fileInput').setInputFiles({ name, mimeType: 'application/pdf', buffer: fixture() });
      await page.waitForFunction(() => document.querySelector('#fileStatus').textContent.toLowerCase().startsWith('ready') && !document.querySelector('#loader').classList.contains('on'));
    };
    const selectTool = async tool => {
      await page.waitForFunction(() => !document.querySelector('#loader').classList.contains('on'));
      await page.locator('#tab-' + tool).click();
    };
    const pageCount = async () => Number(await page.locator('#totPage').textContent());

    await t.test('patched engine loads locally and the filename follows the document', async () => {
      await openPdf();
      assert.equal(await page.locator('#mobileDocumentName').textContent(), 'Review document.pdf');
      for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size);
        await page.waitForTimeout(200);
        const layout = await page.evaluate(() => {
          const name = document.querySelector('#mobileDocumentName').getBoundingClientRect();
          const canvas = document.querySelector('#previewCanvas').getBoundingClientRect();
          const stage = document.querySelector('#previewStage').getBoundingClientRect();
          return { nameX: name.left, nameBottom: name.bottom, canvasX: canvas.left, canvasY: canvas.top, canvasBottom: canvas.bottom, stageBottom: stage.bottom, scroll: document.documentElement.scrollHeight };
        });
        assert(Math.abs(layout.nameX - layout.canvasX) < 2, 'Filename not aligned with document');
        assert(layout.nameBottom <= layout.canvasY, 'Filename overlaps document');
        assert(layout.canvasBottom <= layout.stageBottom + 1, 'Document clipped');
        assert(layout.scroll <= size.height + 1, 'Outer page scroll');
      }
      assert(!requests.some(url => /https:.*(?:pdf\.js|pdf-lib)/.test(url)), 'PDF engine fetched from a third-party CDN');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('#zoomIn').click();
      await page.waitForTimeout(200);
      const zoomedName = await page.locator('#mobileDocumentName').boundingBox();
      const zoomedPage = await page.locator('#previewCanvas').boundingBox();
      assert(zoomedName.y + zoomedName.height <= zoomedPage.y, 'Filename overlaps zoomed page');
      await page.locator('#zoomVal').click();
      await page.locator('#mobileControlsToggle').click();
      await page.locator('#fileName').click();
      const name = 'Quarterly review with a very long document filename.pdf';
      await page.locator('#fileName input').fill(name);
      await page.locator('#fileName input').press('Enter');
      await page.locator('#mobileControlsClose').click();
      assert.equal(await page.locator('#mobileDocumentName').textContent(), name);
    });

    await t.test('undo restores deletions, splits, original-order reset, and selection', async () => {
      await selectTool('organize');
      assert(await page.locator('#undoPagesBtn').isDisabled());
      await page.locator('#nextPage').click();
      await page.locator('[data-source-index="1"] .page-delete').click();
      assert.equal(await pageCount(), 2);
      await page.locator('#undoPagesBtn').click();
      assert.equal(await pageCount(), 3);
      assert.equal(await page.locator('#curPage').textContent(), '02');
      await page.locator('[data-source-index="0"]').click({ button: 'right' });
      await page.locator('#contextSplitBtn').click();
      assert.equal(await page.locator('.page-split-divider').count(), 1);
      await page.locator('#mobileControlsToggle').click();
      await page.locator('#splitPartsList input').first().fill('Named section');
      await page.locator('#mobileControlsClose').click();
      await page.locator('[data-source-index="0"] .page-delete').click();
      await page.locator('#undoPagesBtn').click();
      assert.equal(await page.locator('.page-split-divider').count(), 1);
      assert.equal(await page.locator('#splitPartsList input').first().inputValue(), 'Named section');
      await page.keyboard.press('Control+z');
      assert.equal(await page.locator('.page-split-divider').count(), 0);
      await page.locator('[data-source-index="2"] .page-delete').click();
      await page.locator('#mobileControlsToggle').click();
      await page.locator('#resetPagesBtn').click();
      await page.locator('#mobileControlsClose').click();
      assert.equal(await pageCount(), 3);
      await page.locator('#undoPagesBtn').click();
      assert.equal(await pageCount(), 2);
      await page.locator('#undoPagesBtn').click();
      assert.equal(await pageCount(), 3);
      const order = () => page.locator('#organizerGrid > [data-source-index]').evaluateAll(cards => cards.map(card => card.dataset.sourceIndex));
      const beforeDrag = await order();
      const first = await page.locator('#organizerGrid > [data-source-index="0"]').boundingBox();
      const last = await page.locator('#organizerGrid > [data-source-index="2"]').boundingBox();
      await page.mouse.move(first.x + first.width / 2, first.y + first.height / 3);
      await page.mouse.down();
      await page.mouse.move(last.x + last.width - 4, last.y + last.height / 3, { steps: 20 });
      await page.waitForTimeout(150);
      await page.mouse.up();
      assert.notDeepEqual(await order(), beforeDrag, 'Pointer drag did not reorder pages');
      await page.locator('#undoPagesBtn').click();
      assert.deepEqual(await order(), beforeDrag, 'Undo did not restore dragged page order');
      await openPdf('Replacement.pdf');
      assert(await page.locator('#undoPagesBtn').isDisabled(), 'History leaked into replacement file');
      assert.equal(await page.locator('#mobileDocumentName').textContent(), 'Replacement.pdf');
    });

    await t.test('AES-256 protects original mobile Blobs, vector output, and raster output', async () => {
      const password = '  café-test-秘密-2026  ';
      const protect = async () => {
        await page.locator('#mobileControlsToggle').click();
        if (await page.locator('#advancedToggle').getAttribute('aria-expanded') === 'false') await page.locator('#advancedToggle').click();
        await page.locator('#advancedPasswordToggle').check();
        await page.locator('#advancedPasswordInput').fill(password);
        await page.locator('#mobileControlsClose').click();
      };
      const verify = async (bytes, pages, text) => {
        const source = bytes.toString('latin1');
        assert.match(source, /\/AESV3\b/, 'AES-256 cipher missing');
        assert.match(source, /\/R\s+6\b/, 'Revision 6 security handler missing');
        const missing = await inspectPdf(page, bytes);
        const wrong = await inspectPdf(page, bytes, 'wrong-password');
        assert.equal(missing.error, 'PasswordException');
        assert.equal(wrong.error, 'PasswordException');
        const opened = await inspectPdf(page, bytes, password);
        assert.equal(opened.version, '6.3.289');
        assert.equal(opened.pages, pages);
        if (text) assert(opened.text.includes(text), 'Selectable text lost from vector output');
      };
      await protect();
      await verify(await downloadBytes(page), 3, 'Document page 1');
      await page.locator('[data-source-index="0"] .page-delete').click();
      await verify(await downloadBytes(page), 2, 'Document page 2');
      await selectTool('threshold');
      await page.locator('#mobileControlsToggle').click();
      await page.locator('#resFast').click();
      await page.locator('#mobileControlsClose').click();
      await verify(await downloadBytes(page), 2);
    });

    await t.test('encryption failure never falls back to an unprotected download', async () => {
      const blocked = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      try {
        await blocked.route('**/vendor/pdf-lib-2.9.2/**', route => route.abort());
        await blocked.goto(page.url());
        await blocked.locator('#fileInput').setInputFiles({ name: 'Blocked encryption.pdf', mimeType: 'application/pdf', buffer: fixture() });
        await blocked.waitForFunction(() => document.querySelector('#fileStatus').textContent.toLowerCase().startsWith('ready') && !document.querySelector('#loader').classList.contains('on'));
        await blocked.locator('#tab-organize').click();
        await blocked.locator('#mobileControlsToggle').click();
        await blocked.locator('#advancedToggle').click();
        await blocked.locator('#advancedPasswordToggle').check();
        await blocked.locator('#advancedPasswordInput').fill('Protection required');
        await blocked.locator('#mobileControlsClose').click();
        let downloads = 0;
        blocked.on('download', () => downloads++);
        await blocked.locator('#downloadBtn').click();
        await blocked.locator('#errBox.on').waitFor();
        await blocked.waitForFunction(() => !document.querySelector('#loader').classList.contains('on'));
        assert.equal(downloads, 0);
        assert(await blocked.locator('#advancedPasswordToggle').isChecked());
      } finally { await blocked.close(); }
    });

    await t.test('mobile organizer sharpens visible pages and exposes split beside centered delete', async () => {
      const mobile = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
      try {
        await mobile.goto(page.url());
        await mobile.locator('#fileInput').setInputFiles({ name: 'Many pages.pdf', mimeType: 'application/pdf', buffer: fixture(24) });
        await mobile.waitForFunction(() => Number(document.querySelector('#totPage').textContent) === 24 && !document.querySelector('#loader').classList.contains('on'));
        await mobile.locator('#tab-organize').click();
        const waitForSharp = index => mobile.waitForFunction(async index => {
          const element = document.querySelector(`[data-thumb-source="${index}"]`);
          const url = element?.style.backgroundImage.slice(5, -2);
          if (!url) return false;
          const image = new Image();
          image.src = url;
          await image.decode();
          return image.naturalWidth > 300;
        }, index);
        await waitForSharp(0);
        assert.equal(await mobile.locator('[data-thumb-source="23"]').evaluate(el => el.style.backgroundImage), '');
        const card = mobile.locator('.page-card[data-source-index="0"]');
        const alignment = await card.evaluate(el => {
          const button = el.querySelector('.page-delete').getBoundingClientRect();
          const icon = el.querySelector('.page-delete svg').getBoundingClientRect();
          return { x: Math.abs(button.x + button.width / 2 - icon.x - icon.width / 2), y: Math.abs(button.y + button.height / 2 - icon.y - icon.height / 2), overflow: el.scrollWidth > el.clientWidth };
        });
        assert(alignment.x < 1 && alignment.y < 1);
        assert.equal(alignment.overflow, false);
        await card.locator('.page-split-toggle').click();
        assert.equal(await mobile.locator('.page-split-divider').count(), 1);
        await mobile.locator('#undoPagesBtn').click();
        assert.equal(await mobile.locator('.page-split-divider').count(), 0);
        await mobile.locator('[data-source-index="23"]').scrollIntoViewIfNeeded();
        await waitForSharp(23);
        assert(await mobile.locator('[data-source-index="23"] .page-split-toggle').isDisabled());
      } finally { await mobile.close(); }
    });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
