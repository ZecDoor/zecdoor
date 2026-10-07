// Minimal client for the lightwalletd `CompactTxStreamer` service over gRPC-web (binary),
// using only `fetch`. Only the calls ZecDoor needs: GetLatestBlock, GetBlockRange, and GetTransaction
// (for the public proof page).
// Protocol: https://github.com/zcash/lightwallet-protocol (service.proto, compact_formats.proto).

const SERVICE = '/cash.z.wallet.sdk.rpc.CompactTxStreamer/';

/** Where compact blocks come from. Browser: `GrpcWebSource`. Tests may use plain gRPC. */
export interface BlockSource {
  latestHeight(signal?: AbortSignal): Promise<number>;
  /** Serialized `CompactBlock` messages for heights `start..=end`, in order. */
  blocks(start: number, end: number, signal?: AbortSignal): AsyncIterable<Uint8Array>;
}

// ---- protobuf: just enough for BlockID / BlockRange ----

export function encodeVarint(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`bad varint ${value}`);
  const out: number[] = [];
  let n = BigInt(value);
  while (n > 127n) {
    out.push(Number(n & 127n) | 128);
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}

function decodeVarint(bytes: Uint8Array, at: number): [number, number] {
  let result = 0n;
  let shift = 0n;
  for (let i = at; i < bytes.length; i++) {
    const b = bytes[i]!;
    result |= BigInt(b & 127) << shift;
    if (b < 128) return [Number(result), i + 1];
    shift += 7n;
  }
  throw new Error('truncated varint');
}

/** `BlockID { uint64 height = 1; }` */
export function encodeBlockId(height: number): number[] {
  return [0x08, ...encodeVarint(height)];
}

/** `BlockRange { BlockID start = 1; BlockID end = 2; }` */
export function encodeBlockRange(start: number, end: number): Uint8Array {
  const s = encodeBlockId(start);
  const e = encodeBlockId(end);
  return new Uint8Array([0x0a, s.length, ...s, 0x12, e.length, ...e]);
}

/** Reads `height` (field 1, varint) from a `BlockID`. */
export function decodeBlockIdHeight(msg: Uint8Array): number {
  let i = 0;
  while (i < msg.length) {
    const [key, next] = decodeVarint(msg, i);
    i = next;
    const field = key >> 3;
    const wire = key & 7;
    if (field === 1 && wire === 0) return decodeVarint(msg, i)[0];
    if (wire === 0) i = decodeVarint(msg, i)[1];
    else if (wire === 2) {
      const [len, after] = decodeVarint(msg, i);
      i = after + len;
    } else throw new Error(`unexpected wire type ${wire}`);
  }
  throw new Error('BlockID has no height');
}

/**
 * `TxFilter { bytes hash = 3; }` for a transaction ID as explorers and NEAR Intents show it. lightwalletd
 * wants the bytes in internal order, which is the reverse of that hex (checked on mainnet, 7 Oct 2026: the
 * display order is "not found", the reversed order returns the transaction).
 */
export function encodeTxFilter(txid: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error('not a transaction ID');
  const bytes = txid.match(/../g)!.map((b) => parseInt(b, 16)).reverse();
  return new Uint8Array([0x1a, 32, ...bytes]);
}

/** Reads `height` (field 2, varint) from a `RawTransaction { bytes data = 1; uint64 height = 2; }`. */
export function decodeRawTxHeight(msg: Uint8Array): number {
  let i = 0;
  while (i < msg.length) {
    const [key, next] = decodeVarint(msg, i);
    i = next;
    const field = key >> 3;
    const wire = key & 7;
    if (field === 2 && wire === 0) return decodeVarint(msg, i)[0];
    if (wire === 0) i = decodeVarint(msg, i)[1];
    else if (wire === 2) {
      const [len, after] = decodeVarint(msg, i);
      i = after + len;
    } else throw new Error(`unexpected wire type ${wire}`);
  }
  throw new Error('RawTransaction has no height');
}

// ---- gRPC-web framing ----

export function frame(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + message.length);
  new DataView(out.buffer).setUint32(1, message.length);
  out.set(message, 5);
  return out;
}

/** Splits a gRPC-web response body into messages, across arbitrary chunk boundaries. */
export class FrameReader {
  private buf = new Uint8Array(0);

  push(chunk: Uint8Array): { messages: Uint8Array[]; trailer?: string } {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    const messages: Uint8Array[] = [];
    let trailer: string | undefined;
    while (this.buf.length >= 5) {
      const len = new DataView(this.buf.buffer, this.buf.byteOffset + 1, 4).getUint32(0);
      if (this.buf.length < 5 + len) break;
      const flag = this.buf[0]!;
      const body = this.buf.slice(5, 5 + len);
      this.buf = this.buf.slice(5 + len);
      if (flag & 0x80) trailer = new TextDecoder().decode(body);
      else messages.push(body);
    }
    return trailer === undefined ? { messages } : { messages, trailer };
  }

  get pending(): number {
    return this.buf.length;
  }
}

export function checkTrailer(trailer: string): void {
  const status = /grpc-status:\s*(\d+)/i.exec(trailer)?.[1];
  if (status !== undefined && status !== '0') {
    const msg = /grpc-message:\s*(.*)/i.exec(trailer)?.[1]?.trim() ?? '';
    throw new Error(`lightwalletd error ${status}${msg ? `: ${decodeURIComponent(msg)}` : ''}`);
  }
}

export class GrpcWebSource implements BlockSource {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    /** Heights per GetBlockRange call. */
    private readonly batch = 400,
  ) {}

  private async call(method: string, message: Uint8Array, signal?: AbortSignal): Promise<Response> {
    const res = await this.fetchImpl(this.base + SERVICE + method, {
      method: 'POST',
      body: frame(message) as BodyInit,
      headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`lightwalletd HTTP ${res.status}`);
    const headerStatus = res.headers.get('grpc-status');
    if (headerStatus && headerStatus !== '0') {
      checkTrailer(`grpc-status: ${headerStatus}\r\ngrpc-message: ${res.headers.get('grpc-message') ?? ''}`);
    }
    return res;
  }

  async latestHeight(signal?: AbortSignal): Promise<number> {
    const res = await this.call('GetLatestBlock', new Uint8Array(0), signal);
    const reader = new FrameReader();
    const { messages, trailer } = reader.push(new Uint8Array(await res.arrayBuffer()));
    if (trailer) checkTrailer(trailer);
    const first = messages[0];
    if (!first) throw new Error('GetLatestBlock returned nothing');
    return decodeBlockIdHeight(first);
  }

  /** The height of the block holding `txid` (explorer byte order), or null if lightwalletd does not know it. */
  async transactionHeight(txid: string, signal?: AbortSignal): Promise<number | null> {
    let res: Response;
    try {
      res = await this.call('GetTransaction', encodeTxFilter(txid), signal);
    } catch (e) {
      if (/lightwalletd error 5\b/.test((e as Error).message)) return null;
      throw e;
    }
    const { messages, trailer } = new FrameReader().push(new Uint8Array(await res.arrayBuffer()));
    if (trailer) checkTrailer(trailer);
    const first = messages[0];
    if (!first) return null;
    const h = decodeRawTxHeight(first);
    return h > 0 ? h : null;
  }

  async *blocks(start: number, end: number, signal?: AbortSignal): AsyncIterable<Uint8Array> {
    for (let from = start; from <= end; from += this.batch) {
      const to = Math.min(end, from + this.batch - 1);
      const res = await this.call('GetBlockRange', encodeBlockRange(from, to), signal);
      const reader = new FrameReader();
      const body = res.body;
      if (!body) throw new Error('no response body');
      const it = body.getReader();
      for (;;) {
        const { done, value } = await it.read();
        if (done) break;
        const { messages, trailer } = reader.push(value);
        for (const m of messages) yield m;
        if (trailer) checkTrailer(trailer);
      }
      if (reader.pending) throw new Error('lightwalletd response ended mid-message');
    }
  }
}
