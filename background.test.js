const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let determiningFilenameListener = null;
let runtimeMessageListener = null;
let runtimeLastError = null;
let nextDownloadError = '';
const downloadCalls = [];

const metadata = {
  title: 'Scoped download interception',
  authors: ['Example, Alice'],
  date: '2026/07/14',
  arxivId: '2603.03326',
  category: 'cs.CL',
  pdfUrl: 'https://arxiv.org/pdf/2603.03326.pdf'
};

const context = {
  console,
  URL,
  Date,
  setTimeout,
  clearTimeout,
  importScripts() {},
  DEFAULT_SETTINGS: { autoRename: true },
  buildFilename() {
    return 'Example-2026-Scoped download interception.pdf';
  },
  chrome: {
    downloads: {
      onDeterminingFilename: {
        addListener(listener) {
          determiningFilenameListener = listener;
        }
      },
      download(options, callback) {
        downloadCalls.push(options);
        runtimeLastError = nextDownloadError
          ? { message: nextDownloadError }
          : null;
        callback(nextDownloadError ? undefined : 1);
        runtimeLastError = null;
        nextDownloadError = '';
      }
    },
    runtime: {
      get lastError() {
        return runtimeLastError;
      },
      onMessage: {
        addListener(listener) {
          runtimeMessageListener = listener;
        }
      }
    },
    storage: {
      sync: {
        async get() {
          return { autoRename: true };
        }
      },
      local: {
        async get(key) {
          return { [key]: metadata };
        },
        async set() {}
      }
    }
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync('background.js', 'utf8'), context);

assert.equal(typeof determiningFilenameListener, 'function');
assert.equal(typeof runtimeMessageListener, 'function');

assert.equal(
  context.getArxivIdForDownload({
    url: 'https://arxiv.org/pdf/2603.03326v2.pdf',
    filename: '2603.03326v2.pdf'
  }),
  '2603.03326'
);

assert.equal(
  context.getArxivIdForDownload({
    url: 'blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/example',
    referrer: 'https://arxiv.org/pdf/2603.03326v1.pdf',
    mime: 'application/pdf',
    filename: 'download.pdf'
  }),
  '2603.03326'
);

assert.equal(
  context.getArxivIdForDownload({
    url: 'blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/example',
    mime: 'application/pdf',
    filename: '2603.03326v1.pdf'
  }),
  '2603.03326'
);

assert.equal(
  context.getArxivIdForDownload({
    url: 'blob:chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/photo',
    mime: 'image/jpeg',
    filename: 'photo.jpg'
  }),
  null
);

assert.equal(
  context.getArxivIdForDownload({
    url: 'blob:chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/paper',
    referrer: 'https://arxiv.org/pdf/2603.03326.pdf',
    mime: 'application/pdf',
    filename: '2603.03326.pdf'
  }),
  null
);

assert.equal(
  context.getArxivIdForDownload({
    url: 'blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/report',
    mime: 'application/pdf',
    filename: 'report.pdf'
  }),
  null
);

assert.equal(
  context.getArxivIdForDownload({
    url: 'https://example.com/figure.jpg',
    referrer: 'https://arxiv.org/pdf/2603.03326.pdf',
    mime: 'image/jpeg',
    filename: 'figure.jpg'
  }),
  null
);

let unrelatedSuggestCalls = 0;
const unrelatedResult = determiningFilenameListener(
  {
    url: 'blob:chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/photo',
    mime: 'image/jpeg',
    filename: 'photo.jpg'
  },
  () => {
    unrelatedSuggestCalls += 1;
  }
);
assert.equal(unrelatedResult, undefined);
assert.equal(unrelatedSuggestCalls, 0);

let foreignPdfSuggestCalls = 0;
const foreignPdfResult = determiningFilenameListener(
  {
    url: 'blob:chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/paper',
    referrer: 'https://arxiv.org/pdf/2603.03326.pdf',
    mime: 'application/pdf',
    filename: '2603.03326.pdf'
  },
  () => {
    foreignPdfSuggestCalls += 1;
  }
);
assert.equal(foreignPdfResult, undefined);
assert.equal(foreignPdfSuggestCalls, 0);

let directSuggestion = null;
const directResult = determiningFilenameListener(
  {
    url: 'https://arxiv.org/pdf/2603.03326v1.pdf',
    mime: 'application/pdf',
    filename: '2603.03326v1.pdf'
  },
  suggestion => {
    directSuggestion = suggestion;
  }
);
assert.equal(directResult, true);

(async () => {
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    directSuggestion.filename,
    'Example-2026-Scoped download interception.pdf'
  );
  assert.equal(directSuggestion.conflictAction, 'uniquify');

  let viewerSuggestion = null;
  const viewerResult = determiningFilenameListener(
    {
      url: 'blob:chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/example',
      mime: 'application/pdf',
      filename: '2603.03326.pdf'
    },
    suggestion => {
      viewerSuggestion = suggestion;
    }
  );
  assert.equal(viewerResult, true);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    viewerSuggestion.filename,
    'Example-2026-Scoped download interception.pdf'
  );
  assert.equal(viewerSuggestion.conflictAction, 'uniquify');

  let unrelatedMessageResponses = 0;
  const unrelatedMessageResult = runtimeMessageListener(
    { type: 'unrelated' },
    {},
    () => {
      unrelatedMessageResponses += 1;
    }
  );
  assert.equal(unrelatedMessageResult, undefined);
  assert.equal(unrelatedMessageResponses, 0);

  const successResponse = await new Promise(resolve => {
    const messageResult = runtimeMessageListener(
      {
        type: 'downloadPdf',
        metadata,
        settings: { saveAs: true }
      },
      {},
      resolve
    );
    assert.equal(messageResult, true);
  });
  assert.equal(successResponse.ok, true);
  assert.equal(successResponse.downloadId, 1);
  assert.equal(downloadCalls[0].url, metadata.pdfUrl);
  assert.equal(
    downloadCalls[0].filename,
    'Example-2026-Scoped download interception.pdf'
  );
  assert.equal(downloadCalls[0].saveAs, true);
  assert.equal(downloadCalls[0].conflictAction, 'uniquify');

  nextDownloadError = 'Download failed';
  const failureResponse = await new Promise(resolve => {
    runtimeMessageListener(
      {
        type: 'downloadPdf',
        metadata,
        settings: { saveAs: false }
      },
      {},
      resolve
    );
  });
  assert.equal(failureResponse.ok, false);
  assert.equal(failureResponse.error, 'Download failed');
  assert.equal(downloadCalls[1].saveAs, false);

  console.log('background tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
