# PDF Tools

A small browser-based PDF toolkit for the basic jobs I don't want to open a heavy PDF app for.

It currently supports:

- previewing PDFs with zoom and page navigation
- merging multiple PDFs
- reordering, deleting, and splitting pages
- cropping and rotating individual pages
- threshold / black-and-white conversion
- grayscale conversion

Everything runs in the browser. Files are not uploaded anywhere.

## Notes and limitations

This is meant to cover everyday PDF cleanup, not replace Acrobat. Some operations preserve the original PDF pages, while others have to rasterize the page:

- merge, organize, split, crop-only, and 90-degree rotation try to preserve the original PDF content
- threshold and grayscale rasterize pages because they change the pixels
- fine rotation by small degrees also rasterizes the edited page

Large PDFs can still be demanding, especially on phones and tablets. The app uses lazy rendering and lower-resolution previews for big files, but exporting a huge document at high DPI may still be extremely slow or fail if the browser runs out of memory.
