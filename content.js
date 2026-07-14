/**
 * Content script — runs on arxiv.org/abs/* pages.
 * Extracts paper metadata, caches it for PDF page use, and responds to popup.
 */
(function () {
  'use strict';

  /** Extract metadata from arXiv abstract page meta tags (with DOM fallbacks). */
  function extractMetadata() {
    const m = {};

    // Title
    const titleMeta = document.querySelector('meta[name="citation_title"]');
    if (titleMeta) {
      m.title = titleMeta.content;
    } else {
      const el = document.querySelector('#abs > h1');
      if (el) m.title = el.textContent.replace(/^Title:\s*/i, '').trim();
    }

    // Authors (citation_author format: "Surname, Firstname")
    const authorMetas = document.querySelectorAll('meta[name="citation_author"]');
    m.authors = [];
    authorMetas.forEach(meta => m.authors.push(meta.content));
    if (m.authors.length === 0) {
      document.querySelectorAll('div.authors a').forEach(a => m.authors.push(a.textContent.trim()));
    }

    // Date (YYYY/MM/DD)
    const dateMeta = document.querySelector('meta[name="citation_date"]');
    if (dateMeta) {
      m.date = dateMeta.content;
    } else {
      const idMatch = location.pathname.match(/\/abs\/(\d{4})/);
      if (idMatch) {
        const yymm = idMatch[1];
        m.date = '20' + yymm.slice(0,2) + '/' + yymm.slice(2,4);
      }
    }

    // arXiv ID (strip version) + PDF URL
    const absMatch = location.pathname.match(/\/abs\/(.+)/);
    if (absMatch) {
      const paperId = absMatch[1].replace(/v\d+$/, '');
      m.pdfUrl = 'https://arxiv.org/pdf/' + paperId + '.pdf';
      m.arxivId = paperId;
    }

    // Primary category
    const subj = document.querySelector('span.primary-subject');
    if (subj) {
      const catMatch = subj.textContent.match(/\(([^)]+)\)/);
      if (catMatch) m.category = catMatch[1];
    }

    return m;
  }

  // ---- Cache metadata for use on PDF pages ----
  const metadata = extractMetadata();
  if (metadata.arxivId) {
    const key = 'paper_' + metadata.arxivId;
    chrome.storage.local.set({ [key]: metadata });
    console.log('[arXiv Downloader] Cached metadata for', metadata.arxivId);
  }

  // ---- Add an explicit renamed-download button below each View PDF link ----
  function createDownloadButton(placement, className) {
    const button = document.createElement('a');
    button.href = '#';
    button.className = className;
    button.dataset.arxivDownloaderButton = placement;
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'Download with arXiv Paper Downloader');
    button.style.color = '#b31b1b';

    const icon = document.createElement('img');
    icon.src = chrome.runtime.getURL('icons/icon16.png');
    icon.alt = '';
    icon.width = 16;
    icon.height = 16;
    icon.style.marginRight = '6px';
    icon.style.verticalAlign = '-3px';

    button.append(icon, document.createTextNode('Download'));
    button.addEventListener('click', handleInjectedDownload);
    return button;
  }

  async function handleInjectedDownload(event) {
    event.preventDefault();

    const button = event.currentTarget;
    if (button.dataset.downloadInProgress === 'true') return;

    button.dataset.downloadInProgress = 'true';
    button.setAttribute('aria-disabled', 'true');
    button.style.pointerEvents = 'none';
    button.style.opacity = '0.65';

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'downloadPdf',
        metadata: extractMetadata()
      });
      if (!response || !response.ok) {
        throw new Error(response && response.error ? response.error : 'Download failed');
      }
    } catch (err) {
      console.error('[arXiv Downloader] Injected download failed:', err);
    } finally {
      delete button.dataset.downloadInProgress;
      button.removeAttribute('aria-disabled');
      button.style.pointerEvents = '';
      button.style.opacity = '';
    }
  }

  function injectDownloadButtons() {
    const desktopPdfLink = document.querySelector(
      '.extra-services a.abs-button.download-pdf[href^="/pdf/"]'
    );
    if (
      desktopPdfLink &&
      desktopPdfLink.parentElement &&
      !document.querySelector('[data-arxiv-downloader-button="desktop"]')
    ) {
      const item = document.createElement('li');
      item.appendChild(createDownloadButton('desktop', 'abs-button'));
      desktopPdfLink.parentElement.insertAdjacentElement('afterend', item);
    }

    const mobilePdfLink = document.querySelector(
      '#abs > a.mobile-submission-download[href^="/pdf/"]'
    );
    if (
      mobilePdfLink &&
      !document.querySelector('[data-arxiv-downloader-button="mobile"]')
    ) {
      mobilePdfLink.insertAdjacentElement(
        'afterend',
        createDownloadButton('mobile', 'mobile-submission-download')
      );
    }
  }

  injectDownloadButtons();

  // ---- Download via fetch + blob + a[download] ----
  async function downloadWithName(url, filename) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Fetch failed: ' + resp.status);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      console.error('[arXiv Downloader] Blob download failed:', err);
    }
  }

  // ---- Respond to messages from popup ----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'getMetadata') {
      sendResponse(extractMetadata());
    }
    if (msg.type === 'triggerDownload') {
      const md = extractMetadata();
      const settings = msg.settings || {};
      const mergedSettings = Object.assign({}, DEFAULT_SETTINGS, settings);
      const filename = buildFilename(md, mergedSettings);
      downloadWithName(md.pdfUrl, filename);
      sendResponse({ ok: true });
    }
    return true;
  });

  console.log('[arXiv Downloader] Content script loaded on', location.href);
})();
