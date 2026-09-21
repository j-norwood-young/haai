#!/usr/bin/env node
/**
 * `haai` bin shim — hard-gates the Node version, then hands every invocation
 * (including `serve`) to the bundled CLI.
 */
const MIN_NODE_MAJOR = 24;

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
  console.error(
    `HAAI requires Node.js ${MIN_NODE_MAJOR} or newer (found ${process.versions.node}).\n` +
      "Install the latest LTS from https://nodejs.org and try again.",
  );
  process.exit(1);
}

// import() takes a URL, not a path: on Windows fileURLToPath() yields `C:\…`, which the ESM loader rejects.
await import(new URL("../dist/cli.js", import.meta.url).href);
