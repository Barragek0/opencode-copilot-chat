import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const testRoot = resolve("out", "test");
const testFiles = collectTests(testRoot);

if (testFiles.length === 0) {
  console.error(`No compiled tests found under ${testRoot}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

/**
 * Recursively collect compiled `*.test.js` files under a directory.
 */
function collectTests(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return collectTests(path);
      return entry.isFile() && entry.name.endsWith(".test.js") ? [path] : [];
    });
}
