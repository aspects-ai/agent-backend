/**
 * Safeguard Verification Tests
 *
 * These tests verify that our safeguards actually prevent process spawning.
 * If these tests PASS, it means the safeguards are working correctly.
 */

import { describe, it, expect } from 'vitest'
import { testSafeguardsWork, isSafeguardError } from './helpers/testUtils.js'
import * as child_process from 'child_process'
import * as fs from 'fs/promises'

describe('Safeguard Verification', () => {
  describe('Global Mocks Prevent I/O', () => {
    it('should throw on unmocked spawn', () => {
      expect(() => {
        child_process.spawn('echo', ['test'])
      }).toThrow(/Unmocked spawn/)
    })

    it('should throw on unmocked exec', () => {
      expect(() => {
        child_process.exec('echo test', () => {})
      }).toThrow(/Unmocked exec/)
    })

    it('should throw on unmocked execSync', () => {
      expect(() => {
        child_process.execSync('echo test')
      }).toThrow(/Unmocked execSync/)
    })

    it('should throw on unmocked execFile', () => {
      expect(() => {
        child_process.execFile('echo', ['test'], () => {})
      }).toThrow(/Unmocked execFile/)
    })

    it('should throw on unmocked fork', () => {
      expect(() => {
        child_process.fork('./test.js')
      }).toThrow(/Unmocked fork/)
    })
  })

  describe('Filesystem Operations Throw', () => {
    it('should throw on unmocked readFile', async () => {
      await expect(fs.readFile('/test.txt'))
        .rejects.toThrow(/Unmocked fs\.readFile/)
    })

    it('should throw on unmocked writeFile', async () => {
      await expect(fs.writeFile('/test.txt', 'data'))
        .rejects.toThrow(/Unmocked fs\.writeFile/)
    })

    it('should throw on unmocked mkdir', async () => {
      await expect(fs.mkdir('/test'))
        .rejects.toThrow(/Unmocked fs\.mkdir/)
    })

    it('should throw on unmocked readdir', async () => {
      await expect(fs.readdir('/test'))
        .rejects.toThrow(/Unmocked fs\.readdir/)
    })

    it('should throw on unmocked stat', async () => {
      await expect(fs.stat('/test.txt'))
        .rejects.toThrow(/Unmocked fs\.stat/)
    })

    it('should throw on unmocked access', async () => {
      await expect(fs.access('/test.txt'))
        .rejects.toThrow(/Unmocked fs\.access/)
    })
  })

  describe('Error Detection', () => {
    it('should identify safeguard errors correctly', () => {
      try {
        child_process.spawn('test', [])
      } catch (error) {
        expect(isSafeguardError(error)).toBe(true)
      }
    })

    it('should not identify other errors as safeguard errors', () => {
      const regularError = new Error('Regular error')
      expect(isSafeguardError(regularError)).toBe(false)
    })
  })

  describe('Error Messages', () => {
    it('should provide helpful error messages', () => {
      try {
        child_process.spawn('test', ['arg1', 'arg2'])
      } catch (error) {
        const message = (error as Error).message

        // Should mention it's a unit test violation
        expect(message).toContain('UNIT TEST VIOLATION')

        // Should mention which function was called
        expect(message).toContain('spawn')

        // Should provide fix instructions
        expect(message).toContain('Fix:')
        expect(message).toContain('mockReturnValue')
      }
    })

    it('should show arguments in error message', () => {
      try {
        child_process.spawn('test-command', ['arg1', 'arg2'])
      } catch (error) {
        const message = (error as Error).message

        // Should show what arguments were passed
        expect(message).toContain('Arguments:')
      }
    })
  })
})

describe('Documentation Examples Work', () => {
  it('should demonstrate how safeguards prevent real I/O', () => {
    // This is what would happen if you tried to spawn without mocking:
    expect(() => {
      child_process.spawn('echo', ['hello'])
    }).toThrow(/Unmocked spawn/)

    // The error prevents any real process from being created
  })
})
