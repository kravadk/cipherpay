/*!
 * CipherPay Encrypted Checkout — embed script
 *
 * Drop into a merchant page:
 *   <script src="https://cipherpay.app/cipherpay.js" data-invoice="0x..." async></script>
 *
 * The script injects a sandboxed iframe pointing at /checkout/:hash. The
 * merchant page never sees the payer address or the plaintext amount —
 * only a `cipherpay:paid` postMessage carrying the tx hash on success.
 *
 * Optional data-attributes:
 *   data-invoice (required) bytes32 invoice hash
 *   data-base    (optional) override the CipherPay origin (defaults to script src origin)
 *   data-mode    (optional) "modal" (default) or "inline"
 *   data-target  (optional, inline) selector for the container element
 *   data-on-paid (optional) name of a global function called with {tx, invoice}
 */
(function () {
  var script = document.currentScript;
  if (!script) return;

  var invoice = script.getAttribute('data-invoice');
  if (!invoice || !/^0x[0-9a-fA-F]{64}$/.test(invoice)) {
    console.error('[cipherpay.js] data-invoice must be a 0x-prefixed 32-byte hash');
    return;
  }

  var base = script.getAttribute('data-base') || new URL(script.src).origin;
  var mode = script.getAttribute('data-mode') || 'modal';
  var targetSel = script.getAttribute('data-target');
  var onPaidName = script.getAttribute('data-on-paid');
  var origin = encodeURIComponent(window.location.origin);
  var url = base + '/checkout/' + invoice + '?origin=' + origin;

  function makeIframe() {
    var f = document.createElement('iframe');
    f.src = url;
    f.setAttribute('allow', 'clipboard-write');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms');
    f.style.border = '0';
    f.style.width = '100%';
    f.style.maxWidth = '420px';
    f.style.height = '560px';
    f.style.borderRadius = '16px';
    f.style.boxShadow = '0 20px 60px rgba(0,0,0,0.4)';
    return f;
  }

  var overlay, iframe;

  function openModal() {
    overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.7)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'z-index:2147483647', 'padding:16px',
      'backdrop-filter:blur(4px)'
    ].join(';');
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal();
    });
    iframe = makeIframe();
    overlay.appendChild(iframe);
    document.body.appendChild(overlay);
  }

  function closeModal() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    iframe = null;
  }

  function inlineMount() {
    var host = targetSel ? document.querySelector(targetSel) : null;
    if (!host) {
      console.error('[cipherpay.js] inline mode needs a valid data-target selector');
      return;
    }
    iframe = makeIframe();
    host.appendChild(iframe);
  }

  // postMessage listener — only trust messages from the cipherpay origin
  window.addEventListener('message', function (e) {
    if (e.origin !== base) return;
    var data = e.data || {};
    if (data.type === 'cipherpay:paid') {
      if (onPaidName && typeof window[onPaidName] === 'function') {
        try { window[onPaidName]({ tx: data.tx, invoice: data.invoice }); } catch (err) {}
      }
      // Auto-close modal on success after a short delay so the user sees confirmation
      if (mode === 'modal') setTimeout(closeModal, 1500);
    }
  });

  // Public API on window.CipherPay
  window.CipherPay = window.CipherPay || {};
  window.CipherPay.open = openModal;
  window.CipherPay.close = closeModal;

  if (mode === 'inline') {
    inlineMount();
  }
  // In modal mode the merchant calls window.CipherPay.open() from a button.
})();
