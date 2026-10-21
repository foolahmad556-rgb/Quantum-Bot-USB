import assert from 'node:assert/strict';
import { HybridReconciliationManager } from '../exchange/HybridReconciliationManager';
import { binanceRateLimiter } from '../utils/RateLimiter';
import { TradingPipeline } from '../app/TradingPipeline';
import { durableStateManager } from '../storage/DurableStateManager';
const pipeline: any = Object.create(TradingPipeline.prototype);
let warmed: string[] = [], streamed: string[] = [];
pipeline.config = {activeSymbols:['BTC/USDT']};
pipeline.userDataStream = {getPositions:()=>[{symbol:'SUN/USDT'},{symbol:'BTC/USDT'}]};
pipeline.marketData = {backfillRealCandles: async (symbols:string[])=>{warmed=symbols},startStreaming:(_:number,symbols:string[])=>{streamed=symbols}};
await pipeline.initializeMarketData();
assert.deepEqual(warmed,['BTC/USDT','SUN/USDT']); assert.deepEqual(streamed,warmed);
const state = new Map<string,any>([['last_balance',{equity:999}]]);
Object.assign(pipeline, {
 db:{getState:async(k:string)=>state.get(k),saveState:async(k:string,v:any)=>{state.set(k,v)},getOpenTrades:async()=>[]},
 orderGateway:{getApiKey:()=> 'test',getApiSecret:()=> 'test',getApiBaseUrl:()=> 'unused',getExecutionMode:()=> 'TESTNET'},
 hybridReconciliationManager:{getReconciliation:async()=>({account:{totalWalletBalance:1000,totalUnrealizedProfit:-25,availableBalance:800},positions:[],source:'rest'})},
 portfolioSizer:{updateBalance:(equity:number)=>assert.equal(equity,975)},
 killSwitch:{trigger:(_:unknown,reason:string)=>{throw new Error(reason)}},
});
const originalLog=console.log, originalWarn=console.warn; const messages:string[]=[];
try {
 console.log=(...args)=>messages.push(args.join(' '));
 await pipeline.reconcileState(); await pipeline.reconcileState();
 assert.equal(state.get('last_balance').equity,975);
 assert.equal(messages.filter(m=>m.includes('Balance reconciled:')).length,1);
 assert.equal(durableStateManager.getBalance()!.freeMargin,800);
 assert.equal(durableStateManager.getBalance()!.unrealizedPnl,-25);
 pipeline.marketData={getLastUpdateTime:()=>Date.now(),getCandles:()=>[{}]};
 pipeline.warmupWarnings=new Map(); console.warn=(...args)=>messages.push(args.join(' '));
 for(let i=0;i<100;i++)await pipeline.evaluateSignalAndExecute('SUN/USDT',{});
 assert.equal(messages.filter(m=>m.includes('Insufficient candle history')).length,1);
 pipeline.warmupWarnings.set('SUN/USDT',Date.now()-61000);
 await pipeline.evaluateSignalAndExecute('SUN/USDT',{});
 assert.equal(messages.filter(m=>m.includes('Insufficient candle history')).length,2);
} finally {console.log=originalLog;console.warn=originalWarn;}
console.log('PASS existing position candle warmup, persisted equity including PnL, preserved margin, bounded warmup warnings');

const originalFetch = binanceRateLimiter.fetch;
try {
 binanceRateLimiter.fetch = async (url: any) => new Response(JSON.stringify(String(url).includes('/account?')
   ? {totalWalletBalance:'1000',totalUnrealizedProfit:'-25',availableBalance:'800',totalInitialMargin:'175',totalMaintMargin:'5'}
   : [{symbol:'SUNUSDT',positionAmt:'1',entryPrice:'100',markPrice:'75',unRealizedProfit:'-25',positionSide:'BOTH'}]),{status:200});
 const hybrid = new HybridReconciliationManager('test','test','https://testnet.binancefuture.com');
 const snapshot = await hybrid.getReconciliation();
 assert.equal(snapshot.account?.totalUnrealizedProfit,-25);
 assert.equal(snapshot.account?.availableBalance,800);
 assert.equal(snapshot.positions[0].unRealizedProfit,-25);
} finally {binanceRateLimiter.fetch=originalFetch;}
console.log('PASS Futures REST account equity and position PnL field parsing');
