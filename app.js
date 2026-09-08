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

  const lang = req.body.lang || "eng";
  const validLangs = ["eng", "ara", "fra", "eng+ara", "eng+fra", "ara+fra", "eng+ara+fra"];
  if (!validLangs.includes(lang)) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: `Unsupported language: ${lang}` });
  }

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === ".pdf") {
      const pdfParse = require("pdf-parse");
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      res.json({ text: pdfData.text, language: lang, pages: 1 });
    } else {
      const buffer = await preprocessImage(req.file.path);
      const result = await runOcr(buffer, lang);
      res.json({
        text: result.text,
        language: lang,
        confidence: result.confidence,
        words: result.words?.length || 0,
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
  const results = [];

  for (const file of req.files) {
    const formatError = validateImageFormat(file);
    if (formatError) {
      results.push({ file: file.originalname, error: formatError });
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
        result = { text: pdfData.text, language: lang, pages: 1 };
      } else {
        const buffer = await preprocessImage(file.path);
        const ocrResult = await runOcr(buffer, lang);
        result = {
          text: ocrResult.text,
          language: lang,
          confidence: ocrResult.confidence,
          words: ocrResult.words?.length || 0,
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

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`OCR service running on http://localhost:${PORT}`);
});
