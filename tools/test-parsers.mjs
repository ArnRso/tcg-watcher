// Vérifie les helpers de watcher.js : compte à rebours et décision de relevé par onglet.
const checks = [];
const expect = (label, actual, wanted) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} → ${JSON.stringify(actual)}${ok ? '' : ` (attendu ${JSON.stringify(wanted)})`}`);
};

function parseCountdown(text) {
  const hours = text.match(/(\d+)\s*h(?:\s*(\d+))?/i);
  if (hours) return Number(hours[1]) * 3600 + Number(hours[2] || 0) * 60;
  const clock = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (clock) {
    if (clock[3] !== undefined) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    return Number(clock[1]) * 60 + Number(clock[2]);
  }
  const minutes = text.match(/(\d+)\s*min/i);
  if (minutes) return Number(minutes[1]) * 60;
  return null;
}

console.log('— compte à rebours —');
expect('"3:11"', parseCountdown('3:11'), 191);
expect('"5:01"', parseCountdown('5:01'), 301);
expect('"1 h 35"', parseCountdown('1 h 35'), 5700);
expect('"2 h"', parseCountdown('2 h'), 7200);
expect('"45 min"', parseCountdown('45 min'), 2700);
expect('texte sans durée', parseCountdown('bientôt'), null);

// Extraction depuis le texte agrégé des blocs, comme le font les deux lecteurs.
console.log('\n— extraction des compteurs —');
const wiki = (blockText) => {
  const f = blockText.match(/(\d+)\s*\/\s*(\d+)/);
  return f ? { available: Number(f[1]), capacity: Number(f[2]) } : null;
};
expect('WikiMasters "1 / 10paquets disponibles"', wiki('1 / 10paquets disponiblesProchain dans 8:56'), { available: 1, capacity: 10 });
expect('WikiMasters plein', wiki('10 / 10paquets disponibles'), { available: 10, capacity: 10 });

const holo = (labelText) => {
  const c = labelText.match(/\/\s*(\d+)/);
  return c ? Number(c[1]) : null;
};
expect("HoloPocket capacité depuis \"/ 10 d'énergie\"", holo("/ 10 d'énergie"), 10);
expect('HoloPocket apostrophe typographique', holo('/ 10 d’énergie'), 10);

// Fraîcheur : un relevé récent ne doit pas déclencher d'onglet sur l'alarme.
console.log('\n— ouverture d’onglet discret —');
const MIN_AGE = 4 * 60 * 1000;
const needsTab = (trigger, ageMs) => !(trigger === 'alarme' && ageMs < MIN_AGE);
expect('alarme + relevé de 30 s → pas d’onglet', needsTab('alarme', 30_000), false);
expect('alarme + relevé de 10 min → onglet', needsTab('alarme', 600_000), true);
expect('clic popup + relevé de 30 s → onglet quand même', needsTab('popup', 30_000), true);
expect('aucun relevé → onglet', needsTab('alarme', Infinity), true);

console.log(checks.every(Boolean) ? '\nTous les tests passent.' : `\n${checks.filter((c) => !c).length} échec(s)`);
process.exit(checks.every(Boolean) ? 0 : 1);
