TcgWatcher.start('holopocket', () => {
  const unitLabel = TcgWatcher.findLeafMatching(/\/\s*\d+\s*d['’]énergie/i);
  if (!unitLabel) return { available: null, reason: 'jauge d’énergie introuvable' };

  const capacity = Number(TcgWatcher.textOf(unitLabel).match(/\/\s*(\d+)/)[1]);

  const row = unitLabel.closest('p') || unitLabel.parentElement;
  const current = [...row.children]
    .filter((el) => el !== unitLabel)
    .map((el) => TcgWatcher.textOf(el))
    .find((text) => /^\d+$/.test(text));
  if (current === undefined) return { available: null, reason: 'énergie illisible' };

  let gauge = '';
  for (let node = row; node && node.tagName !== 'BODY'; node = node.parentElement) {
    gauge = TcgWatcher.textOf(node);
    if (/Pleine à/i.test(gauge)) break;
  }
  const next = gauge.match(/\+\s*\d+\s*dans\s*([\dh: ]+)/i);
  const full = gauge.match(/Pleine à\s*([\d:]+)/i);
  const untilFull = gauge.match(/Pleine à\s*[\d:]+,\s*dans\s*([\dh ]+)/i);

  const available = Number(current);
  const secondsToNext = next ? TcgWatcher.parseCountdown(next[1]) : null;

  // « Pleine à 12:30, dans 1 h 35 » : ce délai réparti sur l'énergie manquante
  // donne la cadence de recharge, que la page n'affiche pas directement.
  let rechargeSeconds = 600;
  const missing = capacity - available;
  if (untilFull && missing > 1 && secondsToNext !== null) {
    const total = TcgWatcher.parseCountdown(untilFull[1]);
    if (total !== null && total > secondsToNext) {
      rechargeSeconds = Math.round((total - secondsToNext) / (missing - 1));
    }
  }

  return {
    available,
    capacity,
    unit: 'énergie',
    secondsToNext,
    rechargeSeconds,
    fullAt: full ? full[1] : null,
    openUrl: 'https://holopocket.fr/'
  };
});
