import process from 'node:process';

import { evaluateDiffContracts, formatDiffContractReport } from './diffContracts.mjs';
import { describeRange, listChangedFiles, readFileAt, resolveBaseRef } from './gitDiff.mjs';

// Usage: node scripts/bvt/checkDiffContracts.mjs [<base-ref>]
// Without a base ref the newest v* tag that is an ancestor of HEAD (and not HEAD itself) is used.

const baseRef = resolveBaseRef(process.argv[2]);
const changed = listChangedFiles(baseRef);
const results = evaluateDiffContracts({
  changed,
  readHead: (filePath) => readFileAt('HEAD', filePath),
  readBase: (filePath) => readFileAt(baseRef, filePath),
});

console.log(formatDiffContractReport(describeRange(baseRef), changed.length, results));

if (results.some((result) => result.status === 'failed')) {
  process.exit(1);
}
