// The check register, and what runChecks refuses to turn into a verdict.
//
// PLAN-014 M4a. The register is EMPTY here -- M4a ports no checks -- so the
// well-formedness assertion over the shipped CHECKS is vacuous today and stops
// being vacuous with M4b's first entry. The synthetic registers below are what
// make that line mean something before then: every rule it enforces is driven
// against a register that breaks it.

import { describe, expect, test } from 'bun:test'
import {
  assertRegisterWellFormed,
  checksFor,
  CHECKS,
  runChecks,
  type CheckCase,
  type ImageContext,
} from './checks.ts'

function check(over: Partial<CheckCase> & Pick<CheckCase, 'id' | 'run'>): CheckCase {
  return { shell: { pass: over.id }, ...over }
}

describe('the register refuses a shape that cannot be diffed', () => {
  test('the shipped register is well formed', () => {
    // Vacuous while CHECKS is empty -- M4a ports no checks -- and it stops
    // being vacuous with M4b's first entry. The refusals below are what make
    // this line mean something before then.
    expect(() => assertRegisterWellFormed()).not.toThrow()
    expect(CHECKS.length).toBeGreaterThanOrEqual(0)
  })

  test('an empty id is refused', () => {
    expect(() => assertRegisterWellFormed([check({ id: '', run: async () => [] })])).toThrow(/empty id/)
  })

  test('a duplicate id is refused', () => {
    const twin = [check({ id: 'a', run: async () => [] }), check({ id: 'a', run: async () => [] })]
    expect(() => assertRegisterWellFormed(twin)).toThrow(/two checks are registered as 'a'/)
  })

  test('an EMPTY pass matcher is refused -- it would claim the first line of the run', () => {
    const bad = [{ id: 'a', shell: { pass: '' }, run: async () => [] }]
    expect(() => assertRegisterWellFormed(bad)).toThrow(/claim the FIRST shell conclusion/)
  })

  test("'many' with no instance pattern is refused", () => {
    const bad = [{ id: 'a', cardinality: 'many' as const, shell: { pass: 'x' }, run: async () => [] }]
    expect(() => assertRegisterWellFormed(bad)).toThrow(/compared by count/)
  })

  test('boards: [] is refused -- it applies to no board and can never run', () => {
    const bad = [{ id: 'a', boards: [], shell: { pass: 'x' }, run: async () => [] }]
    expect(() => assertRegisterWellFormed(bad)).toThrow(/applies to no board/)
  })
})

describe('runChecks never turns a broken check into a verdict about the image', () => {
  const ctx = { board: { name: 'cx3576' } } as unknown as ImageContext

  test('a result labelled with another id is a failure, not a comparison', async () => {
    const run = await runChecks(ctx, [check({
      id: 'a',
      run: async () => [{ id: 'b', verdict: 'pass', message: 'x' }],
    })])
    expect(run.results).toHaveLength(0)
    expect(run.failures[0]?.error.message).toMatch(/labelled 'b'/)
  })

  test('a check that concludes NOTHING is a failure, not a quiet zero', async () => {
    const run = await runChecks(ctx, [check({ id: 'a', run: async () => [] })])
    expect(run.failures[0]?.error.message).toMatch(/ran and concluded nothing/)
  })

  test('a check that throws is recorded as a failure, never as a FAIL verdict', async () => {
    // "sgdisk would not run" is not a statement about the image. Folding it
    // into a fail would make the port disagree with the oracle for a reason
    // that is about neither.
    const run = await runChecks(ctx, [check({ id: 'a', run: async () => { throw new Error('sgdisk absent') } })])
    expect(run.results).toHaveLength(0)
    expect(run.failures).toEqual([{ id: 'a', error: expect.any(Error) }])
    expect(run.failures[0]?.error.message).toBe('sgdisk absent')
  })

  test('a check scoped to another board does not run here', async () => {
    let ran = false
    const run = await runChecks(ctx, [check({
      id: 'a', boards: ['x64'], run: async () => { ran = true; return [] },
    })])
    expect(ran).toBe(false)
    expect(run.failures).toHaveLength(0)
  })

  test('checksFor scopes by board name and lets an unscoped check through', () => {
    const all = [check({ id: 'any', run: async () => [] }), check({ id: 'x', boards: ['x64'], run: async () => [] })]
    expect(checksFor('cx3576', all).map(c => c.id)).toEqual(['any'])
    expect(checksFor('x64', all).map(c => c.id)).toEqual(['any', 'x'])
  })

  test("an empty register -- M4a's state -- produces no results and no failures", async () => {
    const run = await runChecks(ctx, [])
    expect(run.results).toEqual([])
    expect(run.failures).toEqual([])
  })
})
