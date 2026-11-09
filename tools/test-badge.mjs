// Vérifie la couleur et le total du badge : vert seulement quand TOUS les jeux
// suivis ont atteint leur seuil, rouge sinon, gris quand il n'y a rien à dire.
import { createRequire } from 'node:module';
const { BADGE_IDLE, BADGE_READY, BADGE_WAITING, badgeState, readSettings } =
  createRequire(import.meta.url)('../src/shared/state.js');

const checks = [];
const expect = (label, actual, wanted) => {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} → ${JSON.stringify(actual)}${ok ? '' : ` (attendu ${JSON.stringify(wanted)})`}`);
};

const name = (color) =>
  ({ [BADGE_READY]: 'vert', [BADGE_WAITING]: 'rouge', [BADGE_IDLE]: 'gris' })[color] || color;

const reading = (available, capacity = 10) => ({ available, capacity, readAt: Date.now() });
const settings = (over = {}) => readSettings({ thresholds: { wikimasters: 1, holopocket: 10 }, ...over });

const state = (readings, over) => {
  const r = badgeState(readings, settings(over));
  return { text: r.text, couleur: name(r.color) };
};

console.log('— les deux jeux suivis —');
expect('aucun seuil atteint', state({ wikimasters: reading(0), holopocket: reading(3) }), { text: '3', couleur: 'rouge' });
expect('un seul seuil atteint', state({ wikimasters: reading(2), holopocket: reading(4) }), { text: '6', couleur: 'rouge' });
expect('les deux seuils atteints', state({ wikimasters: reading(1), holopocket: reading(10) }), { text: '11', couleur: 'vert' });
expect('largement au-dessus', state({ wikimasters: reading(5), holopocket: reading(10) }), { text: '15', couleur: 'vert' });

console.log('\n— un relevé manquant —');
expect('holopocket inconnu → pas vert', state({ wikimasters: reading(5) }), { text: '5', couleur: 'rouge' });
expect('aucun relevé → gris', state({}), { text: '', couleur: 'gris' });

console.log('\n— jeu désactivé —');
const sansHolo = { enabled: { wikimasters: true, holopocket: false } };
expect('seuil wikimasters atteint, holo ignoré', state({ wikimasters: reading(1), holopocket: reading(0) }, sansHolo), { text: '1', couleur: 'vert' });
expect('total exclut le jeu désactivé', state({ wikimasters: reading(4), holopocket: reading(9) }, sansHolo), { text: '4', couleur: 'vert' });
expect('seuil non atteint sur le seul jeu actif', state({ wikimasters: reading(0), holopocket: reading(10) }, sansHolo), { text: '0', couleur: 'rouge' });

console.log('\n— aucun jeu suivi —');
const aucun = { enabled: { wikimasters: false, holopocket: false } };
expect('badge vide', state({ wikimasters: reading(5), holopocket: reading(10) }, aucun), { text: '', couleur: 'gris' });

console.log('\n— seuils personnalisés —');
const exigeant = { thresholds: { wikimasters: 5, holopocket: 10 } };
expect('sous le seuil relevé', state({ wikimasters: reading(4), holopocket: reading(10) }, exigeant), { text: '14', couleur: 'rouge' });
expect('pile au seuil', state({ wikimasters: reading(5), holopocket: reading(10) }, exigeant), { text: '15', couleur: 'vert' });

console.log(checks.every(Boolean) ? '\nBadge OK.' : `\n${checks.filter((c) => !c).length} échec(s)`);
process.exit(checks.every(Boolean) ? 0 : 1);
