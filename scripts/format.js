#!/usr/bin/env node
// Runs the formatters and prints a compact per-tool result. On success only a
// green check is shown; on failure the relevant output is printed.

import { spawnSync } from "node:child_process";
import path from "node:path";
import pc from "picocolors";

const root = path.resolve(import.meta.dirname, "..");

/** @param {string} name @returns {string} */
const bin = (name) => path.join(root, "node_modules", ".bin", name);

/** @type {Array<{label: string, cmd: string, args: string[]}>} */
const steps = [
  { label: "ESLint", cmd: bin("eslint"), args: [".", "--fix", "--max-warnings", "0"] },
  { label: "Prettier", cmd: bin("prettier"), args: ["--write", "--log-level", "warn", "."] },
];

console.log(pc.bold("Format"));
let failed = false;
for (const step of steps) {
  const res = /** @type {import("node:child_process").SpawnSyncReturns<string>} */ (
    spawnSync(step.cmd, step.args, { cwd: root, encoding: "utf8" })
  );
  const output = `${res.stdout}${res.stderr}`.trim();
  if (res.status === 0) {
    console.log(`  ${pc.green("✔")} ${step.label}`);
  } else {
    failed = true;
    console.log(`  ${pc.red("✖")} ${step.label}`);
    if (output) {
      console.log(indent(output));
    }
  }
}
console.log(failed ? pc.red("Failed") : pc.green("Passed"));
process.exit(failed ? 1 : 0);

/** @param {string} text @returns {string} */
function indent(text) {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
