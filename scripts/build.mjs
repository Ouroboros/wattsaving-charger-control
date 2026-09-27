import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
let sha = process.env.GITHUB_SHA ?? "";
if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
  try { sha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { sha = ""; }
}
const revision = /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : "unknown";
const builtAt = new Date().toISOString();
await build({
  absWorkingDir: root,
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "app.js",
  define: {
    __BUILD_VERSION__: JSON.stringify(version),
    __BUILD_REVISION__: JSON.stringify(revision),
    __BUILD_TIME__: JSON.stringify(builtAt)
  }
});
console.log(`Built v${version} ${revision}; build time embedded for local-time display.`);
