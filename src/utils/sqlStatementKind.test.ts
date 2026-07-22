import { describe, expect, it } from 'vitest'
import {
  classifyBatch,
  classifyStatement,
  isReadOnlyBatch
} from './sqlStatementKind'

describe('classifyStatement', () => {
  it('treats SELECT as read', () => {
    expect(classifyStatement('SELECT * FROM users').kind).toBe('read')
  })

  it('treats SHOW and DESCRIBE as read', () => {
    expect(classifyStatement('SHOW TABLES').kind).toBe('read')
    expect(classifyStatement('DESCRIBE users').kind).toBe('read')
  })

  it('treats plain EXPLAIN as read', () => {
    expect(classifyStatement('EXPLAIN SELECT * FROM users').kind).toBe('read')
  })

  it('treats EXPLAIN ANALYZE of a DELETE as a write, because it really executes', () => {
    const risk = classifyStatement('EXPLAIN ANALYZE DELETE FROM users')
    expect(risk.kind).toBe('write')
    expect(risk.unbounded).toBe(true)
  })

  it('treats INSERT and UPDATE as write', () => {
    expect(classifyStatement("INSERT INTO t (a) VALUES (1)").kind).toBe('write')
    expect(classifyStatement('UPDATE t SET a = 1 WHERE id = 2').kind).toBe('write')
  })

  it('treats DROP, TRUNCATE and ALTER as schema', () => {
    expect(classifyStatement('DROP TABLE users').kind).toBe('schema')
    expect(classifyStatement('TRUNCATE TABLE users').kind).toBe('schema')
    expect(classifyStatement('ALTER TABLE users ADD COLUMN a INT').kind).toBe('schema')
  })

  it('treats BEGIN and COMMIT as transaction', () => {
    expect(classifyStatement('BEGIN').kind).toBe('transaction')
    expect(classifyStatement('COMMIT').kind).toBe('transaction')
  })

  it('flags UPDATE without WHERE as unbounded', () => {
    expect(classifyStatement('UPDATE users SET active = 0').unbounded).toBe(true)
  })

  it('flags DELETE without WHERE as unbounded', () => {
    expect(classifyStatement('DELETE FROM users').unbounded).toBe(true)
  })

  it('does not flag DELETE with a WHERE clause', () => {
    expect(classifyStatement('DELETE FROM users WHERE id = 1').unbounded).toBe(false)
  })

  it('ignores the word WHERE inside a string literal', () => {
    const risk = classifyStatement("DELETE FROM logs -- where\n")
    expect(risk.unbounded).toBe(true)
    expect(classifyStatement("UPDATE t SET note = 'where' ").unbounded).toBe(true)
  })

  it('does not treat a WHERE inside a block comment as a real clause', () => {
    expect(classifyStatement('DELETE FROM t /* WHERE id = 1 */').unbounded).toBe(true)
  })

  it('resolves a CTE that ends in DELETE to write', () => {
    const risk = classifyStatement(
      'WITH doomed AS (SELECT id FROM users) DELETE FROM users WHERE id IN (SELECT id FROM doomed)'
    )
    expect(risk.kind).toBe('write')
    expect(risk.unbounded).toBe(false)
  })

  it('resolves a read-only CTE to read', () => {
    expect(
      classifyStatement('WITH recent AS (SELECT * FROM logs) SELECT * FROM recent').kind
    ).toBe('read')
  })

  it('treats an unrecognised verb as a write, erring on the safe side', () => {
    expect(classifyStatement('FROBNICATE something').kind).toBe('write')
  })

  it('returns read for empty input', () => {
    expect(classifyStatement('   ').kind).toBe('read')
  })
})

describe('classifyBatch', () => {
  it('reports the highest risk in the batch', () => {
    const risk = classifyBatch('SELECT 1; DROP TABLE users;')
    expect(risk.statementCount).toBe(2)
    expect(risk.highest).toBe('schema')
  })

  it('counts unbounded statements', () => {
    const risk = classifyBatch('DELETE FROM a; UPDATE b SET x = 1; SELECT 1;')
    expect(risk.unboundedCount).toBe(2)
  })

  it('handles an empty batch', () => {
    const risk = classifyBatch('')
    expect(risk.statementCount).toBe(0)
    expect(risk.highest).toBe('read')
  })
})

describe('isReadOnlyBatch', () => {
  it('is true for selects and transaction control', () => {
    expect(isReadOnlyBatch(classifyBatch('BEGIN; SELECT * FROM t; COMMIT;'))).toBe(true)
  })

  it('is false when any statement writes', () => {
    expect(isReadOnlyBatch(classifyBatch('SELECT 1; DELETE FROM t WHERE id = 1;'))).toBe(false)
  })
})
