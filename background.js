/**
 * Background service worker.
 * 1. Intercepts arxiv PDF downloads via onDeterminingFilename to auto-rename.
 * 2. Handles download requests from popup (fallback).
 */
importScripts('utils.js');

// ============================================================
// 1. Intercept any arxiv PDF download and suggest custom filename
// ============================================================
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  // 1. Try to match from direct URLs (url, finalUrl, referrer)
  const urlsToTest = [item.url, item.finalUrl, item.referrer].filter(Boolean);
  let rawId = null;

  for (const url of urlsToTest) {
    const match = url.match(/arxiv\.org\/pdf\/([^?#]+)/);
    if (match) {
      rawId = match[1].replace(/\.pdf$/i, '').replace(/v\d+$/, '');
      break;
    }
  }

  if (rawId) {
    console.log('[arXiv Downloader] Intercepted direct download for:', rawId);
    renameDownload(rawId, suggest);
    return true; // async suggest
  }

  // 2. If it's a blob from the Chrome PDF viewer, use active tab URL or filename
  if (item.url.startsWith('blob:chrome-extension://')) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      let activeTabUrl = tabs && tabs[0] ? tabs[0].url : '';
      let tabMatch = activeTabUrl && activeTabUrl.match(/arxiv\.org\/pdf\/([^?#]+)/);
      
      if (tabMatch) {
        rawId = tabMatch[1].replace(/\.pdf$/i, '').replace(/v\d+$/, '');
        console.log('[arXiv Downloader] Intercepted blob download from active tab for:', rawId);
        renameDownload(rawId, suggest);
      } else {
        // Fallback: Try to parse arXiv ID from the suggested filename
        const basename = item.filename ? item.filename.split(/[/\\]/).pop() : '';
        const fileMatch = basename.match(/^([a-z\-]+(?:_[a-zA-Z]{2})?_?\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)\.pdf$/i);
        
        if (fileMatch) {
          rawId = fileMatch[1].replace(/_/g, '/').replace(/v\d+$/, '');
          console.log('[arXiv Downloader] Intercepted blob download from filename for:', rawId);
          renameDownload(rawId, suggest);
        } else {
          suggest();
        }
      }
    });
    return true; // async suggest
  }
});

async function renameDownload(arxivId, suggest) {
  try {
    const settingsData = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);
    if (!settings.autoRename) { suggest(); return; }

    // Try cached metadata first
    const key = 'paper_' + arxivId;
    const cached = await chrome.storage.local.get(key);
    let metadata = cached[key];

    // Fallback: fetch from arXiv API
    if (!metadata) {
      console.log('[arXiv Downloader] No cache — fetching from API');
      metadata = await fetchMetadataFromApi(arxivId);
      if (metadata) await chrome.storage.local.set({ [key]: metadata });
    }

    if (metadata) {
      const filename = buildFilename(metadata, settings);
      console.log('[arXiv Downloader] Renaming to:', filename);
      suggest({ filename, conflictAction: 'uniquify' });
    } else {
      suggest();
    }
  } catch (err) {
    console.error('[arXiv Downloader] renameDownload error:', err);
    suggest();
  }
}

// ============================================================
// 2. Fetch metadata from arXiv API (no DOMParser in workers)
// ============================================================
async function fetchMetadataFromApi(arxivId) {
  try {
    const resp = await fetch('https://export.arxiv.org/api/query?id_list=' + arxivId);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();

    const entryMatch = text.match(/<entry>([\s\S]*?)<\/entry>/);
    if (!entryMatch) return null;
    const entry = entryMatch[1];

    const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';
    if (!title) return null;

    const authors = [];
    const re = /<author>\s*<name>(.*?)<\/name>/g;
    let m;
    while ((m = re.exec(entry)) !== null) {
      const parts = m[1].trim().split(/\s+/);
      authors.push(
        parts.length >= 2
          ? parts[parts.length - 1] + ', ' + parts.slice(0, -1).join(' ')
          : m[1].trim()
      );
    }

    const pubMatch = entry.match(/<published>(.*?)<\/published>/);
    let date = '';
    if (pubMatch) {
      const d = new Date(pubMatch[1].trim());
      date = d.getFullYear() + '/' +
        String(d.getMonth() + 1).padStart(2, '0') + '/' +
        String(d.getDate()).padStart(2, '0');
    }

    const catMatch = entry.match(/primary_category[^>]*term="([^"]+)"/);

    return {
      title, authors, date, arxivId,
      category: catMatch ? catMatch[1] : '',
      pdfUrl: 'https://arxiv.org/pdf/' + arxivId + '.pdf'
    };
  } catch (err) {
    console.error('[arXiv Downloader] API error:', err);
    return null;
  }
}

// ============================================================
// 3. Handle download requests from popup (fallback)
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'downloadPdf') {
    handleDownload(msg.metadata, msg.settings || {})
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});

async function handleDownload(metadata, settingsOverride) {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = Object.assign({}, DEFAULT_SETTINGS, stored, settingsOverride);
  const pdfUrl = metadata.pdfUrl;
  if (!pdfUrl) return { ok: false, error: 'No PDF URL' };

  const filename = buildFilename(metadata, settings);

  return new Promise(resolve => {
    chrome.downloads.download({
      url: pdfUrl,
      filename: filename,
      saveAs: !!settings.saveAs,
      conflictAction: 'uniquify'
    }, id => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ ok: true, downloadId: id });
      }
    });
  });
}
