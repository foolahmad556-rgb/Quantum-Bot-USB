import assert from 'node:assert/strict';
import { HARD_CAPS, clampLeverage } from '../config/hardCaps';
import { PortfolioSizer } from '../risk/PortfolioSizer';

assert.ok(HARD_CAPS.maxLeverage <= 5);
assert.equal(clampLeverage(50), HARD_CAPS.maxLeverage);
assert.equal(clampLeverage(0), 1);
assert.equal(clampLeverage(NaN), 1);

const sizer = new PortfolioSizer();
const cfg = sizer.getConfig();
assert.ok(cfg.maxLeverage <= HARD_CAPS.maxLeverage, 'tier leverage clamped');
assert.ok(cfg.maxTradePercentage <= HARD_CAPS.maxTradeNotionalPct, 'tier exposure clamped');

// Tight stop would imply a huge position; notional and leverage must stay inside caps.
const equity = 1000;
const r = sizer.calculatePositionSize(100, 99.6, equity, 0.05);
assert.ok(r.notionalValue <= equity * HARD_CAPS.maxTradeNotionalPct + 1e-6, `notional ${r.notionalValue}`);
assert.ok(r.leverage <= HARD_CAPS.maxLeverage);
// Risk to stop never above the hard risk cap even if caller asks for 5%.
const wide = sizer.calculatePositionSize(100, 95, equity, 0.05);
assert.ok(wide.quantity * 5 <= equity * HARD_CAPS.maxRiskPerTradePct + 1e-6, 'risk to stop capped');
console.log('PASS hard caps clamp leverage, exposure and per-trade risk');
