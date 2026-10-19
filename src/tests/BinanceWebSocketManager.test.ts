import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BinanceWebSocketManager } from '../exchange/BinanceWebSocketManager';

describe('BinanceWebSocketManager ACCOUNT_UPDATE positions', () => {
  it('parses Binance ACCOUNT_UPDATE.a.P entries and emits open positions', () => {
    const manager = new BinanceWebSocketManager('unused', 'unused');
    let emitted: any;
    manager.on('positions', positions => { emitted = positions; });
    (manager as any).handleMessage({
      e: 'ACCOUNT_UPDATE', E: 1700000000123,
      a: { B: [{ a: 'USDT', wb: '1000' }], P: [
        { s: 'BTCUSDT', pa: '0.25', ep: '40000', cr: '0', up: '12.5', mt: 'cross', iw: '0', ps: 'BOTH' },
        { s: 'ETHUSDT', pa: '0', ep: '0', cr: '0', up: '0', mt: 'cross', iw: '0', ps: 'BOTH' }
      ] }
    });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].symbol, 'BTCUSDT');
    assert.equal(emitted[0].positionAmt, 0.25);
    assert.equal(emitted[0].entryPrice, 40000);
    assert.equal(emitted[0].unRealizedProfit, 12.5);
    assert.ok(Number.isFinite(emitted[0].timestamp));
    assert.equal(manager.hasValidPositionSnapshot(), true);
  });

  it('does not replace cached positions or emit snapshot for malformed position payload', () => {
    const manager = new BinanceWebSocketManager('unused', 'unused');
    (manager as any).lastPositionUpdate = [{ symbol: 'BTCUSDT' }];
    let events = 0;
    manager.on('positions', () => { events++; });
    (manager as any).handleMessage({ e: 'ACCOUNT_UPDATE', a: { P: [{ s: 'BTCUSDT', pa: 'bad', ep: '1', up: '0', ps: 'BOTH' }] } });
    assert.equal(events, 0);
    assert.equal(manager.getPositions()[0].symbol, 'BTCUSDT');
  });

  it('merges a partial update and keeps unchanged open positions', () => {
    const manager = new BinanceWebSocketManager('unused', 'unused');
    (manager as any).lastPositionUpdate = [
      { symbol: 'BTCUSDT', positionAmt: 0.1, entryPrice: 40000, markPrice: 40100, unRealizedProfit: 1, positionSide: 'BOTH', timestamp: 1 },
      { symbol: 'ETHUSDT', positionAmt: 2, entryPrice: 2500, markPrice: 2510, unRealizedProfit: 20, positionSide: 'BOTH', timestamp: 1 },
    ];
    // Binance pushes ONLY changed symbols in a.P — ETHUSDT is not part of this event.
    (manager as any).handleMessage({ e: 'ACCOUNT_UPDATE', a: { P: [
      { s: 'BTCUSDT', pa: '0.5', ep: '41000', cr: '0', up: '15', ps: 'BOTH' }
    ] } });
    const positions = manager.getPositions();
    assert.equal(positions.length, 2, 'unchanged ETHUSDT position must survive a partial update');
    const btc = positions.find((p: any) => p.symbol === 'BTCUSDT');
    assert.ok(btc, 'BTCUSDT position must exist');
    assert.equal(btc!.positionAmt, 0.5);
    assert.equal(btc!.entryPrice, 41000);
    const eth = positions.find((p: any) => p.symbol === 'ETHUSDT');
    assert.ok(eth, 'ETHUSDT position must exist');
    assert.equal(eth!.positionAmt, 2, 'ETHUSDT must keep its previous state');
  });

  it('removes only the closed symbol when position amount goes to zero', () => {
    const manager = new BinanceWebSocketManager('unused', 'unused');
    (manager as any).lastPositionUpdate = [
      { symbol: 'BTCUSDT', positionAmt: 0.1, entryPrice: 40000, markPrice: 40100, unRealizedProfit: 1, positionSide: 'BOTH', timestamp: 1 },
      { symbol: 'ETHUSDT', positionAmt: 2, entryPrice: 2500, markPrice: 2510, unRealizedProfit: 20, positionSide: 'BOTH', timestamp: 1 },
    ];
    (manager as any).handleMessage({ e: 'ACCOUNT_UPDATE', a: { P: [
      { s: 'BTCUSDT', pa: '0', ep: '0', cr: '0', up: '0', ps: 'BOTH' }
    ] } });
    assert.deepEqual(manager.getPositions().map((p: any) => p.symbol), ['ETHUSDT']);
  });

  it('does not wipe cached positions on a balance-only event with empty P', () => {
    const manager = new BinanceWebSocketManager('unused', 'unused');
    (manager as any).lastPositionUpdate = [
      { symbol: 'BTCUSDT', positionAmt: 0.1, entryPrice: 40000, markPrice: 40100, unRealizedProfit: 1, positionSide: 'BOTH', timestamp: 1 },
    ];
    (manager as any).handleMessage({ e: 'ACCOUNT_UPDATE', a: { B: [{ a: 'USDT', wb: '1000' }], P: [] } });
    assert.equal(manager.getPositions().length, 1, 'funding/balance event must not clear open positions');
    assert.equal(manager.hasValidPositionSnapshot(), false, 'empty P must not count as a position snapshot');
  });
});
