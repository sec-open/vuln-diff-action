const core = require('@actions/core');
const { phase1 } = require('./analysis/orchestrator');

// 👉 Añadido: exportamos phase2 desde su orquestador real
const { phase2 } = require('./normalization/orchestrator');

module.exports = { phase1, phase2 };

// Comportamiento por defecto INALTERADO: ejecutar solo Fase 1 si se invoca directamente
if (require.main === module) {
  phase1().catch((err) => {
    core.setFailed(err.message || String(err));
  });
}
