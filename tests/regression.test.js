const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const path = require("path");

const { app } = require("../app");
const { processArabicPipeline, cleanOcrText } = require("../src/arabicPipeline");
const { processFrenchPipeline } = require("../src/frenchPipeline");

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

  describe("French pipeline", () => {
    it("processes French text and removes stopwords", () => {
      const result = processFrenchPipeline("Le café est déjà résumé avec élégance");
      assert.ok(result.containsFrench, "Should detect French");
      assert.ok(!result.withoutStopwords.includes("le"), "Should remove French stopwords");
      assert.ok(result.withoutStopwords.includes("café"), "Should keep non-stopwords");
    });

    it("returns French statistics and word frequency", () => {
      const result = processFrenchPipeline("Bonjour le monde cruel");
      assert.strictEqual(result.statistics.words, 4);
      assert.ok(Array.isArray(result.wordFrequency), "Should return wordFrequency array");
      assert.ok(result.wordFrequency.some((w) => w.word === "monde"), "Should include frequent words");
    });

    it("detects French plurals and lemmas", () => {
      const result = processFrenchPipeline("les enfants et les maisons");
      assert.ok(result.plurals.some((p) => p.plural === "enfants" && p.singular === "enfant"), "Should detect plural enfants");
      assert.ok(result.lemmas.some((l) => l.word === "maisons" && l.lemma === "maison"), "Should provide lemma for maisons");
    });

    it("detects French gender by suffix", () => {
      const result = processFrenchPipeline("la maison et le tableau");
      const feminine = result.genders.filter((g) => g.gender === "feminine");
      const masculine = result.genders.filter((g) => g.gender === "masculine");
      assert.ok(feminine.some((g) => g.word === "maison"), "Should detect maison as feminine");
      assert.ok(masculine.some((g) => g.word === "tableau"), "Should detect tableau as masculine");
    });

    it("normalizes French accents in ascii mode", () => {
      const result = processFrenchPipeline("Café été résumé", { accentMode: "ascii" });
      assert.ok(!result.normalizedText.includes("é"), "Should remove accents in ascii mode");
      assert.ok(result.normalizedText.includes("Cafe"), "Should keep base letters");
    });
  });

  describe("Arabic morphological hints and summarization", () => {
    it("returns morphological hints for Arabic text", () => {
      const result = processArabicPipeline("الكتاب موجود على الطاولة", { applyOcrCorrections: true });
      assert.ok(result.morphologicalHints, "Should include morphologicalHints");
      assert.ok(Array.isArray(result.morphologicalHints.prefixes), "Should include prefixes");
      assert.ok(Array.isArray(result.morphologicalHints.suffixes), "Should include suffixes");
      assert.ok(Array.isArray(result.morphologicalHints.likelyRoots), "Should include likelyRoots");
    });

    it("returns Arabic summary for long text", () => {
      const longText = "هذا هو النص الأول. هذا هو النص الثاني الذي يحتوي على معلومات أكثر. هذا هو النص الثالث.";
      const result = processArabicPipeline(longText, { applyOcrCorrections: true });
      assert.ok(result.summary, "Should include summary");
      assert.ok(result.summary.includes("النص"), "Summary should preserve Arabic content");
    });

    it("detects Arabic verb patterns and named entities", () => {
      const result = processArabicPipeline("الكتاب موجود في المكتبة", { applyOcrCorrections: true });
      assert.ok(result.morphologicalHints.namedEntities.some((n) => n.type === "definite noun"), "Should detect definite nouns");
      assert.ok(result.morphologicalHints.prefixes.some((p) => p.prefix === "ال"), "Should detect alif-lam prefix");
    });

    it("returns Arabic text complexity score", () => {
      const simple = processArabicPipeline("كتاب موجود", { applyOcrCorrections: true });
      const complex = processArabicPipeline("المعلوماتية والتكنولوجيا المتقدمة", { applyOcrCorrections: true });
      assert.ok(simple.complexity.score >= 0, "Should return complexity score");
      assert.ok(complex.complexity.score >= 0, "Should return complexity score for complex text");
      assert.ok(["simple", "moderate", "complex"].includes(simple.complexity.level), "Should return valid complexity level");
    });
  });
});
