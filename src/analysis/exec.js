// Process execution utilities: spawn commands capturing stdout/stderr; portable which helper.
const { spawn } = require('child_process');

// Executes a command and returns a promise resolving with { stdout, stderr, code } or rejecting on non-zero exit.
function execCmd(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(Object.assign(new Error(`Command failed: ${cmd} ${args.join(' ')}\n${stderr}`), { code, stdout, stderr }));
    });
  });
}

// Locates a command in PATH (first match); returns null if not found.
async function which(command) {
  try {
    const { stdout } = await execCmd(process.platform === 'win32' ? 'where' : 'which', [command]);
    return stdout.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

module.exports = { execCmd, which };
