const { SITES, activeSites, project, readSettings } = TcgState;


function formatCountdown(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds <= 0) return 'maintenant';
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} h`;
}

function formatAge(readAt) {
  const seconds = Math.round((Date.now() - readAt) / 1000);
  if (seconds < 45) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `il y a ${hours} h`;
}

function pluralize(count, unit) {
  if (unit === 'énergie') return unit;
  return count > 1 ? `${unit}s` : unit;
}

function renderSite(site, reading, threshold) {
  const meta = SITES[site];
  const item = document.createElement('li');
  item.className = 'site';

  const top = document.createElement('div');
  top.className = 'site-top';

  const name = document.createElement('span');
  name.className = 'site-name';
  name.textContent = meta.label;
  top.append(name);

  const count = document.createElement('span');
  count.className = 'count';

  const known = reading && typeof reading.available === 'number';
  if (known) {
    count.textContent = String(reading.available);
    if (reading.capacity) {
      const cap = document.createElement('span');
      cap.className = 'cap';
      cap.textContent = ` / ${reading.capacity}`;
      count.append(cap);
    }
    if (reading.available >= threshold) item.classList.add('ready');
    if (reading.estimated) item.classList.add('estimated');
  } else {
    count.textContent = '—';
  }
  top.append(count);
  item.append(top);

  const metaRow = document.createElement('div');
  metaRow.className = 'site-meta';

  const left = document.createElement('span');
  if (!known) {
    left.textContent = (reading && reading.reason) || 'aucun relevé';
  } else if (reading.available >= threshold) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = 'prêt';
    left.append(pill);
  } else {
    const next = formatCountdown(reading.secondsToNext);
    const unit = pluralize(1, reading.unit || meta.unit);
    left.textContent = next ? `+1 ${unit} dans ${next}` : `${reading.available} ${pluralize(reading.available, reading.unit || meta.unit)}`;
  }
  metaRow.append(left);

  const link = document.createElement('a');
  link.href = (reading && reading.openUrl) || meta.openUrl;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = 'Ouvrir ›';
  metaRow.append(link);
  item.append(metaRow);

  if (known) {
    const age = document.createElement('div');
    age.className = 'site-meta';
    const stamp = document.createElement('span');
    if (reading.estimated) {
      stamp.textContent = `estimé — relevé ${formatAge(reading.readAt)}`;
      stamp.title = "Calculé d'après le rythme de recharge. Si tu as ouvert des paquets ailleurs, le vrai total est plus bas.";
    } else {
      stamp.textContent = `relevé ${formatAge(reading.readAt)}`;
    }
    age.append(stamp);
    if (reading.fullAt) {
      const full = document.createElement('span');
      full.textContent = `pleine à ${reading.fullAt}`;
      age.append(full);
    }
    item.append(age);
  }

  return item;
}

async function render() {
  const stored = await chrome.storage.local.get(['readings', 'settings']);
  const readings = stored.readings || {};
  const settings = readSettings(stored.settings);
  const thresholds = settings.thresholds;
  const sites = activeSites(settings);

  const list = document.getElementById('sites');
  list.textContent = '';

  if (!sites.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Aucun jeu suivi. Active-en un ci-dessous.';
    list.append(empty);
  } else if (!sites.some((site) => readings[site])) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'Aucun relevé. Ouvre un des sites, ou clique sur Actualiser.';
    list.append(empty);
  } else {
    for (const site of sites) {
      list.append(renderSite(site, project(readings[site]), thresholds[site]));
    }
  }

  document.getElementById('notify').checked = settings.notify;
  renderGames(settings, thresholds);
  return readings;
}

function renderGames(settings, thresholds) {
  const container = document.getElementById('games');
  container.textContent = '';

  for (const [site, meta] of Object.entries(SITES)) {
    const row = document.createElement('div');
    row.className = 'game';
    if (!settings.enabled[site]) row.classList.add('off');

    const toggle = document.createElement('label');
    toggle.className = 'toggle';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = Boolean(settings.enabled[site]);
    box.dataset.site = site;
    box.className = 'enable';
    toggle.append(box);

    const name = document.createElement('span');
    name.textContent = meta.label;
    toggle.append(name);
    row.append(toggle);

    const threshold = document.createElement('label');
    threshold.className = 'threshold';

    const prefix = document.createElement('span');
    prefix.textContent = 'dès';
    threshold.append(prefix);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.value = thresholds[site];
    input.dataset.site = site;
    input.className = 'threshold-input';
    input.disabled = !settings.enabled[site];
    threshold.append(input);

    const unit = document.createElement('em');
    unit.textContent = meta.unit === 'énergie' ? "d'énergie" : 'paquets';
    threshold.append(unit);

    row.append(threshold);
    container.append(row);
  }
}

async function saveSettings() {
  const stored = await chrome.storage.local.get('settings');
  const settings = readSettings(stored.settings);

  settings.notify = document.getElementById('notify').checked;

  for (const box of document.querySelectorAll('.enable')) {
    settings.enabled[box.dataset.site] = box.checked;
  }
  for (const input of document.querySelectorAll('.threshold-input')) {
    settings.thresholds[input.dataset.site] = Math.max(1, Number(input.value) || 1);
  }

  // Les seuils ayant changé, on réarme les notifications.
  await chrome.storage.local.set({ settings, notified: {} });
  chrome.runtime.sendMessage({ type: 'settings-changed' }, () => chrome.runtime.lastError);
  render();
}

document.getElementById('refresh').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Relevé…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'poll' });
    if (response && response.ok === false) {
      button.textContent = 'Échec';
      console.error('[TCG popup] poll a échoué :', response.error);
      setTimeout(() => {
        button.textContent = 'Actualiser';
      }, 1500);
    }
  } catch (error) {
    console.error('[TCG popup] service worker injoignable :', error.message);
    button.textContent = 'Échec';
    setTimeout(() => {
      button.textContent = 'Actualiser';
    }, 1500);
  }
  await render();
  button.disabled = false;
  if (button.textContent === 'Relevé…') button.textContent = 'Actualiser';
});

document.getElementById('notify').addEventListener('change', saveSettings);
document.getElementById('games').addEventListener('change', saveSettings);

// Les relevés arrivent parfois en rafale (content script + sondage) : on
// regroupe les rafraîchissements pour ne pas reconstruire le DOM plusieurs
// fois de suite pendant que la fenêtre est ouverte.
let refreshTimer = null;
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.readings) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(render, 120);
});

// L'affichage ne lit que le storage local : il n'attend jamais le service
// worker. C'est essentiel, car un service worker occupé par un relevé (qui peut
// durer une quinzaine de secondes, le temps qu'une page s'hydrate) met en file
// d'attente tout message qu'on lui envoie — y compris celui du popup suivant.
//
// Le relevé périodique est porté par les alarmes, pas par l'ouverture de la
// fenêtre : la projection comble l'intervalle, et le bouton Actualiser reste là
// pour forcer une lecture quand on la veut vraiment.
render();
