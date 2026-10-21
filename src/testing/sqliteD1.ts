import sqlite3 from 'sqlite3';
import { readFile } from 'node:fs/promises';

/** Executes Worker SQL against SQLite, with the D1 prepared-statement interface. */
export async function sqliteD1() {
  const db = new sqlite3.Database(':memory:');
  for (const name of ['0001_initial.sql', '0002_orders_leases.sql', '0003_telegram_updates.sql', '0004_auth_users.sql']) {
    const sql = await readFile(new URL(`../../api/migrations/${name}`, import.meta.url), 'utf8');
    await new Promise<void>((resolve, reject) => db.exec(sql, err => err ? reject(err) : resolve()));
  }
  return {
    prepare(sql: string) {
      let params: any[] = [];
      const statement = {
        bind(...values: any[]) { params = values; return statement; },
        all: () => new Promise<any>((resolve, reject) => db.all(sql, params, (err, results) => err ? reject(err) : resolve({ results }))),
        run: () => new Promise<any>((resolve, reject) => db.run(sql, params, function(err) {
          err ? reject(err) : resolve({ meta: { changes: this.changes, last_row_id: this.lastID } });
        })),
      };
      return statement;
    },
    close: () => new Promise<void>((resolve, reject) => db.close(err => err ? reject(err) : resolve())),
  };
}
