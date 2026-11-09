TcgWatcher.start('wikimasters', () => {
  const label = TcgWatcher.findLeafMatching(/paquets?\s+disponibles?/i);
  if (!label) return { available: null, reason: 'compteur introuvable' };

  const block = label.closest('.card-frame') || label.parentElement;
  const blockText = TcgWatcher.textOf(block);

  const fraction = blockText.match(/(\d+)\s*\/\s*(\d+)/);
  if (!fraction) return { available: null, reason: 'fraction illisible' };

  const next = blockText.match(/Prochain dans\s*([\dh: ]+)/i);

  // L'offre PRO, quand elle est affichée, annonce « toutes les 3 minutes au lieu
  // de 10 » : le second nombre est la cadence gratuite. Elle disparaît de la page
  // dès qu'on a des paquets en réserve, d'où le repli sur la cadence connue.
  const pace = document.body.innerText.match(
    /un nouveau paquet toutes les \d+ minutes au lieu de (\d+)/i
  );

  return {
    available: Number(fraction[1]),
    capacity: Number(fraction[2]),
    unit: 'paquet',
    secondsToNext: next ? TcgWatcher.parseCountdown(next[1]) : null,
    rechargeSeconds: pace ? Number(pace[1]) * 60 : 600,
    openUrl: 'https://www.wiki-masters.com/pulls'
  };
});
