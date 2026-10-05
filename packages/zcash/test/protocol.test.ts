import { describe, expect, it } from 'vitest';
import {
  FrameReader,
  GrpcWebSource,
  checkTrailer,
  decodeBlockIdHeight,
  encodeBlockRange,
  encodeVarint,
  frame,
} from '../src/lightwalletd.js';

describe('protobuf helpers', () => {
  it('encodes varints like protobuf', () => {
    expect(encodeVarint(0)).toEqual([0]);
    expect(encodeVarint(127)).toEqual([127]);
    expect(encodeVarint(300)).toEqual([0xac, 0x02]);
    expect(encodeVarint(3_506_377)).toEqual([0xc9, 0x81, 0xd6, 0x01]);
    expect(() => encodeVarint(-1)).toThrow();
  });

  it('encodes a BlockRange and reads a BlockID height back', () => {
    const r = encodeBlockRange(1, 300);
    expect([...r]).toEqual([0x0a, 2, 0x08, 1, 0x12, 3, 0x08, 0xac, 0x02]);
    // BlockID with a hash (field 2) before the height.
    const id = new Uint8Array([0x12, 2, 0xaa, 0xbb, 0x08, 0xc9, 0x81, 0xd6, 0x01]);
    expect(decodeBlockIdHeight(id)).toBe(3_506_377);
  });
});

describe('gRPC-web framing', () => {
  const msg = (n: number) => new Uint8Array(n).fill(n);
  const trailerFrame = (text: string) => {
    const b = new TextEncoder().encode(text);
    const f = frame(b);
    f[0] = 0x80;
    return f;
  };

  it('reassembles messages split across chunks, then reads the trailer', () => {
    const body = new Uint8Array([...frame(msg(3)), ...frame(msg(200)), ...trailerFrame('grpc-status: 0\r\n')]);
    const r = new FrameReader();
    const got: Uint8Array[] = [];
    let trailer: string | undefined;
    for (let i = 0; i < body.length; i += 7) {
      const out = r.push(body.subarray(i, i + 7));
      got.push(...out.messages);
      trailer ??= out.trailer;
    }
    expect(got.map((m) => m.length)).toEqual([3, 200]);
    expect(trailer).toContain('grpc-status: 0');
    expect(r.pending).toBe(0);
  });

  it('turns a non-zero grpc-status into an error', () => {
    expect(() => checkTrailer('grpc-status: 0')).not.toThrow();
    expect(() => checkTrailer('grpc-status: 14\r\ngrpc-message: unavailable')).toThrow(/14: unavailable/);
  });

  it('streams blocks from a fake gRPC-web server in batches', async () => {
    const calls: Uint8Array[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      const req = new Uint8Array(init.body as ArrayBuffer).subarray(5);
      calls.push(req);
      const body = new Uint8Array([...frame(msg(1)), ...frame(msg(2)), ...trailerFrame('grpc-status: 0')]);
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;
    const src = new GrpcWebSource('https://example.invalid', fake, 2);
    const out: number[] = [];
    for await (const b of src.blocks(10, 13)) out.push(b.length);
    expect(out).toEqual([1, 2, 1, 2]);
    expect(calls.map((c) => [...c])).toEqual([[...encodeBlockRange(10, 11)], [...encodeBlockRange(12, 13)]]);
  });
});
