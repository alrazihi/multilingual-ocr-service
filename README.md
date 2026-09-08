# OCRJS

OCRJS converts images of typed text to machine-encoded text.

## Supported Languages

- English
- Arabic
- French

## Features

- Client-side OCR inference
- Multi-language support
- Simple API

## Setup

```bash
npm install
npm start
```

## Usage

```javascript
const ocr = require('ocrjs');
ocr.process(imageBuffer, { lang: 'eng' }).then(result => {
  console.log(result.text);
});
```

## Benchmarks

| Language | Accuracy | Dataset |
|----------|----------|---------|
| English | TBD | ICDAR 2015 |
| Arabic | TBD | ICDAR 2015 |
| French | TBD | ICDAR 2015 |

## Model

Tesseract.js-based OCR with custom preprocessing.

## License

MIT
