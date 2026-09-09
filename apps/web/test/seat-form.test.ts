import { describe, expect, it } from 'vitest'

import { isValidDiscordId, isValidName } from '../src/seat-form.js'

describe('isValidName', () => {
  it('accepts 1-24 trimmed characters and rejects the rest', () => {
    expect(isValidName('Brian')).toBe(true)
    expect(isValidName('  Brian  ')).toBe(true)
    expect(isValidName('')).toBe(false)
    expect(isValidName('   ')).toBe(false)
    expect(isValidName('x'.repeat(25))).toBe(false)
    expect(isValidName('x'.repeat(24))).toBe(true)
  })
})

describe('isValidDiscordId', () => {
  it('accepts empty, a bare snowflake, and a mention; rejects garbage', () => {
    expect(isValidDiscordId('')).toBe(true)
    expect(isValidDiscordId('   ')).toBe(true)
    expect(isValidDiscordId('123456789012345678')).toBe(true)
    expect(isValidDiscordId('<@123456789012345678>')).toBe(true)
    expect(isValidDiscordId('<@!123456789012345678>')).toBe(true)
    expect(isValidDiscordId('not-an-id')).toBe(false)
    expect(isValidDiscordId('123')).toBe(false)
  })
})
