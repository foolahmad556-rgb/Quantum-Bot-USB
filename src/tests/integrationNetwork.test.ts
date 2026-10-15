import assert from 'node:assert/strict';
import { EventJournal } from '../storage/EventJournal';

type Stage = 'MARKET_DATA' | 'STRATEGY' | 'RISK_ENGINE' | 'ORDER_GATEWAY' | 'SYSTEM';

class LocalIntegrationNetwork {
  private readonly seen = new Set<string>();
  private readonly stageHistory: Stage[] = [];

  constructor(private readonly journal: EventJournal) {}

  publish(stage: Stage, message: string, correlationId?: string): boolean {
    const id = correlationId ?? `CORR-${Date.now()}-${this.stageHistory.length}`;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.stageHistory.push(stage);
    this.journal.record(stage === 'ORDER_GATEWAY' ? 'ORDER' : 'INFO', stage, message, { correlationId: id });
    return true;
  }

  stages(): Stage[] {
    return [...this.stageHistory];
  }
}

const journal = new EventJournal(50);
const network = new LocalIntegrationNetwork(journal);

network.publish('MARKET_DATA', 'tick BTC/USDT');
network.publish('STRATEGY', 'signal BUY BTC/USDT');
network.publish('RISK_ENGINE', 'risk approved BTC/USDT');
network.publish('ORDER_GATEWAY', 'order submitted BTC/USDT');
network.publish('ORDER_GATEWAY', 'fill confirmed BTC/USDT');
network.publish('SYSTEM', 'account reconciled BTC/USDT');

const events = journal.getEvents();
assert.equal(events.length, 6);
assert.equal(events.map((event) => event.details?.correlationId).filter(Boolean).length, 6);
assert.equal(new Set(events.map((event) => event.details?.correlationId)).size, 6);
assert.deepEqual(network.stages(), [
  'MARKET_DATA', 'STRATEGY', 'RISK_ENGINE', 'ORDER_GATEWAY', 'ORDER_GATEWAY', 'SYSTEM',
]);

assert.equal(network.publish('ORDER_GATEWAY', 'duplicate fill confirmed BTC/USDT', events[0].details?.correlationId), false);
assert.equal(journal.getEvents().length, 6);
console.log('integration network tests passed');
