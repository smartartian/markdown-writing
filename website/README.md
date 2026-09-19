# Markdown Writing Website

Static bilingual official website for Markdown Writing. The site has no
runtime dependencies: Lucide, the brand assets, and cached release data are
served locally. Chinese and English copy is selected from the browser language
and can be changed with the header language switch.

## Preview

From the repository root:

```sh
python3 -m http.server 4173 -d website
```

Then open `http://localhost:4173/`.

The site is dependency-free at runtime. Lucide icons and the application logo are bundled locally.

The update history page at `updates.html` reads `releases.json` first and
falls back to the public GitHub Releases API when no cached manifest is
available. The release workflow refreshes that manifest after a GitHub Release
is published. The public download path is intentionally limited to macOS
Apple Silicon packages.

The installation guide lives at `install.html`. Language can be selected from
the shared header on every page, is persisted locally, and can also be
addressed directly with `?lang=zh-CN` or `?lang=en` for indexing and sharing.
The dedicated download page lives at `download.html`; it owns the live release
metadata and Apple Silicon package link so the homepage stays product-focused.

`style-preview.html` is the approved visual reference used during the website
redesign. It is not part of the deployed navigation.

## Checks

```sh
cd website
npm run check
npm test
```

The canonical URLs currently target the GitHub Pages address
`https://smartartian.github.io/Markdown-writing/`. Update the metadata,
`robots.txt`, and `sitemap.xml` together if a custom domain is added later.

The `Deploy Website` workflow publishes the `website/` directory through
GitHub Pages on pushes to `main` or `master`.
