import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  for (const name of [".env", ".env.local"]) {
    const path = join(process.cwd(), name);
    if (!existsSync(path)) continue;

    const source = readFileSync(path, "utf8");
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;

      const key = match[1];
      if (!key) continue;
      let value = match[2] ?? "";

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}
