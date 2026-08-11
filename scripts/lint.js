#!/usr/bin/env node
// Runs every linter and prints a compact per-tool result. On success only a
// green check is shown; on failure the relevant error output is printed.

import { spawnSync } from "node:child_process";
import path from "node:path";
import pc from "picocolors";

const root = path.resolve(import.meta.dirname, "..");

/** @param {string} name @returns {string} */
const bin = (name) => path.join(root, "node_modules", ".bin", name);

// Strip markdownlint-cli2 banner/summary noise and prettier's status header.
const NOISE = /^(markdownlint-cli2 v|Finding:|Linting:|Summary:|Checking formatting\.\.\.)/;

/** @param {string} text @returns {string} */
function clean(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !NOISE.test(line))
    .join("\n");
}

/** @type {Array<{label: string, cmd: string, args: string[]}>} */
const steps = [
  { label: "Editorconfig", cmd: bin("editorconfig-checker"), args: [] },
  { label: "ESLint", cmd: bin("eslint"), args: [".", "--max-warnings", "0"] },
  {
    label: "Markdown",
    cmd: bin("markdownlint-cli2"),
    args: ["--config", ".markdownlint-cli2.jsonc", "**/*.md", "#node_modules"],
  },
  { label: "Prettier", cmd: bin("prettier"), args: ["--check", ".", "--ignore-path", ".gitignore"] },
  { label: "Shell", cmd: bin("shellcheck"), args: [".husky/pre-commit"] },
  { label: "TypeScript", cmd: bin("tsc"), args: ["-p", "tsconfig.check.json"] },
  { label: "Tests", cmd: "npm", args: ["test"] },
];

console.log(pc.bold("Lint"));
let failed = false;
for (const step of steps) {
  const res = /** @type {import("node:child_process").SpawnSyncReturns<string>} */ (
    spawnSync(step.cmd, step.args, { cwd: root, encoding: "utf8" })
  );
  const output = clean(`${res.stdout}${res.stderr}`);
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
