import { describe, expect, it } from 'vitest'
import { DEFAULT_EXCLUDE_PATTERNS } from '../../../src/server/tools.js'

describe('DEFAULT_EXCLUDE_PATTERNS', () => {
  describe('Pattern Contents', () => {
    it('should be exported and be an array', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toBeDefined()
      expect(Array.isArray(DEFAULT_EXCLUDE_PATTERNS)).toBe(true)
      expect(DEFAULT_EXCLUDE_PATTERNS.length).toBeGreaterThan(0)
    })

    it('should include common dependency directories', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('node_modules')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.venv')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('venv')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('__pycache__')
    })

    it('should include version control directories', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.git')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.svn')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.hg')
    })

    it('should include build artifact directories', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('dist')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('build')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.next')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('target')
    })

    it('should include cache directories', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.cache')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.pytest_cache')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.mypy_cache')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.ruff_cache')
    })

    it('should include coverage directories', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('coverage')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.coverage')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('htmlcov')
    })

    it('should include IDE directories', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.idea')
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('.vscode')
    })

    it('should include glob patterns for egg-info', () => {
      expect(DEFAULT_EXCLUDE_PATTERNS).toContain('*.egg-info')
    })
  })

  describe('Pattern Matching Behavior', () => {
    // Helper to check if a name matches any pattern
    function matchesExcludePattern(name: string): boolean {
      return DEFAULT_EXCLUDE_PATTERNS.some(pattern => {
        if (pattern.includes('*')) {
          // Simple glob matching for *.suffix patterns
          if (pattern.startsWith('*.')) {
            return name.endsWith(pattern.slice(1))
          }
          return false
        }
        return name === pattern
      })
    }

    it('should match exact directory names', () => {
      expect(matchesExcludePattern('node_modules')).toBe(true)
      expect(matchesExcludePattern('.git')).toBe(true)
      expect(matchesExcludePattern('.venv')).toBe(true)
    })

    it('should not match partial names', () => {
      expect(matchesExcludePattern('my_node_modules')).toBe(false)
      expect(matchesExcludePattern('node_modules_backup')).toBe(false)
      expect(matchesExcludePattern('venv2')).toBe(false)
    })

    it('should match glob patterns like *.egg-info', () => {
      expect(matchesExcludePattern('mypackage.egg-info')).toBe(true)
      expect(matchesExcludePattern('another-pkg.egg-info')).toBe(true)
    })

    it('should not match regular files or directories', () => {
      expect(matchesExcludePattern('src')).toBe(false)
      expect(matchesExcludePattern('README.md')).toBe(false)
      expect(matchesExcludePattern('package.json')).toBe(false)
      expect(matchesExcludePattern('app')).toBe(false)
    })
  })
})
