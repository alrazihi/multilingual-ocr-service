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

function fixArabicSpacing(text) {
  if (!text) return "";
  let fixed = text;
  fixed = fixed.replace(/\s+/g, " ");
  fixed = fixed.replace(/\s+([،؛.!?])/g, "$1");
  fixed = fixed.replace(/([،؛.!?])(?=[^\s\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF])/g, "$1 ");
  fixed = fixed.replace(/([\(\)\[\]\{\}«»""''`])\s*/g, (match, p1) => {
    const opening = /^[\(\[\{«"''`]$/.test(p1);
    const closing = /^[\)\]\}.»"''`]$/.test(p1);
    if (opening) return `${p1} `;
    if (closing) return ` ${p1}`;
    return ` ${p1} `;
  });
  return fixed.trim();
}

function normalizeArabicPunctuation(text) {
  if (!text) return "";
  let normalized = text;
  normalized = normalized.replace(/\.{2,}/g, ".");
  normalized = normalized.replace(/([.!?])\1+/g, "$1");
  normalized = normalized.replace(/[`'"]+/g, '"');
  normalized = normalized.replace(/…/g, "...");
  normalized = normalized.replace(/–/g, "-");
  normalized = normalized.replace(/—/g, "-");
  return normalized;
}

function reconstructLamAlef(text) {
  if (!text) return "";
  return text
    .replace(/ل\s+ا/g, "لا")
    .replace(/ل\s+أ/g, "لأ")
    .replace(/ل\s+إ/g, "لإ")
    .replace(/ل\s+آ/g, "لآ");
}

const ARABIC_OCR_CORRECTIONS = [
  [/رٰ/g, "را"],
  [/ٰ/g, ""],
];

function applyCommonArabicOcrCorrections(text) {
  if (!text) return "";
  let corrected = text;
  for (const [pattern, replacement] of ARABIC_OCR_CORRECTIONS) {
    corrected = corrected.replace(pattern, replacement);
  }
  return corrected;
}

function validateArabicDots(text) {
  if (!text) return "";
  return text
    .replace(/[ـ]{2,}/g, "ـ")
    .replace(/([^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF])\.{2,}/g, "$1")
    .replace(/\.{2,}([^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF])/g, "$1")
    .trim();
}

function tokenizeArabicText(text) {
  if (!text) return [];
  return text
    .replace(/[^\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function filterNonsenseArabicWords(text) {
  if (!text) return "";
  const tokens = tokenizeArabicText(text);
  const filtered = tokens.filter((token) => {
    if (token.length === 1) return true;
    if (token.length > 20) return false;
    const dotCount = (token.match(/[ًٌٍَُِّْ]/g) || []).length;
    if (dotCount > token.length * 0.8) return false;
    const arabicRatio = (token.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || []).length / token.length;
    if (arabicRatio < 0.5) return false;
    return true;
  });
  return filtered.join(" ");
}

function enforceRtlDirection(text) {
  if (!text) return "";
  const hasArabic = containsArabic(text);
  if (!hasArabic) return text;
  const rtlMark = "\u200F";
  const cleaned = text.replace(/\u200F/g, "").trim();
  if (/^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(cleaned)) {
    return `${rtlMark}${cleaned}`;
  }
  return cleaned;
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

function cleanOcrText(text) {
  if (!text) return "";
  return text
    .replace(/\s+/g, " ")
    .replace(/[^\x20-\x7E\u00A0-\u024F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g, "")
    .trim();
}

function processArabicPipeline(text, options = {}) {
  const {
    preserveHamza = false,
    preserveTaMarbuta = false,
    removeDiacritics = true,
    convertNumerals = false,
    applyOcrCorrections = false,
  } = options;

  const cleanedText = cleanOcrText(text);
  const arabicDetected = containsArabic(cleanedText);
  const direction = detectTextDirection(cleanedText);
  const normalizedText = arabicDetected
    ? normalizeArabicText(cleanedText, { preserveHamza, preserveTaMarbuta, removeDiacritics })
    : cleanedText;
  const correctedText = applyOcrCorrections ? applyCommonArabicOcrCorrections(normalizedText) : normalizedText;
  const dotsValidatedText = validateArabicDots(correctedText);
  const nonsenseFilteredText = filterNonsenseArabicWords(dotsValidatedText);
  const easternNumeralsText = convertNumerals ? convertToEasternArabicNumerals(nonsenseFilteredText) : nonsenseFilteredText;
  const spacingFixedText = fixArabicSpacing(easternNumeralsText);
  const lamAlefReconstructed = reconstructLamAlef(spacingFixedText);
  const punctuationFixedText = normalizeArabicPunctuation(lamAlefReconstructed);
  const rtlEnforcedText = enforceRtlDirection(punctuationFixedText);
  const withoutStopwords = removeArabicStopwords(normalizedText);
  const statistics = getArabicTextStatistics(normalizedText);

  return {
    text: cleanedText,
    normalizedText,
    correctedText,
    dotsValidatedText,
    nonsenseFilteredText,
    easternNumeralsText,
    spacingFixedText,
    lamAlefReconstructed,
    punctuationFixedText,
    rtlEnforcedText,
    withoutStopwords,
    containsArabic: arabicDetected,
    direction,
    statistics,
  };
}

module.exports = {
  processArabicPipeline,
  normalizeArabicText,
  convertToEasternArabicNumerals,
  fixArabicSpacing,
  normalizeArabicPunctuation,
  reconstructLamAlef,
  applyCommonArabicOcrCorrections,
  validateArabicDots,
  filterNonsenseArabicWords,
  enforceRtlDirection,
  removeArabicStopwords,
  tokenizeArabicText,
  getArabicTextStatistics,
  containsArabic,
  detectTextDirection,
  cleanOcrText,
};
