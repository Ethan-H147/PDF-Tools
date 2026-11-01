import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Ship classic scripts so a local index.html works without module CORS rules.
await build({
  entryPoints: ['app.js'], outfile: 'app.bundle.js', bundle: true,
  format: 'iife', target: 'es2022', legalComments: 'inline',
  define: { 'import.meta.url': 'document.baseURI' },
});
await build({
  entryPoints: ['vendor/pdfjs-6.3.289/legacy/build/pdf.worker.min.mjs'],
  outfile: 'vendor/pdfjs-6.3.289/legacy/build/pdf.worker.local.js',
  bundle: true, format: 'iife', globalName: 'pdfjsWorker',
  target: 'es2022', minify: true, legalComments: 'inline',
  define: { 'import.meta.url': 'document.baseURI' },
});

// Give the service worker a new cache name whenever the app files change.
const hash = createHash('sha256');
for (const file of ['index.html', 'styles.css', 'app.bundle.js', 'manifest.webmanifest']) hash.update(readFileSync(file));
const sw = readFileSync('sw.js', 'utf8');
const versioned = sw.replace(/const VERSION = '[^']*';/, "const VERSION = '" + hash.digest('hex').slice(0, 12) + "';");
if (versioned !== sw) writeFileSync('sw.js', versioned);
