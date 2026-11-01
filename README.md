# PDF Atelier

PDF Atelier is a privacy-first, browser-based PDF workstation for everyday PDF cleanup and export work. It is designed to feel lighter and cleaner than large online PDF tools while keeping files on your own device.

Files are processed locally in the browser. They are not uploaded to a server.

## Features

- Preview PDFs with page navigation, zoom, and high-quality progressive rendering
- Organize pages by reordering, deleting, and splitting PDFs into named parts
- Undo page deletion, reordering, split changes, and restoring original order
- Merge multiple PDFs and send the result into the organizer
- Sign pages, and add text, page numbers, or a watermark
- Turn images into a PDF, or save PDF pages as PNG or JPEG images
- Crop and rotate pages, including fine rotation when needed
- Compress PDFs by shrinking embedded photos and scans while text and drawings stay sharp
- Convert pages to black and white or grayscale with Fast, 300 dpi, 600 dpi, and warned 900 dpi render options
- Export with page ranges, current-page-only export, and AES-256 password protection
- Switch between light and dark mode
- Install it to the home screen or desktop and use it offline
- Use the interface in English, Simplified Chinese, Traditional Chinese, Korean, Japanese, Spanish, and French

## Quality and Privacy

PDF Atelier tries to preserve original PDF quality whenever possible. Organize, split, merge, crop-only, and 90-degree rotation exports keep PDF page content intact where practical. Compression only re-encodes embedded images, so text, fonts, and vector drawings are copied unchanged. Tools that alter pixels, such as threshold, grayscale, and fine rotation, may rasterize pages because those operations change the rendered page image.

Because processing happens in the browser, performance depends on the device and the PDF. Very large files can still be slow or memory-heavy, especially on phones and tablets. The 900 dpi raster option is intentionally guarded by a warning because it can make exports very large and significantly increase render/export time.

## Using It Locally

Open `index.html` directly, or serve the folder with any static HTTP server. The checked-in `app.bundle.js` supports direct local-file loading; PDF.js uses a same-thread worker in this mode because browsers block module workers on `file://` origins.

Publish the `vendor` directory along with the application. The host must serve `.mjs` files as JavaScript and `.wasm` files as `application/wasm`.

After editing `app.js` or `page-history.mjs`, run `npm ci` once and `npm run build` to update the browser bundle. `npm test` rebuilds it and tests direct-file startup, mobile controls, undo, and protected exports.

For the best browser compatibility, serve it over HTTPS when publishing. When served, a service worker (`sw.js`) caches the app so it works offline after the first visit; `npm run build` stamps it with a new cache version whenever the app files change. Opening `index.html` from disk skips the service worker.

## Third-party Libraries

PDF Atelier uses third-party browser libraries including:

- PDF.js
- @cantoo/pdf-lib

Those libraries remain under their own licenses. See their upstream projects for details.

The PDF.js and pdf-lib versions, archive integrity values, and bundled licenses are recorded in [vendor/README.md](vendor/README.md).

## Development checks

Run `npm install`, then `npx playwright install chromium` and `npm test`. Tests cover structural undo, mobile filename placement, local PDF loading, and encrypted exports reopened with an independent PDF reader. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an already installed Chromium browser instead of downloading one.

## License

PDF Atelier is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).

You may use, study, modify, and share this project. If you modify it and make it available over a network, you must also provide the corresponding source code under the same license.

The source code is licensed under AGPL-3.0-or-later. The project name, logo, and branding are not licensed for reuse without permission.
