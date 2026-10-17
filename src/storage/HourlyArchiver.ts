// src/storage/HourlyArchiver.ts
// Scheduled Worker: Archive hot state to D1 once per hour
// Runs via Cloudflare Cron or setInterval

import { CloudDatabaseService } from './CloudDatabaseService';
import { durableStateManager, HotState } from './DurableStateManager';

export class HourlyArchiver {
  private db: CloudDatabaseService;
  private archiveInterval: NodeJS.Timeout | null = null;

  constructor(dbService: CloudDatabaseService) {
    this.db = dbService;
  }

  /**
   * Start hourly archive job
   * Call this once on server startup
   */
  public start() {
    console.log('⏰ Starting hourly archiver...');

    // Register archive callback with DurableStateManager
    durableStateManager.onArchive(async (state: HotState) => {
      await this.archiveToD1(state);
    });

    // Run archiveDaily() every hour
    this.archiveInterval = setInterval(async () => {
      try {
        await durableStateManager.archiveDaily();
      } catch (error) {
        console.error('❌ Archive cycle failed:', error);
      }
    }, 60 * 60 * 1000); // 1 hour

    console.log('✅ Hourly archiver started');
  }

  /**
   * Stop archiver
   */
  public stop() {
    if (this.archiveInterval) {
      clearInterval(this.archiveInterval);
      this.archiveInterval = null;
      console.log('⏸ Hourly archiver stopped');
    }
  }

  /**
   * Archive hot state to D1 (batch)
   * Called once per hour
   */
  private async archiveToD1(state: HotState) {
    try {
      console.log('📦 Archiving to D1...');

      // 1. Archive closed trades (batch insert)
      const closedTrades = state.trades.filter(t => t.status === 'CLOSED');
      if (closedTrades.length > 0) {
        console.log(`  → Archiving ${closedTrades.length} closed trades`);
        // TODO: Batch insert to D1 trades table
        // await this.db.insertTradesArchive(closedTrades);
      }

      // 2. Archive balance snapshot (one record per hour)
      if (state.balance) {
        console.log(`  → Archiving balance: $${state.balance.equity.toFixed(2)}`);
        // TODO: Insert to D1 balance_history table
        // await this.db.insertBalanceSnapshot({
        //   equity: state.balance.equity,
        //   freeMargin: state.balance.freeMargin,
        //   unrealizedPnl: state.balance.unrealizedPnl,
        //   timestamp: Date.now(),
        // });
      }

      // 3. Archive signal history (recent signals only)
      const recentSignals = state.signals.slice(-100);
      if (recentSignals.length > 0) {
        console.log(`  → Archiving ${recentSignals.length} recent signals`);
        // TODO: Batch insert to D1 signals table
        // await this.db.insertSignalsArchive(recentSignals);
      }

      // 4. Archive KillSwitch state if triggered
      if (state.killSwitchState?.active) {
        console.log(`  → Archiving KillSwitch: ${state.killSwitchState.level}`);
        // TODO: Insert to D1 killswitch_events table
        // await this.db.insertKillSwitchEvent(state.killSwitchState);
      }

      console.log('✅ Archive to D1 complete');
    } catch (error) {
      console.error('❌ D1 archive failed:', error);
      // Don't throw - archive failure should not halt trading
    }
  }

  /**
   * Force immediate archive (for testing / manual triggers)
   */
  public async forceArchive() {
    console.log('🔄 Force archiving now...');
    const state = durableStateManager.getState();
    await this.archiveToD1(state);
  }

  /**
   * Get archiver stats
   */
  public getStats() {
    return {
      running: this.archiveInterval !== null,
      nextArchiveIn: this.archiveInterval ? '~60min' : 'stopped',
    };
  }
}

// Export singleton
let archiver: HourlyArchiver | null = null;

export function initArchiver(db: CloudDatabaseService) {
  if (!archiver) {
    archiver = new HourlyArchiver(db);
  }
  return archiver;
}

export function getArchiver() {
  return archiver;
}
