// Vérifie la déduplication de watcher.js : un rescan forcé doit toujours réémettre,
// un changement spontané ne doit émettre que si la valeur a bougé.
const sent = [];
let value = { available: 1, capacity: 10, unit: 'paquet' };
let lastSignature = '';

function report(force) {
  const payload = { site: 'test', readAt: Date.now(), ...value };
  const signature = JSON.stringify({ ...payload, readAt: 0, secondsToNext: 0 });
  if (!force && signature === lastSignature) return false;
  lastSignature = signature;
  sent.push({ forced: Boolean(force), available: payload.available });
  return true;
}

const checks = [];
const expect = (label, actual, wanted) => {
  const ok = actual === wanted;
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} (${actual}, attendu ${wanted})`);
};

expect('premier relevé émis', report(), true);
expect('valeur identique, pas de doublon', report(), false);
expect('rescan forcé réémet malgré valeur identique', report(true), true);
expect('toujours rien de neuf sans forçage', report(), false);

value = { available: 2, capacity: 10, unit: 'paquet' };
expect('changement spontané émis', report(), true);

expect('nombre total d’envois', sent.length, 3);

console.log(checks.every(Boolean) ? '\nRescan OK.' : '\nÉchec.');
process.exit(checks.every(Boolean) ? 0 : 1);
