# Test fixtures

Real files used by `test/fixtures.integration.test.ts` to exercise byte-exact
round-trips of multimodal + tabular data through the S3-backed store.

| File | Type | Source | License |
|------|------|--------|---------|
| `photo.jpg` | JPEG 640×480 | Lorem Picsum (`picsum.photos`, seed `agentbe`) → Unsplash | Free to use (Unsplash) |
| `logo.png` | PNG 601×203 RGBA | python.org community logo | PSF trademark — used only as a binary test fixture |
| `minimal.pdf` | PDF 1.5 | [py-pdf/sample-files](https://github.com/py-pdf/sample-files) `001-trivial` | BSD-3-Clause |
| `document.pdf` | PDF 1.5, 1pg | [py-pdf/sample-files](https://github.com/py-pdf/sample-files) `002-trivial-libre-office-writer` | BSD-3-Clause |
| `ag_exports.csv` | CSV | [plotly/datasets](https://github.com/plotly/datasets) `2011_us_ag_exports.csv` | Public sample data |

These are small (~180 KB total) and committed so the integration suite is
reproducible without network access.
