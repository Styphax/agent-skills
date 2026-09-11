import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_MODEL = 'claude-fable-5-1';
const TIMEOUT_MS = 25 * 60 * 1000;

export function parseArgs(argv) {
  const options = { model: DEFAULT_MODEL, effort: 'high', resume: false, noWeb: false, dryRun: false };
  const values = { '--model': 'model', '--effort': 'effort', '--prompt-file': 'promptFile', '--state-file': 'stateFile' };
  const flags = { '--resume': 'resume', '--no-web': 'noWeb', '--dry-run': 'dryRun' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error(`Duplicate flag: ${arg}`);
    seen.add(arg);
    if (flags[arg]) options[flags[arg]] = true;
    else if (values[arg] && argv[i + 1] && !argv[i + 1].startsWith('--')) options[values[arg]] = argv[++i];
    else throw new Error(`Unknown flag or missing value: ${arg}`);
  }
  if (['fable', 'fable-5.1'].includes(options.model)) options.model = DEFAULT_MODEL;
  if (!/^claude-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(options.model)) throw new Error('Use fable, fable-5.1 or an explicit full claude-... model ID.');
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) throw new Error('Unsupported effort.');
  if (!options.promptFile || !options.stateFile) throw new Error('--prompt-file and --state-file are required.');
  options.promptFile = path.resolve(options.promptFile);
  options.stateFile = path.resolve(options.stateFile);
  return options;
}

export function findClaude() {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  if (process.platform === 'win32') {
    for (const dir of [...dirs, path.join(os.homedir(), '.local', 'bin'), path.join(process.env.APPDATA || '', 'npm')]) {
      for (const rel of ['claude.exe', 'node_modules/@anthropic-ai/claude-code/bin/claude.exe']) {
        const candidate = path.join(dir, rel);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    throw new Error('Native claude.exe not found. Install Claude Code or put its executable on PATH.');
  }
  return 'claude';
}

export function buildArgs(options, sessionId) {
  const readTools = options.noWeb ? 'Read,Glob,Grep' : 'Read,Glob,Grep,WebSearch,WebFetch';
  return ['--print', '--safe-mode', '--model', options.model, '--effort', options.effort,
    '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', '--tools', readTools,
    '--allowedTools', readTools, options.resume ? '--resume' : '--session-id', sessionId];
}

export function parseOutput(text) {
  const events = text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const results = events.filter(event => event.type === 'result');
  if (results.length !== 1) throw new Error('Expected exactly one final Claude result.');
  const reviewerModels = events.filter(event => event.type === 'assistant').map(event => event.message?.model);
  return { result: results[0], reviewerModels };
}

export function validateResult(result, options, sessionId, reviewerModels = []) {
  if (result.is_error || result.subtype !== 'success') throw new Error(`Claude did not complete successfully: ${result.subtype || 'unknown result'}`);
  if (result.session_id !== sessionId) throw new Error('Claude returned a different or missing session ID.');
  if (!reviewerModels.length || reviewerModels.some(model => model !== options.model) || !result.modelUsage?.[options.model]) {
    throw new Error(`Requested ${options.model}; reviewer message models: ${reviewerModels.join(', ') || 'missing'}. Review not accepted.`);
  }
  if (typeof result.result !== 'string' || !result.result.trim()) throw new Error('Claude returned no answer.');
  if (result.permission_denials?.length) throw new Error('Claude reported tool permission denials. See the raw result.');
  return result.result;
}

export function nextState(options, previous) {
  if (!options.resume) {
    if (previous) throw new Error('State already exists. Use a new state file for a new duel.');
    return { sessionId: randomUUID(), model: options.model, effort: options.effort, noWeb: options.noWeb, cwd: process.cwd(), turns: 0 };
  }
  if (!previous || previous.status !== 'completed' || previous.turns !== 1) throw new Error('Resume requires exactly one completed turn; maximum two turns per duel.');
  for (const key of ['model', 'effort', 'noWeb']) {
    if (previous[key] !== options[key]) throw new Error(`Cannot change ${key} during a duel.`);
  }
  if (previous.cwd !== process.cwd()) throw new Error('Resume from the original working directory.');
  if (!/^[0-9a-f-]{36}$/i.test(previous.sessionId || '')) throw new Error('Invalid saved session ID.');
  return previous;
}

function runClaude(executable, args, prompt, rawPath, stderrPath) {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(rawPath, 'wx');
    let err;
    try { err = fs.openSync(stderrPath, 'wx'); }
    catch (error) { fs.closeSync(out); throw error; }
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['pipe', out, err] });
    let failure;
    const stop = reason => {
      failure = new Error(reason);
      child.kill('SIGKILL'); // The reviewer has no shell or delegation tools.
    };
    const timer = setTimeout(() => stop('Claude turn exceeded 25 minutes.'), TIMEOUT_MS);
    const interrupted = () => stop('Claude turn interrupted.');
    process.once('SIGINT', interrupted);
    process.once('SIGTERM', interrupted);
    child.once('error', error => { failure = error; });
    child.stdin.on('error', error => { failure ||= error; });
    child.once('close', code => {
      clearTimeout(timer);
      process.removeListener('SIGINT', interrupted);
      process.removeListener('SIGTERM', interrupted);
      fs.closeSync(out);
      fs.closeSync(err);
      if (failure || code !== 0) reject(failure || new Error(`Claude exited ${code}. See ${rawPath} and ${stderrPath}.`));
      else resolve();
    });
    child.stdin.end(prompt, 'utf8');
  });
}

export async function main(argv) {
  const options = parseArgs(argv);
  const prompt = fs.readFileSync(options.promptFile, 'utf8');
  if (!prompt.trim()) throw new Error('Empty handoff file.');
  const executable = findClaude();
  if (options.dryRun) {
    console.log(JSON.stringify({ executable, args: buildArgs(options, '<saved-or-new-session-uuid>'), cwd: process.cwd(), timeoutMs: TIMEOUT_MS }, null, 2));
    return;
  }
  const lock = `${options.stateFile}.lock`;
  fs.mkdirSync(path.dirname(options.stateFile), { recursive: true });
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Duel lock exists: ${lock}. Check whether its recorded process is still running. Do not remove an active lock or automatically retry a possibly consumed turn.`);
    throw error;
  }
  fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  let state;
  const save = () => fs.writeFileSync(options.stateFile, JSON.stringify(state, null, 2) + '\n');
  try {
    const previous = fs.existsSync(options.stateFile) ? JSON.parse(fs.readFileSync(options.stateFile, 'utf8')) : null;
    state = nextState(options, previous);
    const round = state.turns + 1;
    state.status = 'running';
    state.startedAt = new Date().toISOString();
    save();
    const rawPath = `${options.stateFile}.round${round}.json`;
    const stderrPath = `${options.stateFile}.round${round}.stderr.txt`;
    await runClaude(executable, buildArgs(options, state.sessionId), prompt, rawPath, stderrPath);
    const { result, reviewerModels } = parseOutput(fs.readFileSync(rawPath, 'utf8'));
    const answer = validateResult(result, options, state.sessionId, reviewerModels);
    state.turns = round;
    state.status = 'completed';
    state.completedAt = new Date().toISOString();
    state.reviewerModels = [...new Set(reviewerModels)];
    save();
    console.log(JSON.stringify({ status: state.status, sessionId: state.sessionId, model: state.model,
      requestedEffort: state.effort, turns: state.turns, result: answer }, null, 2));
  } catch (error) {
    if (state) { state.status = 'failed'; state.error = error.message; save(); }
    throw error;
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
