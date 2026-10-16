export interface StorageQuotaConfig { maxRecords: number; maxBytes: number }
export interface StorageUsage { records: number; bytes: number }

export class StorageQuotaManager {
  private usage: StorageUsage = { records: 0, bytes: 0 };
  constructor(private readonly config: StorageQuotaConfig) {
    if (config.maxRecords <= 0 || config.maxBytes <= 0) throw new Error('quota limits must be positive');
  }
  canStore(bytes: number): boolean {
    this.validateBytes(bytes);
    return this.usage.records < this.config.maxRecords && this.usage.bytes + bytes <= this.config.maxBytes;
  }
  recordStored(bytes: number): void {
    this.validateBytes(bytes);
    if (!this.canStore(bytes)) throw new Error('storage quota exceeded');
    this.usage = { records: this.usage.records + 1, bytes: this.usage.bytes + bytes };
  }
  shouldPrune(): boolean { return this.usage.records >= this.config.maxRecords || this.usage.bytes >= this.config.maxBytes; }
  prune(records: number, bytes = this.usage.bytes): number {
    if (!Number.isInteger(records) || records < 0) throw new Error('records must be non-negative integer');
    const removed = Math.min(records, this.usage.records);
    this.usage = { records: this.usage.records - removed, bytes: Math.max(0, this.usage.bytes - Math.max(0, bytes)) };
    return removed;
  }
  getUsage(): StorageUsage { return { ...this.usage }; }
  private validateBytes(bytes: number): void { if (!Number.isFinite(bytes) || bytes <= 0 || bytes > this.config.maxBytes) throw new Error('invalid record size or quota'); }
}
