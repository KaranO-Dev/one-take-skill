// Minimal WAV read/write. Stereo buffers are { sr, L: Float32Array, R: Float32Array }.
import { readFileSync, writeFileSync } from 'node:fs';

export function stereo(sr, seconds) {
  const n = Math.ceil(sr * seconds);
  return { sr, L: new Float32Array(n), R: new Float32Array(n) };
}

// bits: 16 | 24 (PCM) or 32 (float)
export function writeWav(path, buf, bits = 24) {
  const { sr, L, R } = buf;
  const n = L.length, ch = 2, bps = bits / 8;
  const data = Buffer.alloc(n * ch * bps);
  const fmt = bits === 32 ? 3 : 1;
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (const v of [L[i], R[i]]) {
      const s = Math.max(-1, Math.min(1, v));
      if (bits === 32) data.writeFloatLE(v, o);
      else if (bits === 24) { const x = Math.round(s * 8388607); data.writeIntLE(x, o, 3); }
      else data.writeInt16LE(Math.round(s * 32767), o);
      o += bps;
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(fmt, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * ch * bps, 28); h.writeUInt16LE(ch * bps, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${path}: not a WAV file`);
  let p = 12, fmt, ch, sr, bits, data;
  while (p < b.length - 8) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(p + 8); ch = b.readUInt16LE(p + 10); sr = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); if (fmt === 0xfffe) fmt = b.readUInt16LE(p + 32); }
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  const bps = bits / 8, n = Math.floor(data.length / (bps * ch));
  const out = { sr, L: new Float32Array(n), R: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 2; c++) {
      const o = (i * ch + Math.min(c, ch - 1)) * bps;
      let v;
      if (fmt === 3) v = bits === 64 ? data.readDoubleLE(o) : data.readFloatLE(o);
      else if (bits === 16) v = data.readInt16LE(o) / 32768;
      else if (bits === 24) v = data.readIntLE(o, 3) / 8388608;
      else v = data.readInt32LE(o) / 2147483648;
      (c ? out.R : out.L)[i] = v;
    }
  }
  return out;
}
