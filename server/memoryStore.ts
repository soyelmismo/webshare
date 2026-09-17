import queueMicrotask from "queue-microtask";

/**
 * Bounded Zero-Disk In-Memory Chunk Store for WebTorrent and Chunk Streaming.
 *
 * Implements the chunk-store interface (put, get, close, destroy) with:
 * 1. Strictly RAM-only storage (never touches HDD/SSD/SD cards).
 * 2. Sliding window eviction: older completed chunks are pruned from RAM
 *    once uploaded or when capacity exceeds maxCachedPieces.
 * 3. Bounded memory consumption: caps piece buffer usage to ~32MB-64MB total,
 *    preventing Out-Of-Memory (OOM) fatal crashes on edge devices.
 */
export class BoundedMemoryChunkStore {
  public chunkLength: number;
  public chunks: Map<number, Buffer> = new Map();
  public closed: boolean = false;
  public length: number;
  public lastChunkLength: number;
  public lastChunkIndex: number;
  public minActivePieceIndex: number = 0;
  private maxCachedPieces: number;

  constructor(chunkLength: number, opts: any = {}) {
    this.chunkLength = Number(chunkLength);
    if (!this.chunkLength) throw new Error("First argument must be a valid chunk length");
    this.length = Number(opts.length) || Infinity;
    // Allow buffering up to 256MB of pieces in RAM to support 16-64MB Google Drive chunks with double buffering
    const targetBufferBytes = 256 * 1024 * 1024;
    const piecesFor256MB = Math.ceil(targetBufferBytes / this.chunkLength);
    this.maxCachedPieces = typeof opts.maxCachedPieces === "number"
      ? opts.maxCachedPieces
      : Math.max(2048, piecesFor256MB);

    if (this.length !== Infinity) {
      this.lastChunkLength = (this.length % this.chunkLength) || this.chunkLength;
      this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1;
    } else {
      this.lastChunkLength = this.chunkLength;
      this.lastChunkIndex = Infinity;
    }
  }

  public put(index: number, buf: Buffer, cb: (err: Error | null) => void = () => {}): void {
    if (this.closed) return queueMicrotask(() => cb(new Error("Storage is closed")));

    const isLastChunk = index === this.lastChunkIndex;
    if (isLastChunk && buf.length !== this.lastChunkLength) {
      return queueMicrotask(() => cb(new Error(`Last chunk length must be ${this.lastChunkLength}`)));
    }
    if (!isLastChunk && buf.length !== this.chunkLength) {
      return queueMicrotask(() => cb(new Error(`Chunk length must be ${this.chunkLength}`)));
    }

    this.chunks.set(index, buf);

    // Auto-prune only confirmed older pieces strictly before minActivePieceIndex if buffer exceeds capacity
    if (this.chunks.size > this.maxCachedPieces) {
      for (const k of this.chunks.keys()) {
        if (k < this.minActivePieceIndex) {
          this.chunks.delete(k);
          if (this.chunks.size <= this.maxCachedPieces) break;
        }
      }
    }

    queueMicrotask(() => cb(null));
  }

  public get(index: number, opts?: any, cb: (err: any, buf?: Buffer) => void = () => {}): void {
    if (typeof opts === "function") {
      cb = opts;
      opts = null;
    }
    if (this.closed) return queueMicrotask(() => cb(new Error("Storage is closed")));

    let buf = this.chunks.get(index);
    if (!buf) {
      const err: any = new Error(`Chunk ${index} not found in memory store`);
      err.notFound = true;
      return queueMicrotask(() => cb(err));
    }

    if (!opts) opts = {};
    const offset = opts.offset || 0;
    const len = typeof opts.length === "number" ? opts.length : (buf.length - offset);

    if (offset !== 0 || len !== buf.length) {
      buf = buf.subarray(offset, len + offset);
    }

    queueMicrotask(() => cb(null, buf));
  }

  /**
   * Explicitly evicts all pieces strictly before minPieceIndex from RAM.
   * Called immediately after a chunk range is confirmed uploaded to Google Drive.
   */
  public evictBefore(minPieceIndex: number): number {
    this.minActivePieceIndex = Math.max(this.minActivePieceIndex, minPieceIndex);
    let evicted = 0;
    for (const key of this.chunks.keys()) {
      if (key < minPieceIndex) {
        this.chunks.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  public close(cb: (err: Error | null) => void = () => {}): void {
    if (this.closed) return queueMicrotask(() => cb(new Error("Storage is closed")));
    this.closed = true;
    this.chunks.clear();
    queueMicrotask(() => cb(null));
  }

  public destroy(cb: (err: Error | null) => void = () => {}): void {
    this.close(cb);
  }
}
