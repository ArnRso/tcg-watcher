// Script classique volontairement : chargé par `importScripts` dans le service
// worker et par une balise <script> dans le popup. Un module ES obligerait le
// popup à résoudre un import avant d'afficher quoi que ce soit, ce qui retarde
// visiblement son ouverture.
const TcgState = (() => {
  const SITES = {
    wikimasters: {
      label: 'WikiMasters',
      origin: 'https://www.wiki-masters.com',
      openUrl: 'https://www.wiki-masters.com/pulls',
      unit: 'paquet'
    },
    holopocket: {
      label: 'HoloPocket',
      origin: 'https://holopocket.fr',
      openUrl: 'https://holopocket.fr/',
      unit: 'énergie'
    }
  };

  const DEFAULT_SETTINGS = {
    notify: true,
    enabled: { wikimasters: true, holopocket: true },
    thresholds: { wikimasters: 1, holopocket: 10 }
  };

  const DEFAULT_RECHARGE_SECONDS = 600;

  const BADGE_READY = '#166534';
  const BADGE_WAITING = '#9f1239';
  const BADGE_IDLE = '#3f3f46';

  function readSettings(stored) {
    const settings = { ...DEFAULT_SETTINGS, ...(stored || {}) };
    settings.enabled = { ...DEFAULT_SETTINGS.enabled, ...(settings.enabled || {}) };
    settings.thresholds = { ...DEFAULT_SETTINGS.thresholds, ...(settings.thresholds || {}) };
    return settings;
  }

  function activeSites(settings) {
    return Object.keys(SITES).filter((site) => settings.enabled[site]);
  }

  // Le badge est vert seulement quand chaque jeu suivi a atteint son seuil.
  function badgeState(readings, settings) {
    const sites = activeSites(settings);
    if (!sites.length) return { text: '', color: BADGE_IDLE };

    const known = sites
      .map((site) => readings[site])
      .filter((reading) => reading && typeof reading.available === 'number');

    if (!known.length) return { text: '', color: BADGE_IDLE };

    const total = known.reduce((sum, reading) => sum + reading.available, 0);
    const allReady =
      known.length === sites.length &&
      sites.every((site) => {
        const reading = readings[site];
        return reading && reading.available >= settings.thresholds[site];
      });

    return { text: String(total), color: allReady ? BADGE_READY : BADGE_WAITING };
  }

  // Projette un relevé dans le présent à partir du rythme de recharge observé.
  // La recharge est garantie par le temps, donc l'estimation ne peut que monter :
  // une consommation sur un autre appareil ne se devine pas et sera corrigée au
  // prochain relevé réel. Le résultat est donc une borne haute, marquée `estimated`.
  function project(reading, now = Date.now()) {
    if (!reading || typeof reading.available !== 'number') return reading;
    if (reading.available >= reading.capacity) return reading;
    if (!reading.secondsToNext || !reading.rechargeSeconds) return reading;

    const elapsed = (now - reading.readAt) / 1000;
    if (elapsed < reading.secondsToNext) {
      return { ...reading, secondsToNext: Math.round(reading.secondsToNext - elapsed) };
    }

    const after = elapsed - reading.secondsToNext;
    const gained = 1 + Math.floor(after / reading.rechargeSeconds);
    const available = Math.min(reading.capacity, reading.available + gained);
    const remainder = reading.rechargeSeconds - (after % reading.rechargeSeconds);

    return {
      ...reading,
      available,
      secondsToNext: available >= reading.capacity ? null : Math.round(remainder),
      estimated: available !== reading.available
    };
  }

  function projectAll(readings, now = Date.now()) {
    const out = {};
    for (const [site, reading] of Object.entries(readings)) {
      out[site] = project(reading, now);
    }
    return out;
  }

  // Deux relevés successifs séparés par un gain révèlent la cadence réelle,
  // plus sûre qu'une valeur annoncée sur la page (qui n'est pas toujours affichée).
  function learnRecharge(previous, next) {
    if (!previous || previous.estimated) return next.rechargeSeconds;
    const gain = next.available - previous.available;
    if (gain < 1 || next.available >= next.capacity) return next.rechargeSeconds;

    const elapsed = (next.readAt - previous.readAt) / 1000;

    // Deux relevés trop rapprochés ne mesurent rien : le gain vient d'un cycle
    // commencé avant le premier, pas de l'intervalle observé. Il faut au moins
    // un cycle complet entre les deux pour que la division ait un sens.
    if (elapsed < (next.rechargeSeconds || 600)) return next.rechargeSeconds;

    const measured = Math.round(elapsed / gain);
    // Une cadence plausible : entre 1 et 60 minutes.
    if (measured < 60 || measured > 3600) return next.rechargeSeconds;

    return measured;
  }

  return {
    SITES,
    DEFAULT_SETTINGS,
    DEFAULT_RECHARGE_SECONDS,
    BADGE_READY,
    BADGE_WAITING,
    BADGE_IDLE,
    readSettings,
    activeSites,
    badgeState,
    project,
    projectAll,
    learnRecharge
  };
})();

// Les tests Node importent ce fichier comme module ES.
if (typeof module !== 'undefined' && module.exports) module.exports = TcgState;
