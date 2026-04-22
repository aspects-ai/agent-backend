# Changelog

All notable changes to AgentBackend will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `read_text_file` now paginates by default (first 1,000 lines) and truncates
  lines longer than 2,000 chars. Use `offset` and `limit` to read further.
  Full-file reads without paging will see a trailing footer indicating more
  content is available. This is a minor-version breaking change for callers
  that relied on unparameterised full-file reads.