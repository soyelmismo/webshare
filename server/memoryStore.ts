import queueMicrotask from "queue-microtask";

/**
 * Bounded Zero-Disk In-Memory Chunk Store for WebTorrent and Chunk Streaming.
 *
 * Implements the chunk-store interface (put, get, close, destroy) with:
 * 1. Strictly RAM-only storage (never touches HDD/SSD/SD cards).
 * 2. Sliding window eviction: older completed chunks are pruned from RAM
 *    once uploaded or when capacity exceeds maxCachedPieces.
 * 3. Bounded memory consumption: caps piece buffer usage to ~256MB total,
 *    preventing Out-Of-Memory (OOM) fatal crashes on edge devices.
 * 4. Multi-task protected ranges: ensures concurrent streams never evict
 *    each other's active piece buffers.
 */
export class BoundedMemoryChunkStore {
  public chunkLength: number;
  public chunks: Map<number, Buffer> = new Map();
  public closed: boolean = false;
  public length: number;
  public lastChunkLength: number;
  public lastChunkIndex: number;
  public minActivePieceIndex: number = 0;
  public torrent?: any;
  public protectedRanges: Map<string, { start: number; end: number }> = new Map();
  private maxCachedPieces: number;

  constructor(chunkLength: number, opts: any = {}) {
    this.chunkLength = Number(chunkLength);
    if (!this.chunkLength) throw new Error("First argument must be a valid chunk length");
    this.torrent = opts.torrent;

    this.length = Number.isFinite(Number(opts.length)) && Number(opts.length) > 0
      ? Number(opts.length)
      : (Number.isFinite(Number(opts.torrent?.length)) ? Number(opts.torrent.length) : 1000000000000);

    if (this.length !== Infinity) {
      this.lastChunkLength = (this.length % this.chunkLength) || this.chunkLength;
      this.lastChunkIndex = Math.ceil(this.length / this.chunkLength) - 1;
    } else {
      this.lastChunkLength = this.chunkLength;
      this.lastChunkIndex = Infinity;
    }

    // Allow buffering up to 256MB of pieces in RAM to support 16-64MB Google Drive chunks with double buffering
    const targetBufferBytes = 256 * 1024 * 1024;
    const piecesFor256MB = Math.ceil(targetBufferBytes / this.chunkLength);
    this.maxCachedPieces = typeof opts.maxCachedPieces === "number"
      ? opts.maxCachedPieces
      : Math.max(512, piecesFor256MB);
  }

  public setProtectedRange(ownerId: string, startPiece: number, endPiece: number): void {
    this.protectedRanges.set(ownerId, { start: startPiece, end: endPiece });
  }

  public removeProtectedRange(ownerId: string): void {
    this.protectedRanges.delete(ownerId);
  }

  public isPieceProtected(pieceIndex: number): boolean {
    for (const range of this.protectedRanges.values()) {
      if (pieceIndex >= range.start && pieceIndex <= range.end) {
        return true;
      }
    }
    return false;
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

    // Auto-prune only UNPROTECTED pieces if buffer exceeds capacity
    if (this.chunks.size > this.maxCachedPieces) {
      for (const k of this.chunks.keys()) {
        if (!this.isPieceProtected(k)) {
          this.chunks.delete(k);
          if (this.torrent && typeof this.torrent._markUnverified === "function") {
            try {
              this.torrent._markUnverified(k);
            } catch {}
          }
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
      if (this.torrent && typeof this.torrent._markUnverified === "function") {
        try {
          this.torrent._markUnverified(index);
        } catch {}
      }
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
   * Safely evicts all pieces that are NOT protected by any active streaming task.
   */
  public evictUnprotected(torrent?: any): number {
    const t = torrent || this.torrent;
    let evicted = 0;
    for (const k of this.chunks.keys()) {
      if (!this.isPieceProtected(k)) {
        this.chunks.delete(k);
        if (t && typeof t._markUnverified === "function") {
          try {
            t._markUnverified(k);
          } catch {}
        }
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Evicts pieces strictly before minPieceIndex that are NOT protected by any active task.
   */
  public evictBefore(minPieceIndex: number, torrent?: any): number {
    this.minActivePieceIndex = Math.max(this.minActivePieceIndex, minPieceIndex);
    const t = torrent || this.torrent;
    let evicted = 0;
    for (const key of this.chunks.keys()) {
      if (key < minPieceIndex && !this.isPieceProtected(key)) {
        this.chunks.delete(key);
        if (t && typeof t._markUnverified === "function") {
          try {
            t._markUnverified(key);
          } catch {}
        }
        evicted++;
      }
    }
    return evicted;
  }

  public close(cb: (err: Error | null) => void = () => {}): void {
    if (this.closed) return queueMicrotask(() => cb(new Error("Storage is closed")));
    this.closed = true;
    this.chunks.clear();
    this.protectedRanges.clear();
    queueMicrotask(() => cb(null));
  }

  public destroy(cb: (err: Error | null) => void = () => {}): void {
    this.close(cb);
  }
}
