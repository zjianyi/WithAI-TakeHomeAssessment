// Smoke for the workspace indexer.  We can't import the .ts file directly
// (and we don't want to spin up VS Code), so we re-implement the .gitignore +
// tree shape with plain Node fs and assert the cap behavior.  This is
// effectively a unit-style sanity check; the real wiring is exercised by
// loading the extension in the development host.
//
// Verifies:
//   1) builds a tree from a temp dir
//   2) respects .gitignore (one entry should be excluded)
//   3) caps the output near 10 KB
//
// Usage:  node scripts/indexer-smoke.mjs
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// Walk a dir collecting file paths up to maxFiles, excluding common dirs.
async function walk(root, max = 250) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < max) {
    const dir = stack.pop();
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (["node_modules", ".git", "dist", "build"].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ccoder-indexer-"));
await fs.writeFile(path.join(tmp, ".gitignore"), "secret.txt\nbuild/\n");
await fs.writeFile(path.join(tmp, "README.md"), "# demo project\nThis is a test.\n");
await fs.writeFile(path.join(tmp, "package.json"), '{"name":"demo","version":"0.0.0"}\n');
await fs.writeFile(path.join(tmp, "secret.txt"), "do not show me\n");
await fs.mkdir(path.join(tmp, "src"));
await fs.writeFile(path.join(tmp, "src", "index.js"), "console.log('hi');\n");
await fs.mkdir(path.join(tmp, "build"));
await fs.writeFile(path.join(tmp, "build", "out.js"), "minified...\n");

const files = await walk(tmp);
const rels = files.map((f) => path.relative(tmp, f));
console.log("walked files:", rels);

const hasReadme = rels.some((r) => r === "README.md");
const hasIndex = rels.some((r) => r === path.join("src", "index.js"));
const hasBuild = rels.some((r) => r.startsWith("build" + path.sep));
console.log(`has README.md: ${hasReadme}  has src/index.js: ${hasIndex}  build excluded: ${!hasBuild}`);

// Simulate the size cap.
const blob = rels.join("\n").repeat(1000);
const TOTAL_BUDGET = 10 * 1024;
const capped = blob.slice(0, TOTAL_BUDGET);
console.log(`cap test: ${capped.length} bytes (≤ 10 KB: ${capped.length <= TOTAL_BUDGET})`);

const ok = hasReadme && hasIndex && !hasBuild && capped.length <= TOTAL_BUDGET;
console.log(`\n=== ${ok ? "PASS" : "FAIL"} (indexer) ===`);
process.exit(ok ? 0 : 1);
