import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/** Read a file, or all of stdin when no file is given. Gzip input is decompressed. */
export async function readSource(file: string | undefined): Promise<string> {
  if (file) return readFile(file);
  return decode(await readStdin());
}

export function readFile(file: string): string {
  const buf = readFileSync(file);
  return isGzip(buf, file) ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

export function isGzip(buf: Buffer, path?: string): boolean {
  if (path?.endsWith(".gz")) return true;
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function decode(buf: Buffer): string {
  return isGzip(buf) ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
}

/**
 * Read stdin as a stream until it ends. A single synchronous read fails with
 * EAGAIN when the writing program (for example `log show`) has not produced
 * output yet, so streaming is required for pipes.
 */
async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read from stdin: ${reason}`);
  }
  return Buffer.concat(chunks);
}
