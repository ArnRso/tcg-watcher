const TcgWatcher = (() => {
  const REPORT_DEBOUNCE_MS = 400;
  const RESCAN_INTERVAL_MS = 15000;

  function textOf(node) {
    return (node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function leafElements() {
    return [...document.querySelectorAll('body *')].filter(
      (el) => el.children.length === 0 && textOf(el)
    );
  }

  function findLeafMatching(pattern) {
    return leafElements().find((el) => pattern.test(textOf(el))) || null;
  }

  function parseCountdown(text) {
    const hours = text.match(/(\d+)\s*h(?:\s*(\d+))?/i);
    if (hours) return Number(hours[1]) * 3600 + Number(hours[2] || 0) * 60;

    const clock = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (clock) {
      if (clock[3] !== undefined) {
        return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
      }
      return Number(clock[1]) * 60 + Number(clock[2]);
    }

    const minutes = text.match(/(\d+)\s*min/i);
    if (minutes) return Number(minutes[1]) * 60;

    return null;
  }

  function start(site, read) {
    let timer = null;
    let lastSignature = '';

    const report = (force) => {
      let reading;
      try {
        reading = read();
      } catch (error) {
        reading = { error: String((error && error.message) || error) };
      }
      if (!reading) return;

      // Tant que la page n'est pas hydratée, la lecture est vide : inutile de
      // l'envoyer, le service worker la rejetterait de toute façon.
      if (typeof reading.available !== 'number') return;

      const payload = { site, url: location.href, readAt: Date.now(), ...reading };
      const signature = JSON.stringify({ ...payload, readAt: 0, secondsToNext: 0 });
      if (!force && signature === lastSignature) return;
      lastSignature = signature;

      chrome.runtime.sendMessage({ type: 'reading', payload }, () => {
        if (chrome.runtime.lastError) {
          console.warn(`[TCG ${site}] envoi refusé : ${chrome.runtime.lastError.message}`);
        }
      });
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(report, REPORT_DEBOUNCE_MS);
    };

    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    setInterval(report, RESCAN_INTERVAL_MS);

    chrome.runtime.onMessage.addListener((message, _sender, respond) => {
      if (message && message.type === 'rescan') {
        report(true);
        respond({ ok: true });
        return;
      }

      // Lecture directe, utilisée par l'onglet discret du service worker.
      if (message && message.type === 'read') {
        let reading = null;
        try {
          reading = read();
        } catch (error) {
          console.warn(`[TCG ${site}] lecture échouée : ${error.message}`);
        }
        respond(reading && typeof reading.available === 'number' ? reading : null);
      }
    });

    report();
  }

  return { findLeafMatching, leafElements, parseCountdown, start, textOf };
})();
