# arXiv Paper Downloader

A Chrome extension that automatically renames arXiv paper downloads with a customizable filename format.

**Default format:** `FirstAuthorSurname-YYYY-Title.pdf`

**Example:**
```
2603.03326v1.pdf  →  Hoppe-2026-Controllable and explainable personality sliders for LLMs at inference time.pdf
```

## Features

- **Scoped interception** - Only direct arXiv PDF downloads and verified arXiv downloads from Chrome's built-in PDF viewer participate in filename determination; unrelated extension Blob downloads are ignored

- **Auto-rename on download** — When you download a PDF from arXiv's PDF viewer, the file is automatically renamed based on paper metadata
- **Popup download** — Click the extension icon on any arXiv abstract page to download with a custom filename
- **Customizable format** — Define your own filename pattern using tokens
- **API fallback** — Even without visiting the abstract page first, metadata is fetched from the arXiv API
- **Smart caching** — Paper metadata is cached when you visit abstract pages for instant renaming

## Available Tokens

| Token | Description | Example |
|-------|-------------|---------|
| `{author}` | First author surname | `Hoppe` |
| `{authorFull}` | First author full name | `Florian Hoppe` |
| `{allAuthors}` | All author surnames | `Hoppe, Khachaturov, Mullins, Meng` |
| `{year}` | Publication year | `2026` |
| `{month}` | Publication month | `02` |
| `{title}` | Paper title (cleaned) | `Controllable and explainable...` |
| `{arxivId}` | arXiv ID | `2603.03326` |
| `{category}` | Primary category | `cs.CL` |

## Settings

| Setting | Default | Options |
|---------|---------|---------|
| Colon replacement | `—` (em dash) | Any character(s) |
| Title spaces | Keep | Keep / Underscore / Hyphen / Dot |
| Title case | Original | Original / lowercase / Title Case |
| Max title length | Unlimited | Any number |
| Show "Save As" dialog | Off | On / Off |
| Auto-rename PDF downloads | On | On / Off |

## Installation

1. Download or clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the extension folder

## How It Works

1. **Abstract page** (`arxiv.org/abs/*`) — The content script extracts paper metadata from `<meta>` tags and caches it locally
2. **PDF download** — When Chrome initiates a download from `arxiv.org/pdf/*`, the background service worker intercepts the filename determination and suggests the custom filename
3. **Fallback** — If no cached metadata is found (e.g., navigating directly to a PDF URL), the extension fetches metadata from the [arXiv API](https://info.arxiv.org/help/api/index.html)

## License

MIT
