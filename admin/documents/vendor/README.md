# Local PDF runtime

pdfmake 0.2.20, MIT license (`LICENSE`). Files are copied unchanged from the
official npm package `pdfmake@0.2.20`, integrity:
`sha512-bGbxbGFP5p8PWNT3Phsu1ZcRLnRfF6jmnuKTkgmt6i5PZzSdX6JaB+NeTz9q+aocfW8SE9GUjL3o/5GroBqGcQ==`.
`vfs_fonts.js` embeds Roboto for offline Cyrillic PDF generation. The runtime
loads only on the documents screen when PDF output is requested; no customer
data is transmitted to a PDF service or CDN.

`NotoSansSC-Regular.otf` (SIL OFL, `NOTO-SC-LICENSE`) is the
[official Simplified Chinese subset](https://github.com/notofonts/noto-cjk/tree/main/Sans/SubsetOTF/SC).
It is fetched only when creating an internal supplier invoice PDF.

Lucide icon node data is generated from the bundled Lucide package; its ISC
license is retained in `LUCIDE-LICENSE`.
