import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const MODELS = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'];
const ALIASES = { astra: MODELS[0], sol: MODELS[1], luna: MODELS[3], terra: MODELS[5] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const options = { action: 'start', model: MODELS[0], effort: 'xhigh', fast: false, write: false, noWeb: false, resume: false, background: false, dryRun: false };
  if (argv[0] && !argv[0].startsWith('--')) options.action = argv.shift();
  if (!['start', 'status', 'cancel', '_worker'].includes(options.action)) throw new Error('Unknown command.');
  const values = { '--prompt-file': 'promptFile', '--state-file': 'stateFile', '--model': 'model', '--effort': 'effort' };
  const flags = { '--fast': 'fast', '--write': 'write', '--no-web': 'noWeb', '--resume': 'resume', '--background': 'background', '--dry-run': 'dryRun' };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (seen.has(arg)) throw new Error(`Duplicate flag: ${arg}`);
    seen.add(arg);
    if (flags[arg]) options[flags[arg]] = true;
    else if (values[arg] && argv[i + 1] && !argv[i + 1].startsWith('--')) options[values[arg]] = argv[++i];
    else throw new Error(`Unknown flag or missing value: ${arg}`);
  }
  if (!options.stateFile) throw new Error('--state-file is required.');
  options.stateFile = path.resolve(options.stateFile);
  if (options.action !== 'start') {
    if (seen.size !== 1) throw new Error('This command accepts only --state-file.');
    return options;
  }
  options.model = ALIASES[options.model] ?? options.model;
  if (!MODELS.includes(options.model)) throw new Error('Unsupported model.');
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) throw new Error('Unsupported effort.');
  if (!options.promptFile) throw new Error('--prompt-file is required.');
  options.promptFile = path.resolve(options.promptFile);
  return options;
}

export function findCodex() {
  if (process.platform !== 'win32') return { executable: 'codex', prefix: [] };
  const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const dirs = [...(process.env.PATH || '').split(path.delimiter), path.join(process.env.APPDATA || '', 'npm')];
  for (const dir of dirs) {
    for (const rel of ['codex.exe', `node_modules/@openai/codex/node_modules/@openai/codex-win32-${process.arch}/vendor/${triple}/bin/codex.exe`]) {
      const candidate = path.resolve(dir, rel);
      if (fs.existsSync(candidate)) return { executable: candidate, prefix: [] };
    }
  }
  throw new Error('Native codex.exe not found. Install Codex CLI or put it on PATH.');
}

export function buildArgs(options, sessionId = null) {
  if (sessionId && !UUID.test(sessionId)) throw new Error('Invalid saved session ID.');
  const args = ['exec'];
  if (sessionId) args.push('resume', sessionId);
  args.push('--json', '--skip-git-repo-check', '--model', options.model,
    '-c', `model_reasoning_effort="${options.effort}"`,
    '-c', `service_tier="${options.fast ? 'fast' : 'default'}"`,
    '-c', `sandbox_mode="${options.write ? 'workspace-write' : 'read-only'}"`,
    '-c', 'approval_policy="never"', '-c', 'features.multi_agent=false');
  if (options.noWeb) args.push('-c', 'web_search="disabled"');
  args.push('-');
  return args;
}

export function nextState(options, previous, cwd = process.cwd()) {
  if (!options.resume) {
    if (previous) throw new Error('State already exists. Use a new state file for a new duel.');
    return { model: options.model, effort: options.effort, fast: options.fast, write: options.write, noWeb: options.noWeb, cwd, turns: 0, sessionId: null };
  }
  if (!previous || previous.status !== 'completed' || previous.turns !== 1) throw new Error('Resume requires exactly one completed turn; maximum two turns per duel.');
  for (const key of ['model', 'effort', 'fast', 'write', 'noWeb']) {
    if (previous[key] !== options[key]) throw new Error(`Cannot change ${key} during a duel.`);
  }
  if (previous.cwd !== cwd) throw new Error('Resume from the original working directory.');
  if (!UUID.test(previous.sessionId || '')) throw new Error('Invalid saved session ID.');
  return { ...previous };
}

export function validateEvents(raw, expectedSession = null) {
  const events = raw.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const threads = events.filter(e => e.type === 'thread.started');
  if (threads.length !== 1 || !UUID.test(threads[0].thread_id || '')) throw new Error('Missing or ambiguous thread ID.');
  const sessionId = threads[0].thread_id;
  if (expectedSession && sessionId !== expectedSession) throw new Error('Codex returned a different session ID.');
  if (events.some(e => e.type === 'turn.failed') || events.filter(e => e.type === 'turn.completed').length !== 1) throw new Error('Codex turn did not complete successfully.');
  const messages = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message');
  const answer = messages.at(-1)?.item?.text;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('Codex returned no answer.');
  return { sessionId, answer };
}

const readState = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function saveState(file, state) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(temp, file);
}

function terminateChild(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('No valid child PID.');
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Could not stop this duel's child process: ${result.stderr || result.error || result.stdout}`);
  } else {
    process.kill(-pid, 'SIGTERM');
  }
}

async function runWorker(stateFile) {
  const state = readState(stateFile);
  const lock = `${stateFile}.lock`;
  const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
  if (state.status !== 'running' || owner.runId !== state.runId) throw new Error('Worker does not own the active duel.');
  state.pid = process.pid;
  saveState(stateFile, state);
  fs.writeFileSync(lock, JSON.stringify({ ...owner, pid: process.pid }));
  let child;
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      try { terminateChild(child.pid); }
      catch (error) { state.cancelError = error.message; saveState(stateFile, state); }
    }
  };
  // Only the owning worker stops its live child. A stale state file must
  // never cause another process to be killed by a recycled PID.
  const cancellationPoll = setInterval(() => {
    if (!interrupted && readState(stateFile).cancelRequested) stop();
  }, 250);
  cancellationPoll.unref();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const round = state.turns + 1;
    const rawPath = `${stateFile}.round${round}.jsonl`;
    const errPath = `${stateFile}.round${round}.stderr.txt`;
    const out = fs.openSync(rawPath, 'wx');
    let err;
    try {
      err = fs.openSync(errPath, 'wx');
      await new Promise((resolve, reject) => {
        child = spawn(state.launcher.executable, [...state.launcher.prefix, ...buildArgs(state, state.sessionId)], {
          cwd: state.cwd, shell: false, windowsHide: true,
          detached: process.platform !== 'win32', stdio: ['pipe', out, err]
        });
        child.once('error', reject);
        child.once('spawn', () => { state.childPid = child.pid; saveState(stateFile, state); });
        child.once('close', code => code === 0 && !interrupted ? resolve() : reject(new Error(`Codex exited ${code}${interrupted ? ' after interruption' : ''}. See round logs.`)));
        child.stdin.on('error', reject);
        child.stdin.end(fs.readFileSync(state.promptSnapshot), 'utf8');
      });
    } finally {
      fs.closeSync(out);
      if (err !== undefined) fs.closeSync(err);
    }
    const result = validateEvents(fs.readFileSync(rawPath, 'utf8'), state.sessionId);
    // A cancellation can race with a normal exit. Never report that as success.
    if (readState(stateFile).cancelRequested) throw new Error('Duel cancelled.');
    state.sessionId = result.sessionId;
    state.result = result.answer;
    state.turns = round;
    state.status = 'completed';
    state.completedAt = new Date().toISOString();
  } catch (error) {
    state.status = 'failed';
    state.error = error.message;
  } finally {
    clearInterval(cancellationPoll);
    delete state.childPid;
    saveState(stateFile, state);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    fs.unlinkSync(lock);
  }
  return state;
}

export async function main(argv, dependencies = {}) {
  const options = parseArgs([...argv]);
  if (options.action === '_worker') return runWorker(options.stateFile);
  if (options.action === 'status') return readState(options.stateFile);
  if (options.action === 'cancel') {
    const state = readState(options.stateFile);
    if (state.status !== 'running') return state;
    if (!state.childPid) throw new Error('Child not started yet; check status before cancelling.');
    state.cancelRequested = true;
    saveState(options.stateFile, state);
    return { status: 'cancelling', stateFile: options.stateFile };
  }
  const prompt = fs.readFileSync(options.promptFile, 'utf8');
  if (!prompt.trim()) throw new Error('Empty handoff file.');
  const launcher = dependencies.launcher ?? findCodex();
  if (options.dryRun) {
    const prior = options.resume ? readState(options.stateFile) : null;
    const state = nextState(options, prior);
    return { ...launcher, args: buildArgs(options, state.sessionId), cwd: state.cwd, changesGlobalConfig: false };
  }
  fs.mkdirSync(path.dirname(options.stateFile), { recursive: true });
  const lock = `${options.stateFile}.lock`;
  const lockFd = fs.openSync(lock, 'wx');
  let handedOff = false;
  let state;
  try {
    const previous = fs.existsSync(options.stateFile) ? readState(options.stateFile) : null;
    state = nextState(options, previous);
    state.status = 'running';
    state.runId = `${process.pid}-${Date.now()}`;
    state.startedAt = new Date().toISOString();
    state.launcher = launcher;
    state.pid = process.pid;
    delete state.result;
    delete state.completedAt;
    state.promptSnapshot = `${options.stateFile}.round${state.turns + 1}.prompt.md`;
    fs.writeFileSync(state.promptSnapshot, prompt, { encoding: 'utf8', flag: 'wx' });
    saveState(options.stateFile, state);
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, runId: state.runId, startedAt: state.startedAt }));
    fs.closeSync(lockFd);
    if (!options.background) {
      handedOff = true;
      return await runWorker(options.stateFile);
    }
    const log = fs.openSync(`${options.stateFile}.round${state.turns + 1}.worker.log`, 'wx');
    try {
      const worker = spawn(process.execPath, [SELF, '_worker', '--state-file', options.stateFile], {
        cwd: state.cwd, detached: true, windowsHide: true, stdio: ['ignore', log, log]
      });
      await new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject); });
      worker.unref();
      handedOff = true;
      return { status: 'running', stateFile: options.stateFile, workerPid: worker.pid };
    } finally { fs.closeSync(log); }
  } catch (error) {
    if (state) { state.status = 'failed'; state.error = error.message; saveState(options.stateFile, state); }
    throw error;
  } finally {
    if (!handedOff) {
      try { fs.closeSync(lockFd); } catch {}
      fs.unlinkSync(lock);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main(process.argv.slice(2)).then(result => {
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'failed') process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
