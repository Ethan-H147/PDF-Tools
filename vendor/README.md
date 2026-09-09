# Bundled PDF libraries

These browser assets are served from the same origin as the application. They are copied from the pinned npm releases below, without running package install scripts. Package SHA-512 integrity was verified before extraction. Keep the upstream license files with the distributions.

| Package | Version | npm archive integrity |
| --- | --- | --- |
| `pdfjs-dist` | `6.3.289` | `sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==` |
| `@cantoo/pdf-lib` | `2.9.2` | `sha512-Oy8F4aB5Ts/eFkF6s7JdfvgTwoSU8sJZwpmLPuG1JZilTGiFGiFBR90rmJXSeKfvN2QzX/gRR8pYyf4gXP9vHg==` |

PDF.js uses its legacy browser build and matching worker, with evaluation disabled at document load. Its CMaps, standard fonts, image decoders, and color profiles are included for local loading. The sandbox used for executing PDF JavaScript is not loaded by the application.

`npm run build` bundles the renderer into `app.bundle.js` and generates `pdf.worker.local.js` from the matching upstream worker. These classic scripts support opening `index.html` directly without changing browser security settings. HTTP(S) pages continue using the original module worker off the main thread.

The Cantoo fork of pdf-lib provides PDF parsing, editing, and AES-256 revision 6 encryption. Every password-protected export passes through the same encryption step, including raster exports and mobile Blob outputs. There is no fallback to RC4 or an unencrypted download on failure.

To update, download the new versioned archives from the npm registry, verify their published integrity, and replace the matching version directories and application URLs together. Run the browser tests, especially the independent PDF.js password/decryption checks, before publishing.

Upstream sources:

- https://github.com/mozilla/pdf.js
- https://github.com/cantoo-scribe/pdf-lib
