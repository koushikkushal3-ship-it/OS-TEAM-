/**
 * Copies every TEAM OS table from the current database (DIRECT_URL) into a new, already-migrated
 * database (NEW_DIRECT_URL). Connection strings are read from .env and never printed.
 *
 *   node scripts/copy-database.mjs            → dry run: row counts only
 *   node scripts/copy-database.mjs --apply    → empties the new database's tables, then copies
 */
import 'dotenv/config';
import pg from 'pg';

const SCHEMA = process.env.DATABASE_SCHEMA ?? 'app';
const apply = process.argv.includes('--apply');
const clean = (url) => url.replace(/[?&]schema=[^&]*/, '').replace(/\?&/, '?').replace(/[?&]$/, '');

if (!process.env.DIRECT_URL || !process.env.NEW_DIRECT_URL) {
  console.error('DIRECT_URL and NEW_DIRECT_URL must both be set in BACKEND/.env');
  process.exit(1);
}

const from = new pg.Client({ connectionString: clean(process.env.DIRECT_URL) });
const to = new pg.Client({ connectionString: clean(process.env.NEW_DIRECT_URL) });

async function tablesInOrder(client) {
  const tables = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`, [SCHEMA])).rows.map((r) => r.table_name);
  const deps = (
    await client.query(
      `SELECT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
      [SCHEMA],
    )
  ).rows;
  // Parents before children, so every foreign key already has its target row.
  const order = [];
  const done = new Set();
  const visit = (t, stack = new Set()) => {
    if (done.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const d of deps.filter((x) => x.child === t && x.parent !== t)) visit(d.parent, stack);
    done.add(t);
    order.push(t);
  };
  tables.sort().forEach((t) => visit(t));
  return order;
}

const q = (name) => `"${SCHEMA}"."${name.replace(/"/g, '')}"`;

try {
  await from.connect();
  await to.connect();
  const order = await tablesInOrder(from);
  const targetTables = new Set(await tablesInOrder(to));
  const missing = order.filter((t) => !targetTables.has(t));
  if (missing.length) throw new Error(`The new database is missing tables (${missing.join(', ')}). Run the migrations on it first.`);

  let total = 0;
  for (const t of order) {
    const n = Number((await from.query(`SELECT count(*) FROM ${q(t)}`)).rows[0].count);
    total += n;
    console.log(`${apply ? 'copy' : 'would copy'}  ${String(n).padStart(6)}  ${t}`);
  }
  if (!apply) {
    console.log(`\nDry run: ${total} rows in ${order.length} tables. Run again with --apply to copy.`);
  } else {
    await to.query('BEGIN');
    // Migrations insert default modules and rules; clear them so the originals copy over exactly.
    await to.query(`TRUNCATE ${order.map(q).join(', ')} CASCADE`);
    for (const t of order) {
      const { rows } = await from.query(`SELECT COALESCE(json_agg(x), '[]'::json) AS data FROM ${q(t)} x`);
      await to.query(`INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(NULL::${q(t)}, $1::json)`, [JSON.stringify(rows[0].data)]);
    }
    for (const t of order) {
      const a = Number((await from.query(`SELECT count(*) FROM ${q(t)}`)).rows[0].count);
      const b = Number((await to.query(`SELECT count(*) FROM ${q(t)}`)).rows[0].count);
      if (a !== b) throw new Error(`Row count differs for ${t}: ${a} vs ${b}`);
    }
    await to.query('COMMIT');
    console.log(`\nCopied ${total} rows in ${order.length} tables. Every table's row count matches.`);
  }
} catch (err) {
  await to.query('ROLLBACK').catch(() => undefined);
  console.error(`\nNothing was changed in the new database: ${err.message}`);
  process.exitCode = 1;
} finally {
  await from.end().catch(() => undefined);
  await to.end().catch(() => undefined);
}
