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
const coverageLine = text
  .split('\n')
  .find((line) => /all files/i.test(line) && line.includes('|'));
if (!coverageLine) {
  console.error('Coverage summary not found.');
  process.exit(1);
}

const columns = coverageLine
  .split('|')
  .map((column) => column.trim())
  .filter(Boolean);
const percent = Number.parseFloat(columns[1]);
if (Number.isNaN(percent)) {
  console.error('Coverage summary value is invalid.');
  process.exit(1);
}
console.log(`Coverage: ${percent}% (threshold ${threshold}%)`);
if (percent < threshold) {
  console.error(`Coverage below ${threshold}%.`);
  process.exit(1);
}
