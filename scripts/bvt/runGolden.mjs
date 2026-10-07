import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { repoRoot } from './gitDiff.mjs';
import { compareGoldenFiles, formatGoldenReport, hasUnexpectedDifference } from './goldenCompare.mjs';

// Usage: node scripts/bvt/runGolden.mjs [--update] [<scenario-id>...]
// Drives the built CLI (apps/cli/dist/index.mjs — run `npm run cli:build` first) through each
// scenario in bvt/golden/scenarios.json with the mock provider and compares the workspace it
// wrote with the snapshot. `--update` rewrites the snapshots of the fresh scenarios instead.

const cliEntry = path.join(repoRoot, 'apps/cli/dist/index.mjs');
const goldenRoot = path.join(repoRoot, 'bvt/golden');
const args = process.argv.slice(2);
const isUpdate = args.includes('--update');
const selectedIds = args.filter((arg) => !arg.startsWith('--'));

if (!fs.existsSync(cliEntry)) {
  console.error(`${path.relative(repoRoot, cliEntry)} is missing; run \`npm run cli:build\` first.`);
  process.exit(1);
}

const { scenarios } = JSON.parse(fs.readFileSync(path.join(goldenRoot, 'scenarios.json'), 'utf8'));
const selected = selectedIds.length === 0 ? scenarios : scenarios.filter((scenario) => selectedIds.includes(scenario.id));

function runCli(workspace, home, cliArgs) {
  const result = spawnSync(process.execPath, [cliEntry, ...cliArgs], {
    cwd: workspace,
    env: { ...process.env, STORYBOARD_HOME: home, NO_COLOR: '1', TERM: 'dumb' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`storyboard ${cliArgs.join(' ')} exited ${result.status}\n${result.stderr}`);
  }
  return result.stdout;
}

// What a writer would commit: tracked and untracked files minus what the workspace's own
// .gitignore hides (the cache, the manuscript build, the sample cards).
function listWorkspaceFiles(workspace) {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: workspace,
    encoding: 'utf8',
  });
  return output.split('\0').filter((file) => file.length > 0).sort();
}

function readTree(root, files) {
  return new Map(files.map((file) => [file, fs.readFileSync(path.join(root, file))]));
}

function listTree(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.push(path.relative(root, full).replaceAll(path.sep, '/'));
      }
    }
  };
  if (fs.existsSync(root)) {
    walk(root);
  }
  return files.sort();
}

function writeTree(root, tree) {
  fs.rmSync(root, { recursive: true, force: true });
  for (const [file, bytes] of tree) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}

function makeScratch(id) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `storyboard-golden-${id}-`));
  const home = path.join(scratch, 'home');
  const workspace = path.join(scratch, 'work');
  fs.mkdirSync(home);
  fs.mkdirSync(workspace);
  return { scratch, home, workspace };
}

// A fresh scenario's output: the workspace files, the exported manuscript and the status report,
// the last two kept outside the workspace so a reopen never sees them as part of the work.
function runFresh(scenario) {
  const { scratch, home, workspace } = makeScratch(scenario.id);

  runCli(workspace, home, ['init', '--title', `골든 ${scenario.id}`, ...scenario.init, '--yes']);
  runCli(workspace, home, ['setup', '--provider', 'mock']);
  runCli(workspace, home, ['novel', 'generate', '--json']);
  const manuscriptFile = path.join(scratch, 'manuscript.md');
  runCli(workspace, home, ['manuscript', 'export', '--out', manuscriptFile]);
  const status = runCli(workspace, home, ['status', '--json']);

  const tree = readTree(workspace, listWorkspaceFiles(workspace).map((file) => file).filter(Boolean));
  const output = new Map([...tree].map(([file, bytes]) => [`workspace/${file}`, bytes]));
  output.set('manuscript.md', fs.readFileSync(manuscriptFile));
  output.set('status.json', Buffer.from(status));

  fs.rmSync(scratch, { recursive: true, force: true });
  return { output, replacements: [[workspace, '<workspace>'], [home, '<home>']] };
}

// A reopen scenario copies the frozen workspace, makes it a repository (a writer's is), and runs
// the verbs that read a work and build from it; the files must come back as they went in. (A
// generating verb is not run here: without the git-ignored cache it cannot tell a draft is current.)
function runReopen(scenario) {
  const { scratch, home, workspace } = makeScratch(scenario.id);
  const frozenRoot = path.join(goldenRoot, scenario.from, 'workspace');
  const frozen = readTree(frozenRoot, listTree(frozenRoot));

  for (const [file, bytes] of frozen) {
    const target = path.join(workspace, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', workspace]);

  runCli(workspace, home, ['doctor']);
  const status = runCli(workspace, home, ['status', '--json']);
  const scenes = JSON.parse(runCli(workspace, home, ['scene', 'list', '--json'])).data.scenes;
  for (const scene of scenes) {
    runCli(workspace, home, ['scene', 'show', scene.stem]);
    runCli(workspace, home, ['draft', 'show', scene.stem, '--json']);
  }
  runCli(workspace, home, ['project', 'show']);
  runCli(workspace, home, ['card', 'list']);
  runCli(workspace, home, ['manuscript', 'assemble']);
  runCli(workspace, home, ['manuscript', 'export', '--out', path.join(scratch, 'manuscript.md')]);

  const after = readTree(workspace, listWorkspaceFiles(workspace));
  const output = new Map([...after].map(([file, bytes]) => [`workspace/${file}`, bytes]));
  output.set('status.json', Buffer.from(status));
  const expected = new Map([...frozen].map(([file, bytes]) => [`workspace/${file}`, bytes]));
  const expectedStatus = path.join(goldenRoot, scenario.id, 'status.json');
  if (fs.existsSync(expectedStatus)) {
    expected.set('status.json', fs.readFileSync(expectedStatus));
  }

  fs.rmSync(scratch, { recursive: true, force: true });
  return { output, expected, replacements: [[workspace, '<workspace>'], [home, '<home>']] };
}

let hasFailure = false;

for (const scenario of selected) {
  const snapshotRoot = path.join(goldenRoot, scenario.id);

  if (scenario.kind === 'fresh') {
    const { output, replacements } = runFresh(scenario);
    if (isUpdate) {
      writeTree(snapshotRoot, output);
      console.log(`${scenario.id}: snapshot written (${output.size} files)`);
      continue;
    }
    const expected = readTree(snapshotRoot, listTree(snapshotRoot));
    const entries = compareGoldenFiles(output, expected, replacements);
    console.log(formatGoldenReport(scenario.id, entries));
    hasFailure ||= hasUnexpectedDifference(entries);
    continue;
  }

  const { output, expected, replacements } = runReopen(scenario);
  if (isUpdate && !fs.existsSync(path.join(snapshotRoot, 'status.json'))) {
    fs.mkdirSync(snapshotRoot, { recursive: true });
    fs.writeFileSync(path.join(snapshotRoot, 'status.json'), output.get('status.json'));
    expected.set('status.json', output.get('status.json'));
  }
  const allowed = (scenario.mayRewrite ?? []).map((file) => `workspace/${file}`);
  const entries = compareGoldenFiles(output, expected, replacements);
  console.log(formatGoldenReport(scenario.id, entries, allowed));
  hasFailure ||= hasUnexpectedDifference(entries, allowed);
}

if (hasFailure) {
  console.error('\nThe golden run differs from its snapshot. If the change is intended, review it and run `npm run bvt:golden -- --update`.');
  process.exit(1);
}
