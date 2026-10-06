// Shows one QR code, big, for a link this app itself generated - opened
// as its own tab/window from the tutor dashboard (see tutor.js's
// showShareBlock) rather than embedded inline, so a tutor can put just
// this window up on a projector without the rest of the editor around it.
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const link = params.get('link') || '';
  const title = params.get('title') || '';

  const titleEl = document.getElementById('qr-title');
  const imageEl = document.getElementById('qr-image');
  const linkTextEl = document.getElementById('qr-link-text');
  const errorEl = document.getElementById('qr-error');
  const copyBtn = document.getElementById('qr-copy-btn');

  if (title.trim()) {
    titleEl.textContent = title;
    document.title = `Diamond Nine — ${title}`;
  }

  linkTextEl.textContent = link;

  if (link) {
    // The actual QR image is rendered server-side (see server.js's
    // /api/qr) - this page just points an <img> at it, same as pointing
    // at any other image URL. The server independently checks that this
    // link actually belongs to this app before generating anything, so
    // there's no way to turn this page into "make a QR code of anything".
    imageEl.src = `/api/qr?text=${encodeURIComponent(link)}`;
    imageEl.addEventListener('error', () => {
      imageEl.hidden = true;
      errorEl.hidden = false;
    });
  } else {
    imageEl.hidden = true;
    errorEl.textContent = 'No link was provided.';
    errorEl.hidden = false;
  }

  copyBtn.addEventListener('click', async () => {
    const original = copyBtn.textContent;
    try {
      await navigator.clipboard.writeText(link);
      copyBtn.textContent = 'Copied!';
    } catch (err) {
      copyBtn.textContent = 'Copy failed';
    }
    setTimeout(() => {
      copyBtn.textContent = original;
    }, 1500);
  });
})();
