// Vérifie la projection : elle doit monter avec le temps, se plafonner à la capacité,
// et ne jamais inventer une baisse (une consommation sur un autre appareil est invisible
// et ne sera corrigée qu'au prochain relevé réel).
import { createRequire } from 'node:module';
const { project } = createRequire(import.meta.url)('../src/shared/state.js');

const checks = [];
const expect = (label, actual, wanted) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} → ${JSON.stringify(actual)}${ok ? '' : ` (attendu ${JSON.stringify(wanted)})`}`);
};

const T0 = 1_000_000_000_000;
const base = {
  available: 1,
  capacity: 10,
  readAt: T0,
  secondsToNext: 300, // 5 min avant le prochain
  rechargeSeconds: 600 // puis 1 toutes les 10 min
};
const at = (minutes) => project(base, T0 + minutes * 60_000);

console.log('— progression dans le temps —');
expect('t+0 : inchangé', at(0).available, 1);
expect('t+4 min : pas encore', at(4).available, 1);
expect('t+5 min : +1', at(5).available, 2);
expect('t+14 min : toujours 2', at(14).available, 2);
expect('t+15 min : +1 de plus', at(15).available, 3);
expect('t+25 min : +1 encore', at(25).available, 4);

console.log('\n— plafond —');
expect('t+10 h : plafonné à la capacité', at(600).available, 10);
expect('plus de compte à rebours une fois plein', at(600).secondsToNext, null);
expect('déjà plein : inchangé', project({ ...base, available: 10 }, T0 + 9e6).available, 10);

console.log('\n— marquage —');
expect('non marqué avant le premier gain', Boolean(at(4).estimated), false);
expect('marqué dès qu’on extrapole', at(5).estimated, true);

console.log('\n— compte à rebours décrémenté —');
expect('t+2 min : 180 s restantes', at(2).secondsToNext, 180);
expect('t+5 min : repart sur la cadence', at(5).secondsToNext, 600);

console.log('\n— données insuffisantes : on ne projette pas —');
expect('sans rechargeSeconds', project({ ...base, rechargeSeconds: null }, T0 + 9e6).available, 1);
expect('sans secondsToNext', project({ ...base, secondsToNext: null }, T0 + 9e6).available, 1);

console.log('\n— jamais décroissant —');
const series = [0, 3, 7, 11, 30, 120].map((m) => at(m).available);
const monotone = series.every((v, i) => i === 0 || v >= series[i - 1]);
expect('la suite ne baisse jamais', monotone, true);
console.log(`       série observée : ${series.join(' → ')}`);

console.log(checks.every(Boolean) ? '\nProjection OK.' : `\n${checks.filter((c) => !c).length} échec(s)`);
process.exit(checks.every(Boolean) ? 0 : 1);
