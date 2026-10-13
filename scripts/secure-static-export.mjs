import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function secureDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await secureDirectory(filename);
    } else if (entry.name.endsWith(".html")) {
      const html = await readFile(filename, "utf8");
      const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
        .filter((match) => !/\bsrc\s*=/.test(match[1]) && match[2])
        .map((match) => `'sha256-${createHash("sha256").update(match[2]).digest("base64")}'`);
      const policy = [
        "default-src 'self'",
        `script-src 'self' https://www.googletagmanager.com ${[...new Set(hashes)].join(" ")}`,
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");
      if (!html.includes("<head>")) throw new Error(`Missing document head: ${filename}`);
      await writeFile(filename, html.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${policy}"/><meta name="referrer" content="strict-origin-when-cross-origin"/>`));
    }
  }
}

await secureDirectory(path.resolve("out"));
