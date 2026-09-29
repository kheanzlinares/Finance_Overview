/**
 * Local SQLite storage (expo-sqlite) for iOS and Android. Everything stays on the device.
 * The web build uses database.web.ts instead (Metro picks it automatically).
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ParsedTxn } from '../lib/importers';
import { shiftMonth } from '../lib/dates';
import type { Txn, ImportSummary, MonthTotals, CategoryTotal, Account, AccountLink, AccountType, Plan, Budget, Debt } from './types';

export const DATABASE_NAME = 'finance.db';

export type { Txn, ImportRecord, ImportSummary, MonthTotals, CategoryTotal, Account, AccountLink, AccountType, Plan, Budget, PlanFrequency, Debt, DebtDirection } from './types';

/** Handle passed to every function; on web this is unused. */
export type Db = SQLiteDatabase;

const SCHEMA_VERSION = 5;

export async function migrate(db: Db): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_name TEXT NOT NULL,
        source TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        row_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        category TEXT NOT NULL DEFAULT 'other',
        note TEXT,
        excluded INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        import_id INTEGER REFERENCES imports(id) ON DELETE CASCADE,
        hash TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
      CREATE TABLE IF NOT EXISTS rules (
        match TEXT PRIMARY KEY,
        category TEXT NOT NULL
      );
    `);
  }

  if (version < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        balance_cents INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'EUR',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'other',
        frequency TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT
      );
      CREATE TABLE IF NOT EXISTS budgets (
        category TEXT PRIMARY KEY,
        limit_cents INTEGER NOT NULL
      );
    `);
  }

  if (version < 3) {
    // Accounts get a type so savings can be shown separately
    await db.execAsync("ALTER TABLE accounts ADD COLUMN type TEXT NOT NULL DEFAULT 'current'");
  }

  if (version < 4) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS debts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        note TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  }

  if (version < 5) {
    // Accounts can be kept up to date from imported statements
    await db.execAsync('ALTER TABLE accounts ADD COLUMN link TEXT');
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

// ---------- Reading ----------

export async function getRules(db: Db): Promise<Map<string, string>> {
  const rows = await db.getAllAsync<{ match: string; category: string }>('SELECT match, category FROM rules');
  return new Map(rows.map((r) => [r.match, r.category]));
}

export async function getMonthTotals(db: Db, endMonth: string, count: number): Promise<MonthTotals[]> {
  const start = shiftMonth(endMonth, -(count - 1));
  const rows = await db.getAllAsync<MonthTotals>(
    `SELECT substr(date, 1, 7) AS month,
            COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS in_cents,
            COALESCE(SUM(CASE WHEN amount_cents < 0 THEN -amount_cents END), 0) AS out_cents
       FROM transactions
      WHERE excluded = 0 AND substr(date, 1, 7) BETWEEN ? AND ?
      GROUP BY month`,
    [start, endMonth],
  );
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return Array.from({ length: count }, (_, i) => {
    const month = shiftMonth(start, i);
    return byMonth.get(month) ?? { month, in_cents: 0, out_cents: 0 };
  });
}

export async function getCategoryTotals(db: Db, month: string): Promise<CategoryTotal[]> {
  return db.getAllAsync<CategoryTotal>(
    `SELECT category, SUM(-amount_cents) AS out_cents, COUNT(*) AS count
       FROM transactions
      WHERE excluded = 0 AND amount_cents < 0 AND substr(date, 1, 7) = ?
      GROUP BY category
      ORDER BY out_cents DESC`,
    [month],
  );
}

export async function getTransactions(
  db: Db,
  month: string,
  opts: { search?: string; direction?: 'all' | 'in' | 'out'; category?: string } = {},
): Promise<Txn[]> {
  const where = ['substr(date, 1, 7) = ?'];
  const params: (string | number)[] = [month];
  if (opts.search?.trim()) {
    where.push('(description LIKE ? OR note LIKE ?)');
    const q = `%${opts.search.trim()}%`;
    params.push(q, q);
  }
  if (opts.direction === 'in') where.push('amount_cents > 0');
  if (opts.direction === 'out') where.push('amount_cents < 0');
  if (opts.category) {
    where.push('category = ?');
    params.push(opts.category);
  }
  return db.getAllAsync<Txn>(
    `SELECT id, date, description, amount_cents, currency, category, note, excluded, source, import_id
       FROM transactions WHERE ${where.join(' AND ')}
      ORDER BY date DESC, id DESC`,
    params,
  );
}

/** The most recent month that has data, or null if the database is empty. */
/** Transactions dated after the given day ("YYYY-MM-DD"), used to keep linked account balances up to date. */
export async function getTransactionsAfter(db: Db, day: string): Promise<Txn[]> {
  return db.getAllAsync<Txn>(
    `SELECT id, date, description, amount_cents, currency, category, note, excluded, source, import_id
       FROM transactions WHERE substr(date, 1, 10) > ? ORDER BY date`,
    [day],
  );
}

export async function getLatestMonth(db: Db): Promise<string | null> {
  const row = await db.getFirstAsync<{ m: string | null }>('SELECT substr(MAX(date), 1, 7) AS m FROM transactions');
  return row?.m ?? null;
}

/** Most common currency, used for formatting totals. */
export async function getMainCurrency(db: Db): Promise<string> {
  const row = await db.getFirstAsync<{ currency: string }>(
    'SELECT currency FROM transactions GROUP BY currency ORDER BY COUNT(*) DESC LIMIT 1',
  );
  return row?.currency ?? 'EUR';
}

/** Every imported statement, newest first, with its period and totals. */
export async function getImports(db: Db): Promise<ImportSummary[]> {
  return db.getAllAsync<ImportSummary>(
    `SELECT i.*,
            MIN(t.date) AS first_date,
            MAX(t.date) AS last_date,
            COUNT(t.id) AS txn_count,
            COALESCE(SUM(CASE WHEN t.excluded = 0 AND t.amount_cents > 0 THEN t.amount_cents END), 0) AS counted_in_cents,
            COALESCE(SUM(CASE WHEN t.excluded = 0 AND t.amount_cents < 0 THEN -t.amount_cents END), 0) AS counted_out_cents
       FROM imports i
       LEFT JOIN transactions t ON t.import_id = i.id
      GROUP BY i.id
      ORDER BY i.id DESC`,
  );
}

export async function countExisting(db: Db, hashes: string[]): Promise<number> {
  let found = 0;
  // Chunk to stay under SQLite's parameter limit
  for (let i = 0; i < hashes.length; i += 500) {
    const chunk = hashes.slice(i, i + 500);
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions WHERE hash IN (${chunk.map(() => '?').join(',')})`,
      chunk,
    );
    found += row?.n ?? 0;
  }
  return found;
}

// ---------- Writing ----------

/** Inserts parsed rows, skipping ones already imported. Returns how many were added. */
export async function importTransactions(
  db: Db,
  fileName: string,
  source: string,
  txns: ParsedTxn[],
): Promise<number> {
  let added = 0;
  await db.withTransactionAsync(async () => {
    const imp = await db.runAsync(
      'INSERT INTO imports (file_name, source, imported_at, row_count) VALUES (?, ?, datetime(\'now\', \'localtime\'), 0)',
      [fileName, source],
    );
    const importId = imp.lastInsertRowId;
    for (const t of txns) {
      const res = await db.runAsync(
        `INSERT OR IGNORE INTO transactions (date, description, amount_cents, currency, category, excluded, source, import_id, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.date, t.description, t.amountCents, t.currency, t.category, t.excluded ? 1 : 0, source, importId, t.hash],
      );
      added += res.changes;
    }
    if (added === 0) {
      await db.runAsync('DELETE FROM imports WHERE id = ?', [importId]);
    } else {
      await db.runAsync('UPDATE imports SET row_count = ? WHERE id = ?', [added, importId]);
    }
  });
  return added;
}

export async function addManualTransaction(
  db: Db,
  t: { date: string; description: string; amountCents: number; currency: string; category: string; note?: string },
): Promise<void> {
  await db.runAsync(
    `INSERT INTO transactions (date, description, amount_cents, currency, category, note, source)
     VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
    [t.date, t.description, t.amountCents, t.currency, t.category, t.note ?? null],
  );
}

export async function updateTransaction(
  db: Db,
  id: number,
  patch: { category: string; note: string | null; excluded: boolean },
): Promise<void> {
  await db.runAsync('UPDATE transactions SET category = ?, note = ?, excluded = ? WHERE id = ?', [
    patch.category,
    patch.note,
    patch.excluded ? 1 : 0,
    id,
  ]);
}

/**
 * Sets the category for every transaction with the same description and
 * remembers it for future imports. Returns how many transactions changed.
 */
export async function applyCategoryToSimilar(db: Db, description: string, category: string): Promise<number> {
  const key = description.trim().toLowerCase();
  let changed = 0;
  await db.withTransactionAsync(async () => {
    const res = await db.runAsync('UPDATE transactions SET category = ? WHERE lower(trim(description)) = ?', [category, key]);
    changed = res.changes;
    await db.runAsync('INSERT OR REPLACE INTO rules (match, category) VALUES (?, ?)', [key, category]);
  });
  return changed;
}

export async function deleteTransaction(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
}

export async function deleteImport(db: Db, importId: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM transactions WHERE import_id = ?', [importId]);
    await db.runAsync('DELETE FROM imports WHERE id = ?', [importId]);
  });
}

export async function deleteAllData(db: Db): Promise<void> {
  await db.execAsync(
    'DELETE FROM transactions; DELETE FROM imports; DELETE FROM rules; DELETE FROM accounts; DELETE FROM plans; DELETE FROM budgets; DELETE FROM debts;',
  );
}

// ---------- Accounts, plans, budgets ----------

export async function getAccounts(db: Db): Promise<Account[]> {
  return db.getAllAsync<Account>('SELECT * FROM accounts ORDER BY id');
}

export async function saveAccount(
  db: Db,
  /** Leave balanceCents out when editing to keep the typed-in balance and its date */
  a: { id?: number; name: string; type: AccountType; link: AccountLink | null; balanceCents?: number; currency: string },
): Promise<void> {
  if (a.id && a.balanceCents === undefined) {
    await db.runAsync('UPDATE accounts SET name = ?, type = ?, link = ?, currency = ? WHERE id = ?', [a.name, a.type, a.link, a.currency, a.id]);
  } else if (a.id && a.balanceCents !== undefined) {
    await db.runAsync(
      "UPDATE accounts SET name = ?, type = ?, link = ?, balance_cents = ?, currency = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
      [a.name, a.type, a.link, a.balanceCents, a.currency, a.id],
    );
  } else {
    await db.runAsync(
      "INSERT INTO accounts (name, type, link, balance_cents, currency, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))",
      [a.name, a.type, a.link, a.balanceCents ?? 0, a.currency],
    );
  }
}

export async function deleteAccount(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM accounts WHERE id = ?', [id]);
}

export async function getPlans(db: Db): Promise<Plan[]> {
  return db.getAllAsync<Plan>('SELECT * FROM plans ORDER BY kind DESC, amount_cents DESC');
}

export async function savePlan(db: Db, p: Omit<Plan, 'id'> & { id?: number }): Promise<void> {
  const values = [p.kind, p.description, p.amount_cents, p.category, p.frequency, p.start_date, p.end_date];
  if (p.id) {
    await db.runAsync(
      'UPDATE plans SET kind = ?, description = ?, amount_cents = ?, category = ?, frequency = ?, start_date = ?, end_date = ? WHERE id = ?',
      [...values, p.id],
    );
  } else {
    await db.runAsync(
      'INSERT INTO plans (kind, description, amount_cents, category, frequency, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
      values,
    );
  }
}

export async function deletePlan(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM plans WHERE id = ?', [id]);
}

export async function getBudgets(db: Db): Promise<Budget[]> {
  return db.getAllAsync<Budget>('SELECT category, limit_cents FROM budgets ORDER BY limit_cents DESC');
}

/** Sets a category's monthly budget; pass null to remove it. */
export async function setBudget(db: Db, category: string, limitCents: number | null): Promise<void> {
  if (limitCents === null) {
    await db.runAsync('DELETE FROM budgets WHERE category = ?', [category]);
  } else {
    await db.runAsync('INSERT OR REPLACE INTO budgets (category, limit_cents) VALUES (?, ?)', [category, limitCents]);
  }
}

// ---------- Debts ----------

export async function getDebts(db: Db): Promise<Debt[]> {
  return db.getAllAsync<Debt>('SELECT * FROM debts ORDER BY direction, amount_cents DESC');
}

export async function saveDebt(
  db: Db,
  d: { id?: number; person: string; direction: Debt['direction']; amountCents: number; note: string | null },
): Promise<void> {
  if (d.id) {
    await db.runAsync(
      "UPDATE debts SET person = ?, direction = ?, amount_cents = ?, note = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
      [d.person, d.direction, d.amountCents, d.note, d.id],
    );
  } else {
    await db.runAsync(
      "INSERT INTO debts (person, direction, amount_cents, note, updated_at) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))",
      [d.person, d.direction, d.amountCents, d.note],
    );
  }
}

export async function deleteDebt(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM debts WHERE id = ?', [id]);
}
