import { describe, expect, it } from 'vitest'
import { baseUrlFor } from '../assistant/chat.js'

describe('assistant endpoint configuration', () => {
  const gemini = 'https://generativelanguage.googleapis.com/v1beta/openai'

  it('normalises the way people paste a base URL', () => {
    for (const v of [
      'https://generativelanguage.googleapis.com/v1beta/openai/',
      'https://generativelanguage.googleapis.com/v1beta/openai//',
      '  "https://generativelanguage.googleapis.com/v1beta/openai/"  ',
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions/',
    ]) {
      expect(baseUrlFor('AIzaKey', v)).toBe(gemini)
    }
  })

  it('guesses the provider from the key prefix only when no base URL is set', () => {
    expect(baseUrlFor('AIzaSomething', '')).toContain('generativelanguage.googleapis.com')
    expect(baseUrlFor('sk-or-x', undefined)).toContain('openrouter.ai')
    expect(baseUrlFor('sk-proj-x', undefined)).toBe('https://api.openai.com/v1')
    expect(baseUrlFor('AIzaSomething', 'https://example.com/v1')).toBe('https://example.com/v1')
  })
})
