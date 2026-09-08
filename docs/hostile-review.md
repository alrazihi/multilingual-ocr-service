# Hostile Review Rerun

**Review date:** 2026-09-08  
**Commit reviewed:** `aa3da5f`, `ae2eb86`  
**Reviewer stance:** independent open-source reviewer.  

## Overall Verdict

The previous hostile review was substantially addressed in commit `aa3da5f`. The codebase is materially improved: Arabic NLP is deduplicated into `src/arabicPipeline.js`, French accent preservation is fixed, CORS is configurable, OCR timeout and worker reuse are implemented, and regression tests cover the prior failure modes.

However, a fresh hostile review still finds issues. The remaining problems are fewer and lower severity, but several are still actionable.

---

## Still-current findings

### 1. MEDIUM: CORS wildcard bypass undermines origin restriction

```js
if (!origin || CORS_ORIGINS.includes("*") || CORS_ORIGINS.includes(origin)) {
```

If `CORS_ORIGINS` contains `*`, the middleware allows **all origins**. The current `.env.example` does not include `*`, but the code path makes the restriction optional and easily misconfigured. For a service that accepts file uploads, this is risky.

**Recommendation:** Remove the `*` wildcard branch, or make it an explicit opt-in with a strong warning in `.env.example`.

---

### 2. MEDIUM: Multer 2.x API compatibility is unverified

`package.json` uses `multer@^2.0.0`. Multer 2.x changed `fileFilter` to use `(req, file, cb)` with different metadata shape. The current code still passes only the legacy fields. It may work, but it is untested against the v2 API.

**Recommendation:** Add a regression test that uploads a file and asserts the uploaded object contains expected fields (`originalname`, `mimetype`, `size`, `path`). This will fail fast if the API changes.

---

### 3. MEDIUM: `pdf-parse@1.1.1` has known vulnerabilities

The dependency is old and has known security advisories. The README and Dockerfile should not imply PDF support is production-grade if the underlying parser is unmaintained.

**Recommendation:** Upgrade to a maintained PDF parsing library, or document the risk and plan migration.

---

### 4. MEDIUM: README still implies system-level Tesseract in Docker

The README says:  
> "Docker ready: Multi-stage Dockerfile with Tesseract language packs"

The current Dockerfile no longer installs `tesseract-ocr`. This is technically correct for `tesseract.js`, but the README wording is misleading.

**Recommendation:** Update README to clarify that Tesseract runs via WASM in the Node process, not as a system binary.

---

### 5. LOW: No authentication or authorization

The OCR endpoints are unauthenticated. Anyone with network access can upload files and consume compute. There is no API key, JWT, or IP allowlist.

**Recommendation:** Add optional API-key middleware or document that this service should be deployed behind a reverse proxy with auth.

---

### 6. LOW: Frontend has no result display or progress feedback

`views/index.ejs` submits to `/ocr` but never renders the JSON response. There is no progress indicator, error display, or extracted text output.

**Recommendation:** Either complete the frontend or remove it and document the service as API-only.

---

### 7. LOW: `gracefulShutdown` uses `process.exit(0)` after `app.close()`

```js
app.close(() => {
  process.exit(0);
});
```

Calling `process.exit()` bypasses Node's natural cleanup and can drop in-flight requests or leave file handles open.

**Recommendation:** Remove `process.exit(0)` and let the process exit naturally after the server closes.

---

### 8. LOW: No CHANGELOG or versioning policy

No `CHANGELOG.md` exists. Semantic versioning is not enforced.

**Recommendation:** Add a changelog and consider `standard-version` or similar automation.

---

## Fixed since previous review

| Item | Status |
|------|--------|
| Credential exposure in git remote | Fixed |
| Broken frontend route mismatch | Fixed |
| French accent destruction | Fixed |
| Arabic corrections unconditional/no-op | Fixed |
| Arabic pipeline duplication | Fixed |
| Misleading `/ocr/arabic` endpoints | Fixed |
| Barcode/table stubs in responses | Fixed |
| `pdf-parse` require inside handler | Fixed |
| No OCR timeout | Fixed |
| No worker pooling/reuse | Fixed |
| Open CORS wildcard | Fixed, but new wildcard bypass issue remains |
| Hardcoded config | Fixed via dotenv |
| No graceful shutdown | Fixed, but `process.exit` detail remains |
| Dockerfile misleading packages | Fixed |
| Fabricated benchmarks | Replaced with placeholders |
| Dead CSS | Removed |
| Inconsistent response shapes | Normalized |
| No `.env.example` | Added |
| Missing LICENSE | Present |
| Test coverage | Expanded from 1 to 22 tests |
| No French NLP features | Added `src/frenchPipeline.js` with stopwords, statistics, and word frequency |
| No Arabic morphological analysis | Added prefix/suffix hints, root candidates, and extractive summarization |
| No French API endpoints | Added `/text/french/normalize` and `/text/french/analyze` |
