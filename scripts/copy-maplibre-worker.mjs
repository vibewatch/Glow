// MapLibre 6 loads its tile worker from a URL next to the main module. Next bundles the main
// module, so that URL no longer resolves; serve the worker (and the chunk it imports) same-origin.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "maplibre-gl", "dist");
const target = join(root, "public", "maplibre");

mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(source, file), join(target, file));
}
