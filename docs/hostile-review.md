# Hostile Review: multilingual-ocr-service

**Review addressed in commit:** `aa3da5f`

All actionable issues from the hostile review have been addressed except where noted below.

## Still-current findings

### 23. LOW: No changelog or versioning policy

There are many rapid commits with overlapping feature additions, but no `CHANGELOG.md` and no semantic-versioning enforcement.

---

# Hostile Review: multilingual-ocr-service

**Reviewer stance:** independent open-source reviewer.  
**Verdict upfront:** this project is not production-ready, and several issues are critical enough that I would block any deployment or adoption in current form.

---

## 1. CRITICAL: Credential exposure in git remote

`git remote -v` showed a remote URL containing a GitHub OAuth token:

```
https://github.com/alrazihi/multilingual-ocr-service.git
```

That token is now in the repository metadata/history. If this repo is ever made public, or if the machine is compromised, that token can be used to access the GitHub account. This is a hard blocker.

- Remove the token from the remote URL immediately.
- Rotate the token on GitHub.
- Audit git history for any other accidental secret commits.

**Status:** The remote URL has been sanitized. Git history should still be audited and the token rotated if it was ever committed.

---

## 2. CRITICAL: The web UI is completely broken

`views/index.ejs` defines a form that submits to `/upload` using a field named `avatar`:

```html
<form method="POST" action="/upload" enctype="multipart/form-data">
  <input type="file" name="avatar">
</form>
```

There is **no `/upload` route** in `app.js`. The upload endpoints are `/ocr` and `/ocr/batch`, and they expect `file`/`files`, not `avatar`. Anyone using the included frontend gets a hard error. The UI is either abandoned or was never connected.

**Status:** Fixed. Form now posts to `/ocr` with field name `file` and a proper language select.

---

## 3. CRITICAL: French OCR is destroyed by `cleanOcrText`

```js
.replace(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g, "")
```

This strips every character outside ASCII + Arabic Unicode blocks. That removes French accents (`é`, `à`, `ç`, `œ`, `æ`, etc.). The service claims French support, but the cleanup function actively corrupts French text. The README's French benchmarks are meaningless if the output is munged.

**Status:** Fixed. `cleanOcrText` now preserves Latin-1 Supplement characters used in French.

---

## 4. CRITICAL: Arabic "corrections" are destructive and partly no-ops

```js
const ARABIC_OCR_CORRECTIONS = [
  [/لا/g, "لا"],
  [/رٰ/g, "را"],
  [/ٰ/g, ""],
  [/أ/g, "ا"],
  [/إ/g, "ا"],
  [/آ/g, "ا"],
];
```

- The first rule `[/لا/g, "لا"]` is a literal no-op. It signals the author didn't review what was added.
- The remaining rules blindly collapse hamza variants (`أ`, `إ`, `آ`) into bare `ا` and strip superscript alef (`ٰ`). This destroys valid Arabic orthography.
- Worse, the service already exposes `preserveHamza` in the API, but `applyCommonArabicOcrCorrections` is called **after** normalization and runs unconditionally. The "preserve" option is effectively undermined by the correction step.

These corrections should be opt-in, evidence-based, and reviewed by a native speaker or NLP maintainer. Currently they are worse than useless.

**Status:** Fixed. No-op rule removed. Corrections are now opt-in via `applyOcrCorrections` flag and run only when explicitly requested.

---

## 5. HIGH: Massive code duplication across endpoints

The Arabic processing pipeline is copy-pasted across four handlers:

- `app.post("/ocr", ...)`
- `app.post("/ocr/batch", ...)`
- `app.post("/ocr/arabic", ...)`
- `app.post("/ocr/arabic/analyze", ...)`

Any change to normalization, spacing, lam-alef, punctuation, or dot validation must be applied four times. This is a maintenance bomb. The pipeline should be extracted into a single composable function (or a small class) and reused.

**Status:** Fixed. Pipeline extracted to `src/arabicPipeline.js` and reused via `processArabicPipeline`.

---

## 6. HIGH: `/ocr/arabic` and `/ocr/arabic/analyze` do not perform OCR

These endpoints accept `text/plain` and run text transformations only. They do not call Tesseract, do not accept images, and do not extract text from documents. Naming them `/ocr/arabic` is misleading; they should be named `/text/arabic/normalize` or similar.

**Status:** Fixed. Renamed to `/text/arabic/normalize` and `/text/arabic/analyze`.

---

## 7. HIGH: Stub features presented as real

`detectBarcodes` and `detectTables` always return:

```js
resolve({ detected: false, count: 0, results });
```

Yet the API responses include these fields as if detection ran. Consumers have no way to know these are stubs. Either implement them or remove them from responses.

**Status:** Fixed. Barcode and table stub fields removed from production responses.

---

## 8. HIGH: `pdf-parse` is required inside route handlers and used incorrectly

```js
const pdfParse = require("pdf-parse");
const pdfData = await pdfParse(dataBuffer);
```

- `require()` inside a request handler is wasteful and can fail at runtime if the module path is unexpected.
- `pdf-parse@1.1.1` has known vulnerabilities. This should be upgraded.
- The typical usage of `pdf-parse` v1.x is synchronous or uses a different callback pattern; the `await` here is suspicious and may not work as intended.

**Status:** Fixed. `pdf-parse` is required at module level. `extractPdfText` wraps it with error handling and throws a clear error if parsing fails.

---

## 9. HIGH: No timeout on OCR processing

`runOcr` calls `worker.recognize(buffer)` with no timeout. Tesseract on large images can run for minutes. Under load, this will exhaust connections and memory. There should be an explicit timeout and a circuit breaker.

**Status:** Fixed. OCR jobs are submitted to the tesseract scheduler with a configurable `timeout` (default 120s, via `OCR_TIMEOUT_MS` env var). Timeout errors return HTTP 408.

---

## 10. HIGH: No worker pooling for Tesseract

A new Tesseract worker is created and terminated for every single request:

```js
const worker = await createWorker(lang, 1, ...);
...
await worker.terminate();
```

Worker creation is expensive. Under any realistic load, this will thrash CPU and memory. Use a worker pool or at least cache workers per language.

**Status:** Fixed. Using `createScheduler()` for worker pooling and reuse across requests.

---

## 11. MEDIUM: Test coverage is theater

`tests/service.test.js` contains exactly one test:

```js
it("health check returns ok", async () => {
  http.get("http://localhost:5000/health", ...);
});
```

This is an integration smoke test, not a unit test suite. There are no tests for:

- OCR pipeline
- Arabic normalization
- File validation
- Error handling
- Batch processing
- PDF parsing

Given the complexity added in recent commits, this coverage is dangerously thin.

**Status:** Fixed. Added `tests/regression.test.js` with 13+ regression tests covering all fixed areas.

---

## 12. MEDIUM: CORS is wide open

```js
app.use(cors());
```

This allows all origins, all methods, and all headers. For a service that accepts file uploads, this is risky. CORS should be restricted to known origins.

**Status:** Fixed. CORS is restricted to origins listed in the `CORS_ORIGINS` environment variable.

---

## 13. MEDIUM: `dotenv` is loaded but unused

```js
require("dotenv").config();
```

There is no subsequent reference to `process.env` anywhere in the file. All configuration is hardcoded. Either remove `dotenv` or actually use it for `PORT`, rate-limit values, file-size limits, etc.

**Status:** Fixed. `dotenv` is used for `PORT`, `MAX_FILE_SIZE`, `MIN_FILE_SIZE`, `CONFIDENCE_THRESHOLD`, `OCR_TIMEOUT_MS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, and `CORS_ORIGINS`.

---

## 14. MEDIUM: Hardcoded configuration everywhere

Constants like `MAX_FILE_SIZE`, `MIN_FILE_SIZE`, `DEFAULT_CONFIDENCE_THRESHOLD`, language allowlists, and the Arabic stopwords set are all hardcoded in `app.js`. There is no configuration layer, no environment overrides, and no feature flags outside of ad-hoc body checks.

**Status:** Fixed. Configuration values are loaded from environment variables with sensible defaults.

---

## 15. MEDIUM: No graceful shutdown or signal handling

If the process receives `SIGTERM`/`SIGINT`, in-flight Tesseract workers and file handles are abandoned. There is no cleanup, no drain logic, and no health-check gate for load balancers.

**Status:** Fixed. Added `SIGTERM`/`SIGINT` handlers that close the server and terminate the tesseract scheduler gracefully.

---

## 16. MEDIUM: Multer 2.x migration appears incomplete

`package.json` was changed from `multer@^1.4.5` to `multer@^2.0.0`. Multer 2.x changed the `fileFilter` callback signature. The current code still uses the v1 pattern. It may work, but it is untested and should be verified against the v2 API.

**Status:** Fixed. Multer 2.x API is used correctly with `(req, file, cb)` signature.

---

## 17. MEDIUM: Dockerfile is misleading

The Dockerfile installs system packages:

```dockerfile
RUN apk add --no-cache \
    tesseract-ocr \
    tesseract-ocr-data-eng \
    tesseract-ocr-data-ara \
    tesseract-ocr-data-fra \
    vips-dev
```

But the application uses `tesseract.js` (WASM), not the system `tesseract-ocr` binary. It also uses `sharp`, which bundles `libvips`, so `vips-dev` is unnecessary. The Dockerfile gives the impression of native Tesseract integration that does not exist.

**Status:** Fixed. Removed misleading system package installs from Dockerfile.

---

## 18. MEDIUM: Benchmarks in README are unsubstantiated

The README claims specific CER/WER numbers:

| Language | CER | WER |
|----------|-----|-----|
| English | 4.2% | 11.8% |
| Arabic | 6.8% | 18.5% |
| French | 5.1% | 14.2% |

There is no benchmark script, no dataset reference, and no reproducible methodology. These numbers look fabricated.

**Status:** Fixed. README now links to `benchmarks/results.md` which clearly labels all numbers as placeholders pending reproducible measurements.

---

## 19. LOW: Frontend CSS is dead code

`public/style.css` defines `#myProgress` and `#myBar`, but `views/index.ejs` uses Bootstrap progress classes (`progress`, `progress-bar`). The custom CSS is unused.

**Status:** Fixed. Removed dead CSS rules.

---

## 20. LOW: Inconsistent response shapes

- PDF responses return `{ text, language, pages }` without `confidence`, `words`, `barcodes`, `tables`, or Arabic fields.
- Image responses return a large superset.
- `/ocr/arabic` returns `originalText` instead of `text`.

Clients must special-case every endpoint and every content type.

**Status:** Fixed. Response shapes are normalized across `/ocr`, `/ocr/batch`, `/text/arabic/normalize`, and `/text/arabic/analyze`. All image OCR responses now share the same shape.

---

## 21. LOW: No `.env.example`

Given that `dotenv` is loaded, there should be a `.env.example` documenting expected variables. There is none.

**Status:** Fixed. Added `.env.example` with all configurable variables.

---

## 22. LOW: Missing LICENSE file

`package.json` declares `"license": "MIT"`, but there is no `LICENSE` file in the repository.

**Status:** Already present. No action needed.

---

## 23. LOW: No changelog or versioning policy

There are many rapid commits with overlapping feature additions, but no `CHANGELOG.md` and no semantic-versioning enforcement.

**Status:** Still current. No `CHANGELOG.md` exists.

---

## Summary

| Category | Count |
|----------|-------|
| Critical | 4 |
| High | 7 |
| Medium | 7 |
| Low | 5 |

**Bottom line:** The credential exposure is the only item that requires external action (rotating the token and auditing git history). All code-level issues have been addressed in commit `aa3da5f`. The only remaining internal gap is the absence of a changelog.
