import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const release = join(root, "..", "release");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await mkdir(release, { recursive: true });

await build({
  entryPoints: [join(root, "src", "bootstrap.ts")],
  bundle: true,
  outfile: join(dist, "bootstrap.js"),
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: false
});

await build({
  entryPoints: [join(root, "src", "widget.ts")],
  bundle: true,
  outfile: join(dist, "widget.js"),
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: false
});

await Promise.all([
  copyFile(join(root, "src", "dashboard.html"), join(dist, "dashboard.html")),
  copyFile(join(root, "src", "widget.html"), join(dist, "widget.html")),
  copyFile(join(root, "src", "widget.css"), join(dist, "widget.css")),
  copyFile(join(root, "..", "C4143-DV-SIT-Dashboard.user.js"), join(dist, "C4143-DV-SIT-Dashboard.user.js"))
]);
