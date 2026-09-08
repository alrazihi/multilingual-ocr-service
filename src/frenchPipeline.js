const { cleanOcrText } = require("./arabicPipeline");

const FRENCH_STOPWORDS = new Set([
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "du",
  "de",
  "la",
  "au",
  "aux",
  "et",
  "est",
  "en",
  "que",
  "qui",
  "dans",
  "pour",
  "pas",
  "sur",
  "par",
  "avec",
  "plus",
  "son",
  "sa",
  "ses",
  "mais",
  "ou",
  "donc",
  "or",
  "ni",
  "car",
  "se",
  "me",
  "te",
  "vous",
  "nous",
  "ils",
  "elles",
  "ce",
  "ces",
  "cette",
  "cet",
  "mon",
  "ton",
  "notre",
  "votre",
  "leurs",
  "tout",
  "tous",
  "toutes",
  "autre",
  "autres",
  "même",
  "mêmes",
  "aussi",
  "ainsi",
  "alors",
  "après",
  "avant",
  "car",
  "depuis",
  "durant",
  "hors",
  "jusque",
  "lorsque",
  "lorsqu",
  "parce",
  "parmi",
  "pendant",
  "plein",
  "selon",
  "sans",
  "sauf",
  "sous",
  "suivant",
  "tandis",
  "vers",
  "via",
  "voici",
  "voilà",
  "beaucoup",
  "peu",
  "trop",
  "assez",
  "tellement",
  "si",
  "quand",
  "comment",
  "pourquoi",
  "quoi",
  "où",
  "combien",
  "quel",
  "quelle",
  "quels",
  "quelles",
  "aucun",
  "aucune",
  "certains",
  "certaines",
  "chaque",
  "plusieurs",
  "quelque",
  "quelques",
]);

function tokenizeFrenchText(text) {
  if (!text) return [];
  return text
    .replace(/[^\x00-\x7FÀ-ÖØ-öø-ÿ\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function removeFrenchStopwords(text) {
  if (!text) return "";
  const tokens = tokenizeFrenchText(text);
  const filtered = tokens.filter((token) => !FRENCH_STOPWORDS.has(token.toLowerCase()));
  return filtered.join(" ");
}

function getFrenchTextStatistics(text) {
  if (!text) return { words: 0, characters: 0, uniqueWords: 0, stopwordsRemoved: 0 };
  const tokens = tokenizeFrenchText(text);
  const words = tokens.length;
  const characters = text.replace(/\s/g, "").length;
  const uniqueWords = new Set(tokens.map((w) => w.toLowerCase())).size;
  const stopwordsRemoved = tokens.filter((token) => FRENCH_STOPWORDS.has(token.toLowerCase())).length;
  return { words, characters, uniqueWords, stopwordsRemoved };
}

function getFrenchWordFrequency(text) {
  if (!text) return [];
  const tokens = tokenizeFrenchText(text);
  const frequency = {};
  for (const token of tokens) {
    const word = token.toLowerCase();
    frequency[word] = (frequency[word] || 0) + 1;
  }
  return Object.entries(frequency)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

function containsFrench(text) {
  if (!text) return false;
  const frenchMatches = text.match(/[À-ÖØ-öø-ÿ]/g);
  if (!frenchMatches) return false;
  const totalChars = text.replace(/\s/g, "").length;
  return frenchMatches.length / totalChars > 0.05;
}

const FRENCH_PLURAL_SUFFIXES = ["s", "x"];
const FRENCH_FEMININE_SUFFIXES = ["tion", "sion", "té", "ée", "ées", "euse", "euses", "rice", "rices", "esse", "esses", "son", "sonne", "ance", "ence", "ade", "ude", "ie", "ine", "elle", "aille", "eille", "oise", "ure", "ise", "esse"];
const FRENCH_MASCULINE_SUFFIXES = ["age", "ement", "eau", "oir", "isme", "iste", "on", "in", "air", "oir", "as", "is", "on", "en", "an", "ou", "ès"];

function detectFrenchPlurals(text) {
  if (!text) return [];
  const tokens = tokenizeFrenchText(text);
  const plurals = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.length < 3) continue;
    for (const suffix of FRENCH_PLURAL_SUFFIXES) {
      if (lower.endsWith(suffix) && lower.length > suffix.length + 2) {
        const singular = lower.slice(0, -suffix.length);
        if (singular.length > 2) {
          plurals.push({ plural: lower, singular, suffix });
          break;
        }
      }
    }
  }
  return plurals.slice(0, 20);
}

function detectFrenchGender(text) {
  if (!text) return [];
  const tokens = tokenizeFrenchText(text);
  const genders = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (FRENCH_FEMININE_SUFFIXES.some((s) => lower.endsWith(s))) {
      genders.push({ word: lower, gender: "feminine", reason: "suffix" });
    } else if (FRENCH_MASCULINE_SUFFIXES.some((s) => lower.endsWith(s))) {
      genders.push({ word: lower, gender: "masculine", reason: "suffix" });
    }
  }
  return genders.slice(0, 20);
}

const FRENCH_LEMMA_RULES = [
  { suffix: "ments", replacement: "ment" },
  { suffix: "nées", replacement: "née" },
  { suffix: "ées", replacement: "ée" },
  { suffix: "ions", replacement: "ion" },
  { suffix: "eux", replacement: "eu" },
  { suffix: "aux", replacement: "al" },
  { suffix: "ises", replacement: "ise" },
  { suffix: "ités", replacement: "ité" },
  { suffix: "ants", replacement: "ant" },
  { suffix: "antes", replacement: "ante" },
  { suffix: "ées", replacement: "er" },
  { suffix: "s", replacement: "" },
  { suffix: "x", replacement: "al" },
];

function getFrenchLemmas(text) {
  if (!text) return [];
  const tokens = tokenizeFrenchText(text);
  const lemmas = [];
  const seen = new Set();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    let lemma = lower;
    for (const rule of FRENCH_LEMMA_RULES) {
      if (lower.endsWith(rule.suffix) && lower.length > rule.suffix.length + 2) {
        lemma = lower.slice(0, -rule.suffix.length) + rule.replacement;
        break;
      }
    }
    if (lemma !== lower) {
      lemmas.push({ word: lower, lemma });
    }
  }
  return lemmas.slice(0, 20);
}

function normalizeFrenchAccents(text, mode = "default") {
  if (!text) return "";
  let normalized = text;
  if (mode === "ascii") {
    normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } else if (mode === "lower") {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

function processFrenchPipeline(text, options = {}) {
  const { accentMode = "default" } = options;
  const cleanedText = cleanOcrText(text);
  const normalizedText = normalizeFrenchAccents(cleanedText, accentMode);
  const frenchDetected = containsFrench(normalizedText);
  const withoutStopwords = removeFrenchStopwords(normalizedText);
  const statistics = getFrenchTextStatistics(normalizedText);
  const wordFrequency = getFrenchWordFrequency(normalizedText);
  const plurals = detectFrenchPlurals(normalizedText);
  const genders = detectFrenchGender(normalizedText);
  const lemmas = getFrenchLemmas(normalizedText);

  return {
    text: cleanedText,
    normalizedText,
    withoutStopwords,
    containsFrench: frenchDetected,
    statistics,
    wordFrequency,
    plurals,
    genders,
    lemmas,
  };
}

module.exports = {
  processFrenchPipeline,
  tokenizeFrenchText,
  removeFrenchStopwords,
  getFrenchTextStatistics,
  getFrenchWordFrequency,
  containsFrench,
  detectFrenchPlurals,
  detectFrenchGender,
  getFrenchLemmas,
  normalizeFrenchAccents,
};
