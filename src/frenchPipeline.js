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

function processFrenchPipeline(text) {
  const cleanedText = cleanOcrText(text);
  const frenchDetected = containsFrench(cleanedText);
  const withoutStopwords = removeFrenchStopwords(cleanedText);
  const statistics = getFrenchTextStatistics(cleanedText);
  const wordFrequency = getFrenchWordFrequency(cleanedText);

  return {
    text: cleanedText,
    withoutStopwords,
    containsFrench: frenchDetected,
    statistics,
    wordFrequency,
  };
}

module.exports = {
  processFrenchPipeline,
  tokenizeFrenchText,
  removeFrenchStopwords,
  getFrenchTextStatistics,
  getFrenchWordFrequency,
  containsFrench,
};
