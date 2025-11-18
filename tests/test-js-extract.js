// Lightweight test harness for extractJsDependencies
const path = require('path');
const { extractJsDependencies } = require('../src/analysis/js');

async function run() {
  const monoRoot = path.resolve(__dirname, 'fixtures/js/mono');
  const simpleRoot = path.resolve(__dirname, 'fixtures/js/simple');

  const monoDeps = await extractJsDependencies(monoRoot, { includeDev: true });
  const simpleDeps = await extractJsDependencies(simpleRoot, { includeDev: false });

  console.log('[mono] deps count:', monoDeps.length);
  console.log('[mono] sample:', monoDeps);
  console.log('[simple] deps count:', simpleDeps.length);
  console.log('[simple] sample:', simpleDeps);
}
run().catch(e => { console.error(e); process.exit(1); });

