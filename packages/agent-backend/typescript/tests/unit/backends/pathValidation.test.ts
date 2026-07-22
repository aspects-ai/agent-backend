import { describe, it, expect } from 'vitest'
import path from 'path'
import { validateWithinBoundary, validateAbsoluteWithinRoot } from '../../../src/backends/pathValidation.js'
import { PathEscapeError } from '../../../src/types.js'

describe('validateWithinBoundary', () => {
  describe('relative paths', () => {
    it('should resolve simple relative path', () => {
      const result = validateWithinBoundary('file.txt', '/var/workspace', path)
      expect(result).toBe('/var/workspace/file.txt')
    })

    it('should resolve nested relative path', () => {
      const result = validateWithinBoundary('subdir/file.txt', '/var/workspace', path)
      expect(result).toBe('/var/workspace/subdir/file.txt')
    })

    it('should resolve current directory reference', () => {
      const result = validateWithinBoundary('.', '/var/workspace', path)
      expect(result).toBe('/var/workspace')
    })

    it('should resolve ./file reference', () => {
      const result = validateWithinBoundary('./file.txt', '/var/workspace', path)
      expect(result).toBe('/var/workspace/file.txt')
    })

    it('should normalize path with internal ..', () => {
      const result = validateWithinBoundary('a/b/../c', '/var/workspace', path)
      expect(result).toBe('/var/workspace/a/c')
    })

    it('should allow .. that stays within boundary', () => {
      const result = validateWithinBoundary('a/b/../../c', '/var/workspace', path)
      expect(result).toBe('/var/workspace/c')
    })
  })

  describe('absolute paths matching boundary', () => {
    it('should use absolute path directly when it matches boundary exactly', () => {
      const result = validateWithinBoundary('/var/workspace', '/var/workspace', path)
      expect(result).toBe('/var/workspace')
    })

    it('should use absolute path directly when it starts with boundary', () => {
      const result = validateWithinBoundary('/var/workspace/file.txt', '/var/workspace', path)
      expect(result).toBe('/var/workspace/file.txt')
    })

    it('should use absolute path directly for nested paths within boundary', () => {
      const result = validateWithinBoundary('/var/workspace/a/b/c.txt', '/var/workspace', path)
      expect(result).toBe('/var/workspace/a/b/c.txt')
    })

    it('should normalize absolute paths within boundary', () => {
      const result = validateWithinBoundary('/var/workspace/a/../b', '/var/workspace', path)
      expect(result).toBe('/var/workspace/b')
    })
  })

  describe('absolute paths not matching boundary (treated as relative)', () => {
    it('should treat /file.txt as relative to boundary', () => {
      const result = validateWithinBoundary('/file.txt', '/var/workspace', path)
      expect(result).toBe('/var/workspace/file.txt')
    })

    it('should treat /other/path as relative to boundary', () => {
      const result = validateWithinBoundary('/other/path/file.txt', '/var/workspace', path)
      expect(result).toBe('/var/workspace/other/path/file.txt')
    })

    it('should handle paths that look similar but do not match boundary', () => {
      // /var/workspace2 should NOT be treated as within /var/workspace
      const result = validateWithinBoundary('/var/workspace2/file.txt', '/var/workspace', path)
      expect(result).toBe('/var/workspace/var/workspace2/file.txt')
    })
  })

  describe('escape attempts (should throw)', () => {
    it('should reject simple parent escape', () => {
      expect(() => validateWithinBoundary('../etc/passwd', '/var/workspace', path))
        .toThrow(PathEscapeError)
    })

    it('should reject deep parent escape', () => {
      expect(() => validateWithinBoundary('../../../etc/passwd', '/var/workspace', path))
        .toThrow(PathEscapeError)
    })

    it('should reject escape via complex path', () => {
      expect(() => validateWithinBoundary('a/b/../../../../etc/passwd', '/var/workspace', path))
        .toThrow(PathEscapeError)
    })

    it('should reject escape that goes to boundary parent', () => {
      expect(() => validateWithinBoundary('..', '/var/workspace', path))
        .toThrow(PathEscapeError)
    })
  })

  describe('with path.posix (for remote/cross-platform)', () => {
    it('should handle relative paths with posix', () => {
      const result = validateWithinBoundary('file.txt', '/var/workspace', path.posix)
      expect(result).toBe('/var/workspace/file.txt')
    })

    it('should handle absolute paths matching boundary with posix', () => {
      const result = validateWithinBoundary('/var/workspace/file.txt', '/var/workspace', path.posix)
      expect(result).toBe('/var/workspace/file.txt')
    })

    it('should treat non-matching absolute paths as relative with posix', () => {
      const result = validateWithinBoundary('/other/file.txt', '/var/workspace', path.posix)
      expect(result).toBe('/var/workspace/other/file.txt')
    })

    it('should reject escape attempts with posix', () => {
      expect(() => validateWithinBoundary('../etc/passwd', '/var/workspace', path.posix))
        .toThrow(PathEscapeError)
    })
  })

  describe('scoped boundaries (non-root)', () => {
    it('should work with scope boundary', () => {
      const result = validateWithinBoundary('file.txt', 'users/user1', path.posix)
      expect(result).toBe('users/user1/file.txt')
    })

    it('should handle absolute path within scope', () => {
      // When scope is 'users/user1', an absolute path /users/user1/file should match
      const result = validateWithinBoundary('/users/user1/file.txt', 'users/user1', path.posix)
      expect(result).toBe('/users/user1/file.txt')
    })

    it('should treat non-matching absolute as relative to scope', () => {
      const result = validateWithinBoundary('/file.txt', 'users/user1', path.posix)
      expect(result).toBe('users/user1/file.txt')
    })

    it('should reject scope escape', () => {
      expect(() => validateWithinBoundary('../user2/secret', 'users/user1', path.posix))
        .toThrow(PathEscapeError)
    })

    it('should reject escape to parent of scope', () => {
      expect(() => validateWithinBoundary('../../etc', 'users/user1', path.posix))
        .toThrow(PathEscapeError)
    })
  })

  describe('edge cases', () => {
    it('should handle empty string as current directory', () => {
      const result = validateWithinBoundary('', '/var/workspace', path)
      expect(result).toBe('/var/workspace')
    })

    it('should handle multiple slashes in path', () => {
      const result = validateWithinBoundary('a//b///c', '/var/workspace', path)
      expect(result).toBe('/var/workspace/a/b/c')
    })

    it('should handle trailing slashes in boundary', () => {
      const result = validateWithinBoundary('file.txt', '/var/workspace/', path)
      expect(result).toBe('/var/workspace/file.txt')
    })
  })
})

describe('validateAbsoluteWithinRoot', () => {
  it('should accept path within root', () => {
    expect(() => validateAbsoluteWithinRoot('/var/workspace/file.txt', '/var/workspace', path))
      .not.toThrow()
  })

  it('should accept path equal to root', () => {
    expect(() => validateAbsoluteWithinRoot('/var/workspace', '/var/workspace', path))
      .not.toThrow()
  })

  it('should reject path outside root', () => {
    expect(() => validateAbsoluteWithinRoot('/etc/passwd', '/var/workspace', path))
      .toThrow(PathEscapeError)
  })

  it('should reject path that looks similar but is outside', () => {
    expect(() => validateAbsoluteWithinRoot('/var/workspace2/file', '/var/workspace', path))
      .toThrow(PathEscapeError)
  })

  it('should reject parent of root', () => {
    expect(() => validateAbsoluteWithinRoot('/var', '/var/workspace', path))
      .toThrow(PathEscapeError)
  })
})
