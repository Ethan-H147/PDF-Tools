# PDF Atelier

PDF Atelier is a privacy-first, browser-based PDF workstation for everyday PDF cleanup and export work. It is designed to feel lighter and cleaner than large online PDF tools while keeping files on your own device.

Files are processed locally in the browser. They are not uploaded to a server.

## Features

- Preview PDFs with page navigation, zoom, and high-quality progressive rendering
- Organize pages by reordering, deleting, and splitting PDFs into named parts
- Merge multiple PDFs and send the result into the organizer
- Crop and rotate pages, including fine rotation when needed
- Compress PDFs with original-quality, balanced, and small-size modes
- Convert pages to black and white or grayscale with Fast, 300 dpi, 600 dpi, and warned 900 dpi render options
- Export with page ranges, current-page-only export, and password protection
- Switch between light and dark mode
- Use the interface in English, Simplified Chinese, Traditional Chinese, Korean, Japanese, Spanish, and French

## Quality and Privacy

PDF Atelier tries to preserve original PDF quality whenever possible. Organize, split, merge, crop-only, and 90-degree rotation exports keep PDF page content intact where practical. Tools that alter pixels, such as threshold, grayscale, small-size compression, and fine rotation, may rasterize pages because those operations change the rendered page image.

Because processing happens in the browser, performance depends on the device and the PDF. Very large files can still be slow or memory-heavy, especially on phones and tablets. The 900 dpi raster option is intentionally guarded by a warning because it can make exports very large and significantly increase render/export time.

## Using It Locally

This is a static app. Open `index.html` in a browser, or publish the folder with any static host.

For the best browser compatibility, serve it over HTTPS when publishing. Some browser APIs and CDN-loaded dependencies behave more predictably on a normal web origin than from a local file URL.

## Third-party Libraries

PDF Atelier uses third-party browser libraries including:

- PDF.js
- pdf-lib
- jsPDF

Those libraries remain under their own licenses. See their upstream projects for details.

## License

PDF Atelier is licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).

You may use, study, modify, and share this project. If you modify it and make it available over a network, you must also provide the corresponding source code under the same license.

The source code is licensed under AGPL-3.0-or-later. The project name, logo, and branding are not licensed for reuse without permission.
