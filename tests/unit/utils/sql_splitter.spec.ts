import { test } from '@japa/runner'
import { splitSqlStatements } from '../../../src/utils/sql_splitter.js'

test.group('splitSqlStatements — basic splitting', () => {
  test('empty string returns empty array', ({ assert }) => {
    assert.deepEqual(splitSqlStatements(''), [])
  })

  test('whitespace-only string returns empty array', ({ assert }) => {
    assert.deepEqual(splitSqlStatements('   \n\t  '), [])
  })

  test('single statement with semicolon', ({ assert }) => {
    const result = splitSqlStatements('SELECT 1;')
    assert.lengthOf(result, 1)
    assert.equal(result[0], 'SELECT 1')
  })

  test('single statement without trailing semicolon', ({ assert }) => {
    const result = splitSqlStatements('SELECT 1')
    assert.lengthOf(result, 1)
    assert.equal(result[0], 'SELECT 1')
  })

  test('multiple statements split correctly', ({ assert }) => {
    const sql = `CREATE TABLE foo (id int);
INSERT INTO foo VALUES (1);
INSERT INTO foo VALUES (2);`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 3)
    assert.include(result[0], 'CREATE TABLE foo')
    assert.include(result[1], 'INSERT INTO foo VALUES (1)')
    assert.include(result[2], 'INSERT INTO foo VALUES (2)')
  })

  test('blank statements between semicolons are filtered', ({ assert }) => {
    const result = splitSqlStatements('SELECT 1;;; SELECT 2;')
    assert.lengthOf(result, 2)
  })

  test('leading and trailing whitespace stripped from statements', ({ assert }) => {
    const result = splitSqlStatements('  SELECT 1  ;')
    assert.equal(result[0], 'SELECT 1')
  })
})

test.group('splitSqlStatements — single-quoted strings', () => {
  test('semicolon inside single-quoted string is not a separator', ({ assert }) => {
    const result = splitSqlStatements(`INSERT INTO t VALUES ('hello; world');`)
    assert.lengthOf(result, 1)
    assert.include(result[0], 'hello; world')
  })

  test('escaped single-quote (doubled) inside string', ({ assert }) => {
    const result = splitSqlStatements(`INSERT INTO t VALUES ('it''s fine');`)
    assert.lengthOf(result, 1)
    assert.include(result[0], "it''s fine")
  })

  test('multiple strings in one statement', ({ assert }) => {
    const result = splitSqlStatements(`INSERT INTO t VALUES ('a;b', 'c;d');`)
    assert.lengthOf(result, 1)
  })
})

test.group('splitSqlStatements — dollar-quoted strings', () => {
  test('semicolon inside $$ dollar-quoted block is not a separator', ({ assert }) => {
    const sql = `CREATE FUNCTION f() RETURNS void AS $$
BEGIN
  INSERT INTO t VALUES (1); -- this semicolon must not split
END;
$$ LANGUAGE plpgsql;`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
    assert.include(result[0], 'plpgsql')
  })

  test('named dollar-quote tag ($BODY$...$BODY$)', ({ assert }) => {
    const sql = `CREATE FUNCTION g() RETURNS void AS $BODY$
BEGIN
  RAISE NOTICE 'hello; world';
END;
$BODY$ LANGUAGE plpgsql;`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
    assert.include(result[0], '$BODY$')
  })

  test('statement after dollar-quoted block is parsed separately', ({ assert }) => {
    const sql = `DO $$ BEGIN NULL; END $$;
SELECT 1;`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 2)
    assert.include(result[0], 'DO')
    assert.include(result[1], 'SELECT 1')
  })
})

test.group('splitSqlStatements — comments', () => {
  test('semicolon inside line comment is not a separator', ({ assert }) => {
    const sql = `SELECT 1 -- this; is a comment
;`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
    assert.include(result[0], '-- this; is a comment')
  })

  test('semicolon inside block comment is not a separator', ({ assert }) => {
    const sql = `SELECT /* value; here */ 1;`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
  })

  test('block comment spanning multiple lines', ({ assert }) => {
    const sql = `SELECT
/* multi
   line;
   comment */
1;`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
  })

  test('statement after line comment is parsed on next line', ({ assert }) => {
    const sql = `-- drop old stuff
SELECT 1;`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
    assert.include(result[0], 'SELECT 1')
  })
})

test.group('splitSqlStatements — psql meta-commands', () => {
  test('\\connect meta-command line is skipped', ({ assert }) => {
    const sql = `\\connect mydb
SELECT 1;`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
    assert.equal(result[0], 'SELECT 1')
  })

  test('\\set meta-command line is skipped', ({ assert }) => {
    const sql = `\\set ON_ERROR_STOP on
CREATE TABLE t (id int);`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
    assert.include(result[0], 'CREATE TABLE')
  })

  test('multiple meta-commands all skipped', ({ assert }) => {
    const sql = `\\connect mydb
\\set ON_ERROR_STOP on
SELECT 1;`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
  })
})

test.group('splitSqlStatements — pg_dump realistic content', () => {
  test('pg_dump header block produces no statements', ({ assert }) => {
    const header = `--
-- PostgreSQL database dump
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SELECT pg_catalog.set_config('search_path', '', false);`
    const result = splitSqlStatements(header)
    assert.isAbove(result.length, 0)
    for (const stmt of result) {
      assert.isAbove(stmt.trim().length, 0)
    }
  })

  test('CREATE TABLE statement is parsed as single statement', ({ assert }) => {
    const sql = `CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    created_at timestamp without time zone
);`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 1)
    assert.include(result[0], 'CREATE TABLE')
    assert.include(result[0], 'created_at')
  })

  test('ALTER TABLE statements each parsed individually', ({ assert }) => {
    const sql = `ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);`
    const result = splitSqlStatements(sql)
    assert.lengthOf(result, 2)
  })

  test('COPY ... FROM stdin block handled correctly', ({ assert }) => {
    const sql = `COPY public.users (id, email) FROM stdin;
1\tacme@test.com
\\.
SELECT 1;`
    const result = splitSqlStatements(sql)
    const hasSelect = result.some((s) => s.includes('SELECT 1'))
    assert.isTrue(hasSelect)
  })
})
