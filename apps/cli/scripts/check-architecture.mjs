import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  orderedLayerRule,
  requireAliasForEscapingImport,
  runArchitectureCheck,
} from '../../../scripts/architecture/runner.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');

// A CLI verb may use an adapter; an adapter may not reach back into a verb. The interactive
// screen sits on top of the verbs and never the other way round.
const LAYER_ORDER = ['adapters', 'commands', 'tui'];

// The CLI must never grow its own copy of the generation pipeline: orchestration belongs to the
// engine, and a verb that assembles pipeline stages by hand would be the fourth such mirror.
function refuseDirectPipelineImport(filePath, importPath, _statement, report) {
  if (importPath === '@storyboard/story-pipeline') {
    report('CLI imports the pipeline directly instead of an engine use case', filePath);
  }
}

runArchitectureCheck('CLI', SOURCE_ROOT, {
  rules: [orderedLayerRule(LAYER_ORDER, SOURCE_ROOT)],
  importRules: [refuseDirectPipelineImport, requireAliasForEscapingImport(SOURCE_ROOT, '@/')],
  aliases: { '@/': '@/' },
});
