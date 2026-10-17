/**
 * LOCAL TESTING FRAMEWORK
 * محاكاة Hyperdrive + D1 محلياً للتجربة
 */

import crypto from 'crypto';

// =====================================================
// PHASE 1: MOCK SERVICES (محاكاة الخدمات)
// =====================================================

interface Event {
  id: string;
  type: string;
  data: any;
  timestamp: number;
  prevHash: string | null;
  hash: string;
  checkpoint?: number;
}

interface EventCheckpoint {
  id: string;
  eventId: string;
  sequenceNumber: number;
  lastProcessedId: string;
  timestamp: number;
}

// محاكاة Hyperdrive (في الذاكرة)
class MockHyperdrive {
  private events: Map<string, Event> = new Map();
  private checkpoints: Map<string, EventCheckpoint> = new Map();
  private offline = false;
  private latency = 50; // ms

  async insertEvent(event: Event): Promise<void> {
    if (this.offline) {
      throw new Error('Hyperdrive offline');
    }

    await this.sleep(this.latency);

    if (this.events.has(event.id)) {
      throw new Error('Duplicate event ID');
    }

    this.events.set(event.id, event);
  }

  async insertEventsBatch(events: Event[]): Promise<void> {
    if (this.offline) {
      throw new Error('Hyperdrive offline');
    }

    await this.sleep(this.latency * events.length);

    for (const event of events) {
      if (this.events.has(event.id)) {
        throw new Error(`Duplicate event ID: ${event.id}`);
      }
      this.events.set(event.id, event);
    }
  }

  async getAllEvents(): Promise<Event[]> {
    if (this.offline) {
      throw new Error('Hyperdrive offline');
    }

    await this.sleep(this.latency);
    return Array.from(this.events.values()).sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }

  async getEventsSince(timestamp: number): Promise<Event[]> {
    if (this.offline) {
      throw new Error('Hyperdrive offline');
    }

    await this.sleep(this.latency);
    return Array.from(this.events.values())
      .filter(e => e.timestamp >= timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async saveCheckpoint(checkpoint: EventCheckpoint): Promise<void> {
    if (this.offline) {
      throw new Error('Hyperdrive offline');
    }

    await this.sleep(this.latency);
    this.checkpoints.set(checkpoint.id, checkpoint);
  }

  async getCheckpoint(id: string): Promise<EventCheckpoint | null> {
    if (this.offline) {
      throw new Error('Hyperdrive offline');
    }

    await this.sleep(this.latency);
    return this.checkpoints.get(id) || null;
  }

  setOffline(offline: boolean): void {
    this.offline = offline;
  }

  setLatency(ms: number): void {
    this.latency = ms;
  }

  getEventCount(): number {
    return this.events.size;
  }

  getMemoryUsage(): number {
    return JSON.stringify([...this.events.values()]).length;
  }

  clear(): void {
    this.events.clear();
    this.checkpoints.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// محاكاة D1 (في الذاكرة)
class MockD1 {
  private balances: Map<string, number> = new Map();
  private positions: Map<string, any> = new Map();
  private trades: Map<string, any> = new Map();
  private offline = false;
  private latency = 30; // ms

  async updateBalance(userId: string, amount: number): Promise<void> {
    if (this.offline) {
      throw new Error('D1 offline');
    }

    await this.sleep(this.latency);
    this.balances.set(userId, amount);
  }

  async getBalance(userId: string): Promise<number> {
    if (this.offline) {
      throw new Error('D1 offline');
    }

    await this.sleep(this.latency);
    return this.balances.get(userId) || 0;
  }

  async insertPosition(userId: string, position: any): Promise<void> {
    if (this.offline) {
      throw new Error('D1 offline');
    }

    await this.sleep(this.latency);
    this.positions.set(position.id, position);
  }

  async getPositions(userId: string): Promise<any[]> {
    if (this.offline) {
      throw new Error('D1 offline');
    }

    await this.sleep(this.latency);
    return Array.from(this.positions.values()).filter(
      p => p.userId === userId
    );
  }

  async insertTrade(trade: any): Promise<void> {
    if (this.offline) {
      throw new Error('D1 offline');
    }

    await this.sleep(this.latency);
    this.trades.set(trade.id, trade);
  }

  async getTrades(limit?: number): Promise<any[]> {
    if (this.offline) {
      throw new Error('D1 offline');
    }

    await this.sleep(this.latency);
    const trades = Array.from(this.trades.values());
    return limit ? trades.slice(-limit) : trades;
  }

  setOffline(offline: boolean): void {
    this.offline = offline;
  }

  setLatency(ms: number): void {
    this.latency = ms;
  }

  getMemoryUsage(): number {
    return (
      JSON.stringify([...this.balances.entries()]).length +
      JSON.stringify([...this.positions.entries()]).length +
      JSON.stringify([...this.trades.entries()]).length
    );
  }

  clear(): void {
    this.balances.clear();
    this.positions.clear();
    this.trades.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =====================================================
// PHASE 2: EVENT SERVICE (خدمة الأحداث)
// =====================================================

class EventService {
  private hyperdrive: MockHyperdrive;
  private d1: MockD1;
  private queue: Event[] = [];
  private maxQueueSize = 10000;
  private seenEventIds: Set<string> = new Set(); // track seen IDs
  private hashChain: Map<string, string> = new Map(); // id -> hash

  constructor(hyperdrive: MockHyperdrive, d1: MockD1) {
    this.hyperdrive = hyperdrive;
    this.d1 = d1;
  }

  /**
   * حساب hash للحدث
   */
  private calculateHash(
    event: Partial<Event>,
    prevHash: string | null = null
  ): string {
    const data = {
      type: event.type,
      data: event.data,
      timestamp: event.timestamp,
      prevHash: prevHash,
    };

    return crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  /**
   * إنشاء حدث
   */
  createEvent(type: string, data: any): Event {
    const id = `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();
    const prevHash = this.hashChain.get('last') || null;
    const hash = this.calculateHash({ type, data, timestamp }, prevHash);

    const event: Event = {
      id,
      type,
      data,
      timestamp,
      prevHash,
      hash,
    };

    this.hashChain.set(id, hash);
    this.hashChain.set('last', hash);

    return event;
  }

  /**
   * التحقق من صحة hash
   */
  validateHash(event: Event): boolean {
    const expectedHash = this.calculateHash(event, event.prevHash);
    return event.hash === expectedHash;
  }

  /**
   * إضافة حدث (idempotent)
   */
  async addEvent(event: Event): Promise<boolean> {
    // تحقق من التكرار
    if (this.seenEventIds.has(event.id)) {
      return false; // تم الإضافة من قبل
    }

    // تحقق من صحة hash
    if (!this.validateHash(event)) {
      throw new Error('Invalid hash');
    }

    // أضف للطابور
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error('Queue overflow');
    }

    this.queue.push(event);
    this.seenEventIds.add(event.id);
    return true;
  }

  /**
   * معالجة طابور الأحداث (drain)
   */
  async drainQueue(): Promise<number> {
    const batch = this.queue.splice(0, 100);
    if (batch.length === 0) return 0;

    try {
      await this.hyperdrive.insertEventsBatch(batch);
      return batch.length;
    } catch (error) {
      // أعد الأحداث للطابور
      this.queue.unshift(...batch);
      throw error;
    }
  }

  /**
   * الحصول على حجم الطابور
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * الحصول على استخدام الذاكرة
   */
  getMemoryUsage(): {
    hyperdrive: number;
    d1: number;
    queue: number;
  } {
    return {
      hyperdrive: this.hyperdrive.getMemoryUsage(),
      d1: this.d1.getMemoryUsage(),
      queue: JSON.stringify(this.queue).length,
    };
  }

  /**
   * مسح البيانات (للاختبار)
   */
  clear(): void {
    this.hyperdrive.clear();
    this.d1.clear();
    this.queue = [];
    this.seenEventIds.clear();
    this.hashChain.clear();
  }
}

// =====================================================
// PHASE 3: SYNC SERVICE (خدمة المزامنة)
// =====================================================

class SyncService {
  private hyperdrive: MockHyperdrive;
  private d1: MockD1;
  private lastSyncId: string | null = null;
  private syncedIds: Set<string> = new Set();

  constructor(hyperdrive: MockHyperdrive, d1: MockD1) {
    this.hyperdrive = hyperdrive;
    this.d1 = d1;
  }

  /**
   * مزامنة الأحداث من Hyperdrive إلى D1
   */
  async syncToD1(): Promise<number> {
    try {
      const events = await this.hyperdrive.getAllEvents();

      let synced = 0;
      for (const event of events) {
        if (this.syncedIds.has(event.id)) {
          continue; // تخطي الأحداث المتزامنة
        }

        // تطبيق الحدث على D1
        if (event.type.startsWith('trade.')) {
          await this.d1.insertTrade({
            id: event.id,
            ...event.data,
            timestamp: event.timestamp,
          });
        } else if (event.type.startsWith('position.')) {
          await this.d1.insertPosition(event.data.userId, {
            id: event.id,
            ...event.data,
          });
        } else if (event.type.startsWith('balance.')) {
          await this.d1.updateBalance(
            event.data.userId,
            event.data.amount
          );
        }

        this.syncedIds.add(event.id);
        this.lastSyncId = event.id;
        synced++;
      }

      return synced;
    } catch (error) {
      throw new Error(`Sync failed: ${error}`);
    }
  }

  /**
   * حساب checksum للتحقق من التطابق
   */
  async calculateChecksum(source: 'hyperdrive' | 'd1'): Promise<string> {
    let data: any;

    if (source === 'hyperdrive') {
      const events = await this.hyperdrive.getAllEvents();
      data = events.map(e => e.id).sort();
    } else {
      const trades = await this.d1.getTrades();
      data = trades.map(t => t.id).sort();
    }

    return crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  /**
   * التحقق من التطابق
   */
  async verifyConsistency(): Promise<boolean> {
    const hyperdriveChecksum = await this.calculateChecksum('hyperdrive');
    const d1Checksum = await this.calculateChecksum('d1');

    return hyperdriveChecksum === d1Checksum;
  }

  clear(): void {
    this.lastSyncId = null;
    this.syncedIds.clear();
  }
}

export {
  MockHyperdrive,
  MockD1,
  EventService,
  SyncService,
  Event,
  EventCheckpoint,
};
