const core = require('@actions/core');
const { phase1 } = require('./src/analysis/orchestrator');

module.exports = { phase1 };

if (require.main === module) {
  phase1().catch((err) => {
    core.setFailed(err.message || String(err));
  });
}
