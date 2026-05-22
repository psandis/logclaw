import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export function readSource(file: string | undefined): string {
  if (file) return readFile(file);
  return readStdin();
}

export function readFile(file: string): string {
  const buf = readFileSync(file);
  return isGzip(buf, file) ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

export function isGzip(buf: Buffer, path?: string): boolean {
  if (path?.endsWith(".gz")) return true;
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function readStdin(): string {
  try {
    const buf = readFileSync(0);
    return isGzip(buf) ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  } catch {
    return "";
  }
}
