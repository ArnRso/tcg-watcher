// Vérifie le verrou de poll() : deux déclencheurs rapprochés (réouverture du
// popup, alarme) ne doivent jamais lancer deux relevés concurrents, sinon deux
// onglets s'ouvrent sur le même site et se gênent.
const checks = [];
const expect = (label, actual, wanted) => {
  const ok = actual === wanted;
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} → ${actual}${ok ? '' : ` (attendu ${wanted})`}`);
};

let running = 0;
let maxConcurrent = 0;
let started = 0;
const ignored = [];

let pollInFlight = null;

function poll(trigger) {
  if (pollInFlight) {
    ignored.push(trigger);
    return pollInFlight;
  }
  pollInFlight = runPoll().finally(() => {
    pollInFlight = null;
  });
  return pollInFlight;
}

async function runPoll() {
  started++;
  running++;
  maxConcurrent = Math.max(maxConcurrent, running);
  await new Promise((r) => setTimeout(r, 50));
  running--;
  return 'ok';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('— trois ouvertures rapprochées —');
  const a = poll('popup 1');
  const b = poll('popup 2');
  const c = poll('alarme');
  await Promise.all([a, b, c]);

  expect('un seul relevé lancé', started, 1);
  expect('jamais deux en parallèle', maxConcurrent, 1);
  expect('les deux autres sont ignorés', ignored.length, 2);
  expect('tous reçoivent le résultat', (await a) === 'ok' && (await b) === 'ok' && (await c) === 'ok', true);

  console.log('\n— le verrou se libère ensuite —');
  await sleep(10);
  await poll('plus tard');
  expect('un nouveau relevé est permis', started, 2);
  expect('toujours pas de parallélisme', maxConcurrent, 1);

  console.log('\n— un échec ne bloque pas le verrou —');
  pollInFlight = null;
  started = 0;
  const boom = () => {
    pollInFlight = Promise.reject(new Error('échec')).finally(() => {
      pollInFlight = null;
    });
    return pollInFlight;
  };
  await boom().catch(() => {});
  await sleep(10);
  await poll('après échec');
  expect('relevé possible après un échec', started, 1);

  console.log(checks.every(Boolean) ? '\nVerrou OK.' : `\n${checks.filter((c) => !c).length} échec(s)`);
  process.exit(checks.every(Boolean) ? 0 : 1);
})();
