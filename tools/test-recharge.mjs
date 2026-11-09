// Vérifie l'apprentissage de la cadence à partir de deux relevés réels successifs.
import { createRequire } from 'node:module';
const { learnRecharge } = createRequire(import.meta.url)('../src/shared/state.js');

const checks = [];
const expect = (label, actual, wanted) => {
  const ok = actual === wanted;
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} → ${actual}${ok ? '' : ` (attendu ${wanted})`}`);
};

const T = 1_000_000_000_000;
const make = (available, atMinutes, extra = {}) => ({
  site: 'wikimasters',
  available,
  capacity: 10,
  readAt: T + atMinutes * 60_000,
  rechargeSeconds: 600,
  ...extra
});

console.log('— mesure —');
expect('gain de 2 en 20 min → 600 s', learnRecharge(make(1, 0), make(3, 20)), 600);
expect('gain de 3 en 36 min → 720 s', learnRecharge(make(0, 0), make(3, 36)), 720);
expect('gain de 1 en 11 min → 660 s', learnRecharge(make(2, 0), make(3, 11)), 660);

console.log('\n— intervalle trop court pour conclure —');
// Le gain vient d'un cycle commencé avant le premier relevé : diviser le délai
// observé par ce gain donne une cadence trop courte (le bug des « 231 s »).
expect('gain de 1 en 9 min, cycle de 10 min', learnRecharge(make(2, 0), make(3, 9)), 600);
expect('gain de 1 en 1 min', learnRecharge(make(2, 0), make(3, 1)), 600);
expect('gain de 2 en 4 min', learnRecharge(make(1, 0), make(3, 4)), 600);

console.log('\n— cas où l’on garde la valeur courante —');
expect('aucun relevé précédent', learnRecharge(null, make(3, 9)), 600);
expect('précédent projeté, non mesurable', learnRecharge(make(2, 0, { estimated: true }), make(3, 9)), 600);
expect('aucun gain', learnRecharge(make(3, 0), make(3, 9)), 600);
expect('consommation (gain négatif)', learnRecharge(make(5, 0), make(2, 9)), 600);
expect('arrivé au plafond : délai faussé', learnRecharge(make(9, 0), make(10, 90)), 600);

console.log('\n— garde-fous de plausibilité —');
expect('trop rapide (<1 min) rejeté', learnRecharge(make(2, 0), make(3, 0.5)), 600);
expect('trop lent (>60 min) rejeté', learnRecharge(make(2, 0), make(3, 75)), 600);

console.log(checks.every(Boolean) ? '\nCadence OK.' : `\n${checks.filter((c) => !c).length} échec(s)`);
process.exit(checks.every(Boolean) ? 0 : 1);
