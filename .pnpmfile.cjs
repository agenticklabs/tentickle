const fs = require("fs");
const path = require("path");

const AGENTICK_ROOT = path.join(__dirname, "..", "agentick");
const useLocal = fs.existsSync(path.join(AGENTICK_ROOT, "package.json"));

// Absolute paths — readPackage runs in each workspace package's context,
// so relative paths would resolve from the wrong directory.
const LOCAL_OVERRIDES = useLocal
  ? {
      "agentick": `link:${AGENTICK_ROOT}/packages/agentick`,
      "@agentick/agent": `link:${AGENTICK_ROOT}/packages/agent`,
      "@agentick/apple": `link:${AGENTICK_ROOT}/packages/adapters/apple`,
      "@agentick/client": `link:${AGENTICK_ROOT}/packages/client`,
      "@agentick/connector": `link:${AGENTICK_ROOT}/packages/connector`,
      "@agentick/connector-imessage": `link:${AGENTICK_ROOT}/packages/connector-imessage`,
      "@agentick/connector-telegram": `link:${AGENTICK_ROOT}/packages/connector-telegram`,
      "@agentick/core": `link:${AGENTICK_ROOT}/packages/core`,
      "@agentick/devtools": `link:${AGENTICK_ROOT}/packages/devtools`,
      "@agentick/google": `link:${AGENTICK_ROOT}/packages/adapters/google`,
      "@agentick/kernel": `link:${AGENTICK_ROOT}/packages/kernel`,
      "@agentick/openai": `link:${AGENTICK_ROOT}/packages/adapters/openai`,
      "@agentick/react": `link:${AGENTICK_ROOT}/packages/react`,
      "@agentick/sandbox": `link:${AGENTICK_ROOT}/packages/sandbox`,
      "@agentick/sandbox-local": `link:${AGENTICK_ROOT}/packages/sandbox-local`,
      "@agentick/scheduler": `link:${AGENTICK_ROOT}/packages/scheduler`,
      "@agentick/shared": `link:${AGENTICK_ROOT}/packages/shared`,
      "@agentick/tui": `link:${AGENTICK_ROOT}/packages/tui`,
    }
  : {};

function readPackage(pkg) {
  if (!useLocal) return pkg;

  for (const [name, target] of Object.entries(LOCAL_OVERRIDES)) {
    if (pkg.dependencies?.[name]) {
      pkg.dependencies[name] = target;
    }
    if (pkg.devDependencies?.[name]) {
      pkg.devDependencies[name] = target;
    }
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
