// Root entry; export phase1() and allow direct invocation in Actions
const core = require('@actions/core');
const { phase1 } = require('./src/analysis/orchestrator');

// Only export; runner workflow should call this
module.exports = {
  phase1,
};

// Optional: if used as main action (composite->node), run now
if (require.main === module) {
  phase1().catch((err) => {
    core.setFailed(err.message || String(err));
  });
}
