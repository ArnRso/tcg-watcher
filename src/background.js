/*
 * TCG Watcher — surveille les paquets WikiMasters et l'énergie HoloPocket.
 * Copyright (C) 2026 Adrien Russo
 *
 * Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le
 * modifier selon les termes de la GNU General Public License telle que
 * publiée par la Free Software Foundation, soit la version 3, soit (à votre
 * choix) toute version ultérieure. Il est distribué sans aucune garantie.
 * Voir le fichier LICENSE, ou <https://www.gnu.org/licenses/>.
 */

importScripts('shared/state.js');

const { SITES, activeSites, badgeState, learnRecharge, projectAll, readSettings } = TcgState;

const POLL_MINUTES = 5;
const HIDDEN_TAB_TIMEOUT_MS = 20000;
const HIDDEN_TAB_MIN_AGE_MS = 4 * 60 * 1000;

function log(message, data) {
  const stamp = new Date().toLocaleTimeString('fr-FR');
  if (data === undefined) {
    console.log(`[TCG ${stamp}] ${message}`);
  } else {
    console.log(`[TCG ${stamp}] ${message}`, data);
  }
}
async function getState() {
  const stored = await chrome.storage.local.get(['readings', 'settings', 'notified']);
  return {
    readings: stored.readings || {},
    settings: readSettings(stored.settings),
    notified: stored.notified || {}
  };
}

async function refreshBadge(stored, knownSettings) {
  const settings = knownSettings || (await getState()).settings;
  const readings = projectAll(stored);
  const { text, color } = badgeState(readings, settings);

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }

  const sites = activeSites(settings);
  const lines = sites.map((site) => {
    const meta = SITES[site];
    const reading = readings[site];
    if (!reading || typeof reading.available !== 'number') {
      return `${meta.label} : inconnu`;
    }
    const capacity = reading.capacity ? ` / ${reading.capacity}` : '';
    const mark = reading.estimated ? ' ≈' : '';
    return `${meta.label} : ${reading.available}${capacity} ${reading.unit || meta.unit}${mark}`;
  });

  const title = sites.length ? `TCG Watcher\n${lines.join('\n')}` : 'TCG Watcher — aucun jeu suivi';
  await chrome.action.setTitle({ title });
}

async function maybeNotify(site, reading, settings, notified) {
  if (!settings.notify || !settings.enabled[site]) return notified;
  // Jamais sur une projection : les paquets ont pu être ouverts sur un autre appareil.
  if (reading.estimated) return notified;

  const threshold = settings.thresholds[site] ?? 1;
  const meta = SITES[site];
  const reached = typeof reading.available === 'number' && reading.available >= threshold;

  if (reached && !notified[site]) {
    const capacity = reading.capacity ? ` / ${reading.capacity}` : '';
    await chrome.notifications.create(`tcg-${site}-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `${meta.label} — c'est prêt`,
      message: `${reading.available}${capacity} ${reading.unit || meta.unit} disponible(s).`,
      priority: 1
    });
    return { ...notified, [site]: true };
  }

  if (!reached && notified[site]) {
    return { ...notified, [site]: false };
  }

  return notified;
}

async function storeReading(payload) {
  const { readings, settings, notified } = await getState();
  const site = payload.site;
  if (!SITES[site]) {
    log(`relevé ignoré : site inconnu « ${site} »`);
    return;
  }

  // Une page pas encore hydratée renvoie `available: null`. L'écrire effacerait
  // un relevé valide : on garde l'ancien et on attend la prochaine lecture.
  if (typeof payload.available !== 'number') {
    log(`${site} : lecture vide ignorée (${payload.reason || 'sans raison'})`);
    return;
  }

  const measured = learnRecharge(readings[site], payload);
  if (measured && measured !== payload.rechargeSeconds) {
    log(`${site} : cadence mesurée à ${measured} s (${(measured / 60).toFixed(1)} min)`);
    payload.rechargeSeconds = measured;
  }

  const merged = { ...readings, [site]: { ...payload, source: 'tab', stale: false } };
  const nextNotified = await maybeNotify(site, payload, settings, notified);

  await chrome.storage.local.set({ readings: merged, notified: nextNotified });
  await refreshBadge(merged, settings);
}

// Les deux sites rendent leur compteur côté client : le HTML servi ne le contient pas.
// On ouvre donc un onglet en arrière-plan, on laisse la page s'hydrater, puis on lit le DOM.
// Onglets ouverts par l'extension pour un relevé : à ne jamais confondre avec
// ceux de l'utilisateur, et à refermer même si un relevé a été interrompu.
const ownTabs = new Set();

async function pollSiteInHiddenTab(site) {
  // Un onglet du site déjà ouvert quelque part évite d'en créer un.
  const existing = (await chrome.tabs.query({ url: `${SITES[site].origin}/*` })).filter(
    (tab) => !ownTabs.has(tab.id)
  );
  for (const tab of existing) {
    try {
      const answer = await chrome.tabs.sendMessage(tab.id, { type: 'read' });
      if (answer && typeof answer.available === 'number') {
        log(`${site} : lu depuis l'onglet existant ${tab.id}`);
        return { site, readAt: Date.now(), openUrl: SITES[site].openUrl, source: 'tab', ...answer };
      }
    } catch {
      // onglet sans content script actif
    }
  }

  // `pinned` réduit l'onglet à une vignette en bord de barre, le temps du relevé.
  // Brave refuse d'ouvrir un onglet pendant que l'utilisateur en manipule un
  // (« Tabs cannot be edited right now ») : on retente brièvement plutôt que
  // de perdre le relevé du site.
  let tab = null;
  for (let tries = 0; tries < 3 && !tab; tries++) {
    try {
      tab = await chrome.tabs.create({ url: SITES[site].openUrl, active: false, pinned: true });
    } catch (error) {
      log(`${site} : ouverture refusée (${error.message}), nouvelle tentative`);
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  if (!tab) {
    log(`${site} : impossible d'ouvrir un onglet, relevé abandonné`);
    return null;
  }

  ownTabs.add(tab.id);
  await chrome.storage.local.set({ ownTabIds: [...ownTabs] });
  try {
    const reading = await new Promise((resolve) => {
      const deadline = Date.now() + HIDDEN_TAB_TIMEOUT_MS;

      const attempt = async () => {
        try {
          const answer = await chrome.tabs.sendMessage(tab.id, { type: 'read' });
          if (answer && typeof answer.available === 'number') return resolve(answer);
        } catch {
          // content script pas encore prêt
        }
        if (Date.now() > deadline) return resolve(null);
        setTimeout(attempt, 300);
      };

      setTimeout(attempt, 400);
    });

    log(`${site} : onglet discret → ${reading ? `${reading.available} / ${reading.capacity}` : 'échec'}`);
    return reading
      ? { site, readAt: Date.now(), openUrl: SITES[site].openUrl, source: 'hidden-tab', ...reading }
      : null;
  } finally {
    ownTabs.delete(tab.id);
    await chrome.storage.local.set({ ownTabIds: [...ownTabs] });
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Un seul relevé à la fois : sans ce verrou, deux déclencheurs rapprochés
// (réouverture du popup, alarme) ouvrent chacun leur onglet sur le même site
// et se gênent mutuellement.
let pollInFlight = null;

function poll(trigger) {
  if (pollInFlight) {
    log(`poll() déjà en cours, « ${trigger} » ignoré`);
    return pollInFlight;
  }
  pollInFlight = runPoll(trigger).finally(() => {
    pollInFlight = null;
  });
  return pollInFlight;
}

async function runPoll(trigger) {
  log(`poll() démarre — déclencheur : ${trigger || 'inconnu'}`);
  const { readings, settings, notified } = await getState();
  const merged = { ...readings };
  const liveSites = new Set();
  let nextNotified = notified;

  for (const site of activeSites(settings)) {
    try {
      let tabs = [];
      try {
        tabs = await chrome.tabs.query({ url: `${SITES[site].origin}/*` });
        log(`${site} : ${tabs.length} onglet(s) ouvert(s)`);
      } catch (error) {
        log(`${site} : tabs.query a échoué — ${error.message}`);
      }

      if (tabs.length) {
        const answered = await Promise.all(
          tabs.map((tab) =>
            chrome.tabs
              .sendMessage(tab.id, { type: 'rescan' })
              .then(() => true)
              .catch((error) => {
                log(`${site} : onglet ${tab.id} muet — ${error.message}`);
                return false;
              })
          )
        );
        // Le content script a répondu : il écrit son relevé lui-même via storeReading.
        if (answered.some(Boolean)) {
          log(`${site} : relevé délégué au content script`);
          liveSites.add(site);
          continue;
        }
      }

      const previous = merged[site];
      const age = previous ? Date.now() - previous.readAt : Infinity;
      if (trigger === 'alarme' && age < HIDDEN_TAB_MIN_AGE_MS) {
        log(`${site} : relevé encore frais (${Math.round(age / 1000)} s), onglet inutile`);
        continue;
      }

      const reading = await pollSiteInHiddenTab(site);
      if (reading) {
        merged[site] = reading;
        nextNotified = await maybeNotify(site, reading, settings, nextNotified);
      } else if (previous) {
        merged[site] = { ...previous, stale: true };
      }
    } catch (error) {
      log(`${site} : ERREUR — ${error.message}`);
      if (merged[site]) merged[site] = { ...merged[site], stale: true };
    }
  }

  // Les sites avec un onglet vivant ont écrit leur propre relevé entre-temps : on le garde.
  const fresh = (await chrome.storage.local.get('readings')).readings || {};
  for (const site of liveSites) {
    if (fresh[site]) merged[site] = fresh[site];
  }

  await chrome.storage.local.set({ readings: merged, notified: nextNotified });
  await refreshBadge(merged, settings);
  log('poll() terminé', merged);
  return merged;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message && message.type === 'reading') {
    log(`relevé reçu du content script ${message.payload.site}`, message.payload);
    storeReading(message.payload)
      .then(() => respond({ ok: true }))
      .catch((error) => {
        log(`storeReading a échoué — ${error.message}`);
        respond({ ok: false, error: error.message });
      });
    return true;
  }

  if (message && message.type === 'settings-changed') {
    getState()
      .then(({ readings, settings }) => refreshBadge(readings, settings))
      .then(() => respond({ ok: true }))
      .catch(() => respond({ ok: false }));
    return true;
  }

  if (message && message.type === 'poll') {
    poll('popup')
      .then((readings) => respond({ ok: true, readings }))
      .catch((error) => {
        log(`poll() a échoué — ${error.message}`);
        respond({ ok: false, error: error.message });
      });
    return true;
  }

  log(`message inconnu de ${sender.id || 'inconnu'}`, message);
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  log('extension installée ou rechargée');
  chrome.alarms.create('poll', { periodInMinutes: POLL_MINUTES });
  chrome.alarms.create('project', { periodInMinutes: 1 });
  poll('onInstalled');
});

chrome.runtime.onStartup.addListener(() => {
  log('navigateur démarré');
  chrome.alarms.create('poll', { periodInMinutes: POLL_MINUTES });
  chrome.alarms.create('project', { periodInMinutes: 1 });
  poll('onStartup');
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'poll') poll('alarme');

  // Recalcule le badge à partir du rythme connu, sans toucher au réseau.
  if (alarm.name === 'project') {
    const { readings, settings } = await getState();
    await refreshBadge(readings, settings);
  }
});

// Un service worker tué en plein relevé laisse son onglet épinglé derrière lui.
// Les identifiants sont donc persistés : on ne referme que des onglets dont on
// sait qu'ils viennent de nous, jamais un onglet épinglé par l'utilisateur.
async function closeOrphanTabs() {
  const { ownTabIds } = await chrome.storage.local.get('ownTabIds');
  if (!ownTabIds || !ownTabIds.length) return;

  for (const id of ownTabIds) {
    try {
      await chrome.tabs.remove(id);
      log(`onglet de relevé orphelin ${id} refermé`);
    } catch {
      // déjà fermé
    }
  }
  await chrome.storage.local.remove('ownTabIds');
}

closeOrphanTabs();

log('service worker chargé');

chrome.notifications.onClicked.addListener(async (id) => {
  const site = Object.keys(SITES).find((key) => id.includes(key));
  if (site) {
    await chrome.tabs.create({ url: SITES[site].openUrl });
    chrome.notifications.clear(id);
  }
});
