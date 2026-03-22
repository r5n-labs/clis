export function compress(data: Buffer): Buffer {
  return Buffer.from(Bun.gzipSync(new Uint8Array(data)));
}

export function decompress(data: Buffer): Buffer {
  return Buffer.from(Bun.gunzipSync(new Uint8Array(data)));
}
