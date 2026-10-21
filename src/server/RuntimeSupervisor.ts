import { randomUUID } from 'node:crypto';

interface LeaseStore {
  ping(): Promise<{ ok: boolean }>;
  acquireLease(name: string, owner: string): Promise<{ acquired: boolean; expiresAt: number }>;
  releaseLease(name: string, owner: string): Promise<unknown>;
}

class LeaseConflictError extends Error {}

/** Only a recently renewed account lease permits new entries. Exits remain allowed. */
export class RuntimeSupervisor {
  private readonly owner = randomUUID();
  private validUntil = 0;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopped = true;
  private healthy = false;
  constructor(private readonly store: LeaseStore, private readonly account: string,
    private readonly onLost: (reason: string) => Promise<void>, private readonly now = Date.now) {}
  canEnter(): boolean { return !this.stopped && this.healthy && this.validUntil > this.now(); }
  async start(): Promise<void> {
    if (!this.account) throw new Error('EXCHANGE_ACCOUNT_ID is required for a single execution owner');
    this.stopped = false;
    try { await this.renew(); } catch (error) { this.stopped = true; this.validUntil = 0; throw error; }
    if (!this.timer) this.timer = setInterval(() => { void this.heartbeat(); }, 5000);
  }
  private async renew() {
    // Use a conservative local deadline measured before the request, avoiding clock
    // skew with the Worker and leaving a buffer before its 30 second lease expires.
    const began = this.now();
    if (!(await this.store.ping()).ok) throw new Error('Storage is not ready');
    if (!(await this.store.acquireLease(this.account, this.owner)).acquired) throw new LeaseConflictError('Execution lease is held by another instance');
    if (this.stopped) throw new Error('Execution owner stopped during renewal');
    this.healthy = true;
    this.validUntil = began + 20000;
    if (!this.canEnter()) throw new Error('Lease renewal arrived too late');
  }
  async heartbeat() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      if (this.now() >= this.validUntil) throw new Error('Execution lease expired before renewal');
      await this.renew();
    }
    catch (error) {
      if (this.stopped) return; // An intentional stop may interrupt an in-flight renewal.
      this.healthy = false; // Block all entries immediately, even during bounded retry.
      const detail = error instanceof Error ? error.message : 'Unknown renewal failure';
      if (!(error instanceof LeaseConflictError) && this.validUntil > this.now()) {
        console.warn(`Execution lease renewal delayed; entries blocked until recovery: ${detail}`);
        return; // Retry on the next heartbeat, never extend the existing deadline.
      }
      this.validUntil = 0; this.stopped = true;
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      const reason = `Execution lease lost: ${detail}`;
      console.error(reason);
      await this.onLost(reason);
    }
    finally { this.busy = false; }
  }
  async stop() {
    this.stopped = true;
    this.healthy = false;
    this.validUntil = 0;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    // Wait for an in-flight renewal before releasing the lease.
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 20));
    this.validUntil = 0;
    await this.store.releaseLease(this.account, this.owner);
  }
}
