# Markdown Writing Website

Static official website for Markdown Writing.

## Preview

From the repository root:

```sh
python3 -m http.server 4173 -d website
```

Then open `http://localhost:4173/`.

The site is dependency-free at runtime. Lucide icons and the application logo are bundled locally.

The update history page at `updates.html` reads release data directly from GitHub Releases through the GitHub API.
