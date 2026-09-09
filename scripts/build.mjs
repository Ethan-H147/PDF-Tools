import { build } from 'esbuild';

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
