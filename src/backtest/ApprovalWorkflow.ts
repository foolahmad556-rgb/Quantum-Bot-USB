export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'EXPIRED';

export interface ApprovalRecord {
  runId: string; resultHash: string; status: ApprovalStatus; createdAt: string;
  createdAtMs: number; expiresAtMs?: number; reviewer?: string; note?: string;
  reviewedAt?: string; reviewedAtMs?: number; activatedAt?: string;
}

interface ApprovalWorkflowOptions { approvalTtlMs?: number }

export class ApprovalWorkflow {
  private readonly records = new Map<string, ApprovalRecord>();
  private readonly approvalTtlMs: number;
  constructor(options: ApprovalWorkflowOptions = {}) { this.approvalTtlMs = options.approvalTtlMs ?? 7 * 24 * 60 * 60 * 1000; }

  create(runId: string, resultHash: string, nowMs = Date.now()): ApprovalRecord {
    if (!runId || !resultHash) throw new Error('runId and resultHash are required');
    if (this.records.has(runId)) throw new Error('run already exists');
    const record: ApprovalRecord = { runId, resultHash, status: 'PENDING', createdAt: new Date(nowMs).toISOString(), createdAtMs: nowMs };
    this.records.set(runId, record); return { ...record };
  }
  approve(runId: string, reviewer: string, note: string, nowMs = Date.now()): ApprovalRecord { return this.review(runId, 'APPROVED', reviewer, note, nowMs); }
  reject(runId: string, reviewer: string, note: string, nowMs = Date.now()): ApprovalRecord { return this.review(runId, 'REJECTED', reviewer, note, nowMs); }
  activate(runId: string, nowMs = Date.now()): ApprovalRecord {
    const record = this.current(runId, nowMs);
    if (record.status === 'EXPIRED') throw new Error('approval expired');
    if (record.status !== 'APPROVED') throw new Error('only approved results can be activated');
    const updated = { ...record, status: 'ACTIVE' as const, activatedAt: new Date(nowMs).toISOString() };
    this.records.set(runId, updated); return { ...updated };
  }
  canActivate(runId: string, nowMs = Date.now(), resultHash?: string): boolean { const r = this.current(runId, nowMs, resultHash); return r.status === 'APPROVED' || r.status === 'ACTIVE'; }
  isExpired(runId: string, nowMs = Date.now(), resultHash?: string): boolean { return this.current(runId, nowMs, resultHash).status === 'EXPIRED'; }
  get(runId: string, nowMs = Date.now(), resultHash?: string): ApprovalRecord | undefined { const r = this.records.get(runId); return r ? { ...this.current(runId, nowMs, resultHash) } : undefined; }
  private review(runId: string, status: 'APPROVED' | 'REJECTED', reviewer: string, note: string, nowMs: number): ApprovalRecord {
    if (!reviewer || !note) throw new Error('reviewer and note are required');
    const record = this.current(runId, nowMs); if (record.status !== 'PENDING') throw new Error('run already approved, rejected, or activated');
    const updated = { ...record, status, reviewer, note, reviewedAt: new Date(nowMs).toISOString(), reviewedAtMs: nowMs, expiresAtMs: status === 'APPROVED' ? nowMs + this.approvalTtlMs : undefined };
    this.records.set(runId, updated); return { ...updated };
  }
  private current(runId: string, nowMs: number, resultHash?: string): ApprovalRecord {
    const record = this.records.get(runId); if (!record) throw new Error('run not found');
    const changed = resultHash !== undefined && resultHash !== record.resultHash;
    if ((record.status === 'APPROVED' || record.status === 'ACTIVE') && (nowMs >= (record.expiresAtMs ?? Infinity) || changed)) {
      const expired = { ...record, status: 'EXPIRED' as const }; this.records.set(runId, expired); return expired;
    }
    return record;
  }
}