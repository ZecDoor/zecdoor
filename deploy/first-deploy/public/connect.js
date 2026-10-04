// Connect-only. This file deliberately contains no signing calls:
// no signMessage, no signTransaction, no signAndSendTransaction.
(function () {
  const button = document.getElementById('connect');
  const status = document.getElementById('status');

  function provider() {
    const p = window.phantom && window.phantom.solana;
    return p && p.isPhantom ? p : null;
  }

  function short(key) {
    const s = key.toString();
    return s.slice(0, 4) + '…' + s.slice(-4);
  }

  function openInPhantom() {
    const url = encodeURIComponent(window.location.href);
    const ref = encodeURIComponent(window.location.origin);
    window.location.href = 'https://phantom.com/ul/browse/' + url + '?ref=' + ref;
  }

  button.addEventListener('click', async function () {
    const p = provider();
    if (!p) {
      if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
        status.textContent = 'Opening this page inside Phantom…';
        openInPhantom();
      } else {
        status.textContent = 'Phantom was not found. Install the Phantom browser extension, then reload this page.';
      }
      return;
    }
    try {
      if (p.isConnected && p.publicKey) {
        await p.disconnect();
        button.textContent = 'Connect Phantom';
        status.textContent = 'Disconnected.';
        return;
      }
      const res = await p.connect();
      button.textContent = 'Disconnect';
      status.textContent = 'Connected: ' + short(res.publicKey) + '. Nothing else happens on this page.';
    } catch (e) {
      status.textContent = 'Connection was cancelled.';
    }
  });
})();
