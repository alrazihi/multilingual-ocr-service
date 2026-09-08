const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { createWorker, createScheduler } = require("tesseract.js");
const sharp = require("sharp");
require("dotenv").config();

const { processArabicPipeline, tokenizeArabicText, containsArabic, detectTextDirection } = require("./src/arabicPipeline");

const app = express();

const PORT = parseInt(process.env.PORT || "5000", 10);
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || "10485760", 10);
const MIN_FILE_SIZE = parseInt(process.env.MIN_FILE_SIZE || "1024", 10);
const DEFAULT_CONFIDENCE_THRESHOLD = parseInt(process.env.CONFIDENCE_THRESHOLD || "60", 10);
const OCR_TIMEOUT_MS = parseInt(process.env.OCR_TIMEOUT_MS || "120000", 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "20", 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10);
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5000"];

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/tiff", "image/bmp"];
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".pdf"];
const VALID_LANGUAGES = ["eng", "ara", "fra", "eng+ara", "eng+fra", "ara+fra", "eng+ara+fra"];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || CORS_ORIGINS.includes("*") || CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(helmet());
app.use(cors(corsOptions));
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));

const uploadLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads, please try again later." },
});

function validateImageFormat(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return `Unsupported file extension: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`;
  }
  if (file.mimetype && !ALLOWED_IMAGE_TYPES.includes(file.mimetype) && file.mimetype !== "application/pdf") {
    return `Unsupported MIME type: ${file.mimetype}`;
  }
  return null;
}

function validateFileSize(file) {
  if (!file.size || file.size < MIN_FILE_SIZE) {
    return `File too small: ${file.size} bytes. Minimum: ${MIN_FILE_SIZE} bytes`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File too large: ${file.size} bytes. Maximum: ${MAX_FILE_SIZE} bytes`;
  }
  return null;
}

function validateLanguage(lang) {
  if (!VALID_LANGUAGES.includes(lang)) {
    return `Unsupported language: ${lang}. Allowed: ${VALID_LANGUAGES.join(", ")}`;
  }
  return null;
}

function checkConfidenceThreshold(confidence, threshold = DEFAULT_CONFIDENCE_THRESHOLD) {
  if (confidence < threshold) {
    return { warning: true, message: `Low OCR confidence: ${confidence}% (threshold: ${threshold}%)` };
  }
  return { warning: false };
}

const pdfParse = require("pdf-parse");

function extractPdfText(filePath) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = pdfParse(dataBuffer);
    return pdfData.text || "";
  } catch (err) {
    console.error("PDF parsing error:", err);
    throw new Error("PDF parsing is currently unavailable");
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `ocr-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".pdf"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Unsupported file type"), false);
  },
});

let scheduler = null;

function getScheduler() {
  if (!scheduler) {
    scheduler = createScheduler();
  }
  return scheduler;
}

async function runOcr(buffer, lang = "eng") {
  const sched = getScheduler();
  const { data } = await sched.addJob(lang, (worker) => worker.recognize(buffer), {
    timeout: OCR_TIMEOUT_MS,
  });
  return data;
}

async function preprocessImage(imagePath) {
  const buffer = await sharp(imagePath)
    .resize({ width: 2000, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen()
    .toBuffer();
  return buffer;
}

function buildOcrResponse(result, lang, arabicOptions = {}) {
  const {
    convertNumerals = false,
    preserveHamza = false,
    preserveTaMarbuta = false,
    removeDiacritics = true,
    applyOcrCorrections = false,
  } = arabicOptions;

  const cleanedText = result.text || "";
  const confidenceWarning = checkConfidenceThreshold(result.confidence || 0);
  const arabicDetected = containsArabic(cleanedText);
  const direction = detectTextDirection(cleanedText);
  const pipeline = processArabicPipeline(cleanedText, {
    preserveHamza,
    preserveTaMarbuta,
    removeDiacritics,
    convertNumerals,
    applyOcrCorrections,
  });

  return {
    text: cleanedText,
    language: lang,
    confidence: result.confidence || 0,
    words: result.words?.length || 0,
    warning: confidenceWarning.warning,
    warningMessage: confidenceWarning.message,
    containsArabic: arabicDetected,
    direction,
    ...pipeline,
  };
}

const api = { runOcr, extractPdfText, getScheduler, buildOcrResponse, preprocessImage };

app.get("/", (req, res) => {
  res.json({
    service: "multilingual-ocr-service",
    status: "running",
    endpoints: ["/health", "/ocr", "/ocr/batch", "/text/arabic/normalize", "/text/arabic/analyze"],
    supportedLanguages: VALID_LANGUAGES,
    maxFileSize: `${MAX_FILE_SIZE / 1024 / 1024}MB`,
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "multilingual-ocr-service", timestamp: new Date().toISOString() });
});

app.post("/ocr", uploadLimiter, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const formatError = validateImageFormat(req.file);
  if (formatError) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: formatError });
  }

  const sizeError = validateFileSize(req.file);
  if (sizeError) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: sizeError });
  }

  const lang = req.body.lang || "eng";
  const langError = validateLanguage(lang);
  if (langError) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: langError });
  }

  const convertNumerals = req.body.convertNumerals === "true";
  const preserveHamza = req.body.preserveHamza === "true";
  const preserveTaMarbuta = req.body.preserveTaMarbuta === "true";
  const removeDiacritics = req.body.preserveDiacritics !== "true";
  const applyOcrCorrections = req.body.applyOcrCorrections === "true";

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === ".pdf") {
      const pdfText = api.extractPdfText(req.file.path);
      const fakeResult = { text: pdfText, confidence: 0, words: [] };
      const response = api.buildOcrResponse(fakeResult, lang, {
        convertNumerals,
        preserveHamza,
        preserveTaMarbuta,
        removeDiacritics,
        applyOcrCorrections,
      });
      response.pages = 1;
      res.json(response);
    } else {
      const buffer = await api.preprocessImage(req.file.path);
      const result = await api.runOcr(buffer, lang);
      res.json(api.buildOcrResponse(result, lang, {
        convertNumerals,
        preserveHamza,
        preserveTaMarbuta,
        removeDiacritics,
        applyOcrCorrections,
      }));
    }
  } catch (err) {
    console.error("OCR error:", err);
    if (err.message && err.message.includes("timeout")) {
      res.status(408).json({ error: "OCR processing timed out", message: err.message });
    } else {
      res.status(500).json({ error: "OCR processing failed", message: err.message });
    }
  } finally {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

app.post("/ocr/batch", uploadLimiter, upload.array("files", 10), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

  const lang = req.body.lang || "eng";
  const langError = validateLanguage(lang);
  if (langError) {
    return res.status(400).json({ error: langError });
  }

  const convertNumerals = req.body.convertNumerals === "true";
  const preserveHamza = req.body.preserveHamza === "true";
  const preserveTaMarbuta = req.body.preserveTaMarbuta === "true";
  const removeDiacritics = req.body.preserveDiacritics !== "true";
  const applyOcrCorrections = req.body.applyOcrCorrections === "true";

  const results = [];

  for (const file of req.files) {
    const formatError = validateImageFormat(file);
    if (formatError) {
      results.push({ file: file.originalname, error: formatError });
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      continue;
    }

    const sizeError = validateFileSize(file);
    if (sizeError) {
      results.push({ file: file.originalname, error: sizeError });
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      continue;
    }

    try {
      const ext = path.extname(file.originalname).toLowerCase();
      let result;
      if (ext === ".pdf") {
        const pdfText = api.extractPdfText(file.path);
        result = { text: pdfText, confidence: 0, words: [] };
      } else {
        const buffer = await api.preprocessImage(file.path);
        result = await api.runOcr(buffer, lang);
      }
      const response = api.buildOcrResponse(result, lang, {
        convertNumerals,
        preserveHamza,
        preserveTaMarbuta,
        removeDiacritics,
        applyOcrCorrections,
      });
      if (ext === ".pdf") response.pages = 1;
      results.push({ file: file.originalname, ...response });
    } catch (err) {
      results.push({ file: file.originalname, error: err.message });
    } finally {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  }

  res.json({ results, processed: results.length });
});

app.post("/text/arabic/normalize", express.text({ type: "text/plain", limit: "1mb" }), (req, res) => {
  const text = req.body || "";
  const query = req.query;

  const convertNumerals = query.convertNumerals === "true";
  const preserveHamza = query.preserveHamza === "true";
  const preserveTaMarbuta = query.preserveTaMarbuta === "true";
  const removeDiacritics = query.preserveDiacritics !== "true";
  const applyOcrCorrections = query.applyOcrCorrections === "true";

  const pipeline = processArabicPipeline(text, {
    preserveHamza,
    preserveTaMarbuta,
    removeDiacritics,
    convertNumerals,
    applyOcrCorrections,
  });

  res.json({
    ...pipeline,
    language: "ara",
  });
});

app.post("/text/arabic/analyze", express.text({ type: "text/plain", limit: "1mb" }), (req, res) => {
  const text = req.body || "";
  const query = req.query;

  const preserveHamza = query.preserveHamza === "true";
  const preserveTaMarbuta = query.preserveTaMarbuta === "true";
  const removeDiacritics = query.preserveDiacritics !== "true";

  const pipeline = processArabicPipeline(text, {
    preserveHamza,
    preserveTaMarbuta,
    removeDiacritics,
  });

  const tokens = tokenizeArabicText(pipeline.normalizedText);
  const wordFrequency = {};
  for (const token of tokens) {
    wordFrequency[token] = (wordFrequency[token] || 0) + 1;
  }
  const sortedFrequency = Object.entries(wordFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  res.json({
    ...pipeline,
    language: "ara",
    wordFrequency: sortedFrequency,
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  res.status(500).json({ error: err.message });
});

function gracefulShutdown() {
  console.log("Received shutdown signal, draining...");
  app.close(() => {
    console.log("HTTP server closed");
    if (scheduler) {
      scheduler.terminate();
    }
    process.exit(0);
  });
  setTimeout(() => {
    console.error("Forced shutdown due to timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

module.exports = { app, ...api };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`OCR service running on http://localhost:${PORT}`);
  });
}
