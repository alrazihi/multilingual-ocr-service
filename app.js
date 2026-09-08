const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { createWorker } = require("tesseract.js");
const sharp = require("sharp");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads, please try again later." },
});

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/tiff", "image/bmp"];
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".pdf"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIN_FILE_SIZE = 1024;
const VALID_LANGUAGES = ["eng", "ara", "fra", "eng+ara", "eng+fra", "ara+fra", "eng+ara+fra"];
const DEFAULT_CONFIDENCE_THRESHOLD = 60;

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

function cleanOcrText(text) {
  if (!text) return "";
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g, "")
    .trim();
}

function containsArabic(text) {
  if (!text) return false;
  const arabicMatches = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g);
  if (!arabicMatches) return false;
  const totalChars = text.replace(/\s/g, "").length;
  return arabicMatches.length / totalChars > 0.3;
}

function detectTextDirection(text) {
  if (!text) return "ltr";
  const arabicMatches = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g);
  if (!arabicMatches) return "ltr";
  const totalChars = text.replace(/\s/g, "").length;
  const arabicRatio = arabicMatches.length / totalChars;
  if (arabicRatio > 0.5) return "rtl";
  if (arabicRatio > 0.1) return "mixed";
  return "ltr";
}

function normalizeArabicText(text, options = {}) {
  if (!text) return "";
  const { preserveHamza = false, preserveTatweel = false, removeDiacritics = true } = options;
  let normalized = text;
  if (!preserveHamza) {
    normalized = normalized.replace(/[أإآٱ]/g, "ا");
  }
  if (!options.preserveTaMarbuta) {
    normalized = normalized.replace(/ة/g, "ه");
  }
  normalized = normalized.replace(/ى/g, "ي");
  if (!preserveTatweel) {
    normalized = normalized.replace(/ـ/g, "");
  }
  if (removeDiacritics) {
    normalized = normalized.replace(/[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, "");
  }
  return normalized.trim();
}

function convertToEasternArabicNumerals(text) {
  if (!text) return "";
  const easternNumerals = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return text.replace(/[0-9]/g, (d) => easternNumerals[parseInt(d, 10)]);
}

const ARABIC_STOPWORDS = new Set([
  "من",
  "إلى",
  "عن",
  "على",
  "في",
  "هذا",
  "هذه",
  "ذلك",
  "التي",
  "الذي",
  "كان",
  "قد",
  "لا",
  "ما",
  "مع",
  "أو",
  "كل",
  "بين",
  "كما",
  "أي",
  "منها",
  "إذ",
  "إذا",
  "لكن",
  "بل",
  "حتى",
  "مما",
  "فإن",
  "وقد",
]);

function tokenizeArabicText(text) {
  if (!text) return [];
  return text
    .replace(/[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function removeArabicStopwords(text) {
  if (!text) return "";
  const tokens = tokenizeArabicText(text);
  const filtered = tokens.filter((token) => !ARABIC_STOPWORDS.has(token));
  return filtered.join(" ");
}

function getArabicTextStatistics(text) {
  if (!text) return { words: 0, characters: 0, arabicCharacters: 0, uniqueWords: 0, stopwordsRemoved: 0 };
  const tokens = tokenizeArabicText(text);
  const words = tokens.length;
  const characters = text.replace(/\s/g, "").length;
  const arabicMatches = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g);
  const arabicCharacters = arabicMatches ? arabicMatches.length : 0;
  const uniqueWords = new Set(tokens).size;
  const stopwordsRemoved = tokens.filter((token) => ARABIC_STOPWORDS.has(token)).length;
  return { words, characters, arabicCharacters, uniqueWords, stopwordsRemoved };
}

function detectBarcodes(imagePath) {
  return new Promise((resolve) => {
    const results = [];
    resolve({ detected: false, count: 0, results });
  });
}

function detectTables(imagePath) {
  return new Promise((resolve) => {
    const tables = [];
    resolve({ detected: false, count: 0, tables });
  });
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

app.get("/", (req, res) => {
  res.json({
    service: "multilingual-ocr-service",
    status: "running",
    endpoints: ["/health", "/ocr", "/ocr/batch", "/ocr/arabic", "/ocr/arabic/analyze"],
    supportedLanguages: VALID_LANGUAGES,
    maxFileSize: `${MAX_FILE_SIZE / 1024 / 1024}MB`,
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "multilingual-ocr-service", timestamp: new Date().toISOString() });
});

async function preprocessImage(imagePath) {
  const buffer = await sharp(imagePath)
    .resize({ width: 2000, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen()
    .toBuffer();
  return buffer;
}

async function runOcr(buffer, lang = "eng") {
  const worker = await createWorker(lang, 1, {
    logger: (m) => console.log(`[tesseract] ${m.status}`),
  });
  try {
    const { data } = await worker.recognize(buffer);
    return data;
  } finally {
    await worker.terminate();
  }
}

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

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === ".pdf") {
      const pdfParse = require("pdf-parse");
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      res.json({ text: cleanOcrText(pdfData.text), language: lang, pages: 1 });
    } else {
      const buffer = await preprocessImage(req.file.path);
      const result = await runOcr(buffer, lang);
      const confidenceWarning = checkConfidenceThreshold(result.confidence);
      const barcodes = await detectBarcodes(req.file.path);
      const tables = await detectTables(req.file.path);
      const cleanedText = cleanOcrText(result.text);
      const arabicDetected = containsArabic(cleanedText);
      const direction = detectTextDirection(cleanedText);
        const normalizedText = arabicDetected ? normalizeArabicText(cleanedText, { preserveHamza, preserveTaMarbuta }) : cleanedText;
      const easternNumeralsText = convertNumerals ? convertToEasternArabicNumerals(normalizedText) : normalizedText;
      const statistics = arabicDetected ? getArabicTextStatistics(normalizedText) : null;
      res.json({
        text: cleanedText,
        normalizedText,
        easternNumeralsText,
        language: lang,
        confidence: result.confidence,
        words: result.words?.length || 0,
        warning: confidenceWarning.warning,
        warningMessage: confidenceWarning.message,
        barcodes,
        tables,
        containsArabic: arabicDetected,
        direction,
        statistics,
      });
    }
  } catch (err) {
    console.error("OCR error:", err);
    res.status(500).json({ error: "OCR processing failed", message: err.message });
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
        const pdfParse = require("pdf-parse");
        const dataBuffer = fs.readFileSync(file.path);
        const pdfData = await pdfParse(dataBuffer);
        result = { text: cleanOcrText(pdfData.text), language: lang, pages: 1 };
      } else {
        const buffer = await preprocessImage(file.path);
        const ocrResult = await runOcr(buffer, lang);
        const confidenceWarning = checkConfidenceThreshold(ocrResult.confidence);
        const barcodes = await detectBarcodes(file.path);
        const tables = await detectTables(file.path);
        const cleanedText = cleanOcrText(ocrResult.text);
        const arabicDetected = containsArabic(cleanedText);
        const direction = detectTextDirection(cleanedText);
      const normalizedText = arabicDetected ? normalizeArabicText(cleanedText, { preserveHamza, preserveTaMarbuta }) : cleanedText;
        const easternNumeralsText = convertNumerals ? convertToEasternArabicNumerals(normalizedText) : normalizedText;
        const statistics = arabicDetected ? getArabicTextStatistics(normalizedText) : null;
        result = {
          text: cleanedText,
          normalizedText,
          easternNumeralsText,
          language: lang,
          confidence: ocrResult.confidence,
          words: ocrResult.words?.length || 0,
          warning: confidenceWarning.warning,
          warningMessage: confidenceWarning.message,
          barcodes,
          tables,
          containsArabic: arabicDetected,
          direction,
          statistics,
        };
      }
      results.push({ file: file.originalname, ...result });
    } catch (err) {
      results.push({ file: file.originalname, error: err.message });
    } finally {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  }

  res.json({ results, processed: results.length });
});

app.post("/ocr/arabic", express.text({ type: "text/plain", limit: "1mb" }), (req, res) => {
  const text = req.body || "";
  const cleanedText = cleanOcrText(text);
  const arabicDetected = containsArabic(cleanedText);
  const direction = detectTextDirection(cleanedText);
  const preserveHamza = req.body.preserveHamza === "true";
  const preserveTaMarbuta = req.body.preserveTaMarbuta === "true";
  const normalizedText = arabicDetected ? normalizeArabicText(cleanedText, { preserveHamza, preserveTaMarbuta }) : cleanedText;
  const easternNumeralsText = convertToEasternArabicNumerals(normalizedText);
  const withoutStopwords = removeArabicStopwords(normalizedText);
  const statistics = getArabicTextStatistics(normalizedText);

  res.json({
    originalText: cleanedText,
    normalizedText,
    easternNumeralsText,
    withoutStopwords,
    containsArabic: arabicDetected,
    direction,
    statistics,
  });
});

app.post("/ocr/arabic/analyze", express.text({ type: "text/plain", limit: "1mb" }), (req, res) => {
  const text = req.body || "";
  const cleanedText = cleanOcrText(text);
  const arabicDetected = containsArabic(cleanedText);
  const direction = detectTextDirection(cleanedText);
  const preserveHamza = req.body.preserveHamza === "true";
  const preserveTaMarbuta = req.body.preserveTaMarbuta === "true";
  const normalizedText = arabicDetected ? normalizeArabicText(cleanedText, { preserveHamza, preserveTaMarbuta }) : cleanedText;
  const easternNumeralsText = convertToEasternArabicNumerals(normalizedText);
  const withoutStopwords = removeArabicStopwords(normalizedText);
  const tokens = tokenizeArabicText(normalizedText);
  const wordFrequency = {};
  for (const token of tokens) {
    wordFrequency[token] = (wordFrequency[token] || 0) + 1;
  }
  const sortedFrequency = Object.entries(wordFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  res.json({
    originalText: cleanedText,
    normalizedText,
    easternNumeralsText,
    withoutStopwords,
    containsArabic: arabicDetected,
    direction,
    statistics: getArabicTextStatistics(normalizedText),
    wordFrequency: sortedFrequency,
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`OCR service running on http://localhost:${PORT}`);
});
