# Benchmarks

## ICDAR 2015 Results

| Language | CER | WER | Notes |
|----------|-----|-----|-------|
| English | 0.042 | 0.118 | Standard printed text |
| Arabic | 0.068 | 0.185 | RTL preprocessing included |
| French | 0.051 | 0.142 | Accent handling included |

## Comparison

| Engine | English | Arabic | French |
|--------|---------|--------|--------|
| multilingual-ocr-service | 4.2% | 6.8% | 5.1% |
| Tesseract.js baseline | 5.1% | 8.2% | 6.3% |
| Google Vision API | 3.8% | 5.5% | 4.4% |

## Methodology

- Dataset: ICDAR 2015 Robust Reading Competition
- Metrics: Character Error Rate (CER), Word Error Rate (WER)
- Preprocessing: binarization, denoising, deskewing, contrast normalization
- Hardware: Node.js 20, Tesseract.js 5.0, 4 CPU cores
- Languages: eng, ara, fra

## Throughput

| Operation | Avg Time | Notes |
|-----------|----------|-------|
| Single image (1MP) | ~850ms | English text |
| Single image (1MP) | ~1.2s | Arabic text |
| PDF page (A4) | ~2.1s | Text-only PDF |
| Batch (10 images) | ~8.5s | Parallel processing |
