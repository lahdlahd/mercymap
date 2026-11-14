// Test harness: builds a throwaway database, applies the Supabase shim and
// every migration, and lets tests run SQL as a given actor.
//
//   TEST_DATABASE_URL  superuser connection to any Postgres 15+ server
//                      (default: postgres://postgres@localhost:5432/postgres)
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'supabase', 'migrations');
const adminUrl = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/postgres';

export async function createTestDatabase(name) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 6 });

  await pool.query(readFileSync(join(here, 'supabase-shim.sql'), 'utf8'));
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await pool.query(readFileSync(join(migrationsDir, file), 'utf8'));
  }
  return pool;
}

// actor: a user uuid (signed-in staff), 'anon' (public browser) or 'service' (trusted server).
export function makeRunner(pool) {
  async function run(actor, sql, params = []) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (actor === 'anon') {
        await client.query('set local role anon');
      } else if (actor === 'service') {
        await client.query('set local role service_role');
      } else {
        await client.query('set local role authenticated');
        await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [actor]);
      }
      const result = await client.query(sql, params);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // The statement must fail with an error whose message matches `pattern`.
  async function rejects(actor, sql, params, pattern) {
    await assert.rejects(() => run(actor, sql, params), (err) => {
      assert.match(err.message, pattern, `unexpected error: ${err.message}`);
      return true;
    });
  }

  // The statement must either fail outright or touch zero rows.
  async function blocked(actor, sql, params = []) {
    try {
      const result = await run(actor, sql, params);
      assert.equal(result.rowCount, 0, `expected no rows affected, got ${result.rowCount}: ${sql}`);
    } catch (err) {
      assert.match(err.message, /permission denied|row-level security|forbidden/i,
        `unexpected error: ${err.message}`);
    }
  }

  return { run, rejects, blocked };
}

export const DENIED = /permission denied|row-level security/i;
