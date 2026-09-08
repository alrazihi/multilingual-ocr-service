const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const path = require("path");

const { app } = require("../app");
const { processArabicPipeline, cleanOcrText } = require("../src/arabicPipeline");

describe("OCR Service Regression Tests", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.on("listening", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      server.close();
      await new Promise((resolve) => server.on("close", resolve));
    }
  });

  describe("French accent preservation", () => {
    it("preserves accents in cleanOcrText", () => {
      const input = "Café résumé façade naïve crème œufs à la carte";
      const result = cleanOcrText(input);
      assert.ok(result.includes("é"), "Should preserve é");
      assert.ok(result.includes("è"), "Should preserve è");
      assert.ok(result.includes("ï"), "Should preserve ï");
      assert.ok(result.includes("œ"), "Should preserve œ");
      assert.ok(result.includes("à"), "Should preserve à");
      assert.ok(result.includes("ç"), "Should preserve ç");
    });

    it("preserves French text through Arabic pipeline when no Arabic detected", () => {
      const result = processArabicPipeline("Café résumé");
      assert.strictEqual(result.text, "Café résumé");
      assert.strictEqual(result.containsArabic, false);
    });
  });

  describe("Arabic corrections opt-in behavior", () => {
    it("does not apply corrections by default", () => {
      const input = "أهلا بك";
      const result = processArabicPipeline(input);
      assert.strictEqual(result.correctedText, result.normalizedText, "correctedText should equal normalizedText when corrections are off");
    });

    it("applies corrections only when applyOcrCorrections is true", () => {
      const input = "أهلا بك";
      const result = processArabicPipeline(input, { applyOcrCorrections: true });
      assert.ok(!result.correctedText.includes("أ"), "Should replace hamza when corrections are enabled");
    });

    it("does not contain no-op correction rules", () => {
      const src = fs.readFileSync(path.join(__dirname, "..", "src", "arabicPipeline.js"), "utf-8");
      assert.ok(!src.includes("[/لا/g, \"لا\"]"), "No-op rule [/لا/g, 'لا'] should be removed");
    });
  });

  describe("Arabic pipeline deduplication", () => {
    it("imports shared module in tests without duplicating logic", () => {
      const moduleKeys = Object.keys(require("../src/arabicPipeline"));
      assert.ok(moduleKeys.includes("processArabicPipeline"), "Should export processArabicPipeline");
      assert.ok(moduleKeys.includes("cleanOcrText"), "Should export cleanOcrText");
    });
  });

  describe("Endpoint naming and behavior", () => {
    it("/text/arabic/normalize does not perform OCR", async () => {
      const res = await new Promise((resolve) => {
        const req = http.request(
          `${baseUrl}/text/arabic/normalize?preserveHamza=false`,
          { method: "POST", headers: { "Content-Type": "text/plain" } },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
          }
        );
        req.write("نص عربي");
        req.end();
      });
      assert.strictEqual(res.status, 200);
      assert.ok("normalizedText" in res.body, "Should return normalized text");
      assert.ok(!("confidence" in res.body), "Should not contain OCR confidence");
    });

    it("/text/arabic/analyze returns word frequency", async () => {
      const res = await new Promise((resolve) => {
        const req = http.request(
          `${baseUrl}/text/arabic/analyze`,
          { method: "POST", headers: { "Content-Type": "text/plain" } },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
          }
        );
        req.write("هذا نص عربي للتجربة");
        req.end();
      });
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.wordFrequency), "Should return wordFrequency array");
    });

    it("legacy /ocr/arabic route is removed", async () => {
      const res = await new Promise((resolve) => {
        const req = http.request(
          `${baseUrl}/ocr/arabic`,
          { method: "POST", headers: { "Content-Type": "text/plain" } },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode }));
          }
        );
        req.write("test");
        req.end();
      });
      assert.strictEqual(res.status, 404, "Legacy /ocr/arabic route should not exist");
    });

    it("legacy /ocr/arabic/analyze route is removed", async () => {
      const res = await new Promise((resolve) => {
        const req = http.request(
          `${baseUrl}/ocr/arabic/analyze`,
          { method: "POST", headers: { "Content-Type": "text/plain" } },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode }));
          }
        );
        req.write("test");
        req.end();
      });
      assert.strictEqual(res.status, 404, "Legacy /ocr/arabic/analyze route should not exist");
    });
  });

  describe("Response shape consistency", () => {
    it("Arabic pipeline returns consistent shape across endpoints", () => {
      const result = processArabicPipeline("نص عربي للتجربة");
      assert.ok("text" in result, "Should have text");
      assert.ok("normalizedText" in result);
      assert.ok("correctedText" in result);
      assert.ok("dotsValidatedText" in result);
      assert.ok("nonsenseFilteredText" in result);
      assert.ok("easternNumeralsText" in result);
      assert.ok("spacingFixedText" in result);
      assert.ok("lamAlefReconstructed" in result);
      assert.ok("punctuationFixedText" in result);
      assert.ok("rtlEnforcedText" in result);
      assert.ok("withoutStopwords" in result);
      assert.ok("containsArabic" in result);
      assert.ok("direction" in result);
      assert.ok("statistics" in result);
    });

    it("uses text key consistently instead of originalText", () => {
      const result = processArabicPipeline("نص عربي");
      assert.ok(!("originalText" in result), "originalText should not be present");
    });
  });

  describe("CORS origin restriction", () => {
    it("allows configured origins", async () => {
      const res = await new Promise((resolve) => {
        const req = http.request(
          `${baseUrl}/health`,
          {
            method: "GET",
            headers: { Origin: "http://localhost:5000" },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
          }
        );
        req.on("error", () => resolve({ status: 0, headers: {} }));
        req.end();
      });
      assert.strictEqual(res.status, 200);
    });

    it("does not reflect arbitrary origins", async () => {
      const res = await new Promise((resolve) => {
        const req = http.request(
          `${baseUrl}/health`,
          {
            method: "GET",
            headers: { Origin: "http://evil.com" },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
          }
        );
        req.on("error", () => resolve({ status: 0, headers: {} }));
        req.end();
      });
      const allowOrigin = res.headers?.["access-control-allow-origin"];
      assert.notStrictEqual(allowOrigin, "http://evil.com", "Should not reflect evil.com origin");
    });
  });

  describe("PDF parse fallback/error handling", () => {
    it("throws unavailable error when pdf-parse or file access fails", () => {
      const { extractPdfText } = require("../app");
      assert.throws(() => extractPdfText("non-existent-file.pdf"), /PDF parsing is currently unavailable/);
    });
  });

  describe("OCR timeout/cancellation", () => {
    it("passes timeout option to tesseract scheduler", async () => {
      const originalCreateScheduler = require("tesseract.js").createScheduler;
      let capturedTimeout;
      const mockWorker = {
        recognize: async () => ({ data: { text: "mock", confidence: 90, words: [] } }),
        terminate: async () => {},
      };
      const mockScheduler = {
        addJob: async (lang, jobFn, opts) => {
          capturedTimeout = opts?.timeout;
          return jobFn(mockWorker);
        },
      };
      try {
        require("tesseract.js").createScheduler = () => mockScheduler;
        delete require.cache[require.resolve("../app")];
        const { runOcr } = require("../app");
        await runOcr(Buffer.alloc(16), "eng");
        assert.ok(capturedTimeout !== undefined, "timeout option should be passed to scheduler");
        assert.strictEqual(typeof capturedTimeout, "number", "timeout should be a number");
      } finally {
        require("tesseract.js").createScheduler = originalCreateScheduler;
        delete require.cache[require.resolve("../app")];
      }
    });
  });

  describe("Worker reuse", () => {
    it("reuses scheduler across requests", async () => {
      const appModule = require("../app");
      const scheduler1 = appModule.getScheduler();
      const scheduler2 = appModule.getScheduler();
      assert.strictEqual(scheduler1, scheduler2, "Scheduler should be reused across calls");
    });
  });
});
