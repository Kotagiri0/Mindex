import fs from 'node:fs';

const [, , filePath, thresholdArg] = process.argv;

if (!filePath || !thresholdArg) {
  console.error('Usage: check-coverage.mjs <coverage-file> <threshold>');
  process.exit(1);
}

const threshold = Number.parseFloat(thresholdArg);
if (Number.isNaN(threshold)) {
  console.error(`Invalid threshold: ${thresholdArg}`);
  process.exit(1);
}

const text = fs.readFileSync(filePath, 'utf8');
const coveragePattern =
  /^\s*(?:[#ℹ]+)?\s*all files\s*\|\s*([0-9.]+)\s*\|/im;
const coverageMatch = text.match(coveragePattern);
if (!coverageMatch) {
  console.error('Coverage summary not found.');
  process.exit(1);
}
const percent = Number.parseFloat(coverageMatch[1]);
if (Number.isNaN(percent)) {
  console.error('Coverage summary value is invalid.');
  process.exit(1);
}
console.log(`Coverage: ${percent}% (threshold ${threshold}%)`);
if (percent < threshold) {
  console.error(`Coverage below ${threshold}%.`);
  process.exit(1);
}
