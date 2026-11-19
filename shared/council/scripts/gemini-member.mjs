import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
export const AGENT_ROOT = path.resolve(path.dirname(SELF), '..', 'gemini');
// Effort levels per Gemini 4 model, from `agy models` and the headless docs (2026-11-19).
export const MODELS = {
  'gemini-4-neon': ['low', 'medium', 'high', 'xhigh'],
  'gemini-4-argon': ['low', 'medium', 'high'],
  'gemini-4-hydrogen': ['low', 'medium', 'high', 'xhigh'],
  'gemini-4-carbon': ['low', 'medium', 'high'],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildGeminiEnv(source = process.env) {
  const excluded = new Set([
    'GEMINI_HOME', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI',
    'GOOGLE_CLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS',
  ]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => {
    const upper = key.toUpperCase();
    return !excluded.has(upper) && !upper.startsWith('ANTIGRAVITY_');
  }));
}

export function parseArgs(argv) {
  const options = { model: 'gemini-4-neon', effort: 'xhigh', resume: false, noWeb: false, dryRun: false };
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
  options.model = options.model.toLowerCase();
  if (!options.model.startsWith('gemini-')) options.model = `gemini-4-${options.model}`;
  const efforts = MODELS[options.model];
  if (!efforts) throw new Error(`Unsupported model. Use one of: ${Object.keys(MODELS).map(m => m.slice(9)).join(', ')}.`);
  if (!efforts.includes(options.effort)) {
    throw new Error(`${options.model} has no effort "${options.effort}" (available: ${efforts.join(', ')}). Ask the user; do not substitute.`);
  }
  if (!options.promptFile || !options.stateFile) throw new Error('--prompt-file and --state-file are required.');
  options.promptFile = path.resolve(options.promptFile);
  options.stateFile = path.resolve(options.stateFile);
  return options;
}

export function findAgy(env = process.env, home = os.homedir()) {
  const name = process.platform === 'win32' ? 'agy.exe' : 'agy';
  for (const dir of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  // T3 Code installs agy here and updates active.json on each release.
  const base = path.join(home, '.t3', 'tools', 'antigravity-acp', `${process.platform}-${process.arch}`);
  try {
    const { releaseId } = JSON.parse(fs.readFileSync(path.join(base, 'active.json'), 'utf8'));
    const candidate = path.join(base, 'versions', releaseId, name);
    if (fs.existsSync(candidate)) return candidate;
  } catch {}
  throw new Error('agy not found. Install the Antigravity CLI or put agy on PATH.');
}

// Second layer behind the agent's tool list. agentMode '' is the default
// mode (no auto-approval); modelProvider '' keeps the account login, because
// 'gemini' would switch agy to API-key billing.
export function buildSettings(options) {
  const deny = ['write_file(*)', 'command(*)', 'execute_url(*)', 'download_url(*)', 'mcp(*)'];
  if (options.noWeb) deny.push('read_url(*)');
  return { agentMode: '', modelProvider: '', allowNonWorkspaceAccess: true,
    permissions: { allow: ['read_file(*)'], deny } };
}

export const agentName = options => options.noWeb ? 'council-member' : 'council-member-web';
export const allowedTools = options => options.noWeb ? ['read_file'] : ['read_file', 'search_web'];

export function buildArgs(options, settingsPath, conversationId = null) {
  if (conversationId && !UUID.test(conversationId)) throw new Error('Invalid saved conversation ID.');
  const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--disable-slash-commands',
    '--model', options.model, '--effort', options.effort,
    '--add-dir', AGENT_ROOT, '--agent', agentName(options), '--settings', settingsPath];
  if (conversationId) args.push('--conversation', conversationId);
  return args;
}

export function requireModel(executable, env, model, effort, run = execFileSync) {
  let listing;
  try {
    listing = run(executable, ['models'], { env, encoding: 'utf8', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('Cannot list Antigravity models (not signed in under ~/.gemini, no network, or sandboxed); no prompt was sent.');
  }
  const slugs = listing.split(/\r?\n/).map(line => line.split(/\s/)[0]);
  if (!slugs.includes(`${model}-${effort}`)) {
    throw new Error(`${model} at ${effort} is not available on this Antigravity account; no prompt was sent.`);
  }
}

export function parseOutput(text) {
  const events = text.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const inits = events.filter(event => event.event === 'init');
  const results = events.filter(event => event.event === 'result');
  if (inits.length !== 1 || results.length !== 1) throw new Error('Expected exactly one init and one result event.');
  // init.tools is agy's whole catalogue, not the member's tool set, so check the tools actually called.
  const toolNames = [...new Set(events.filter(event => event.event === 'step_update' && event.step_update?.step_type === 'tool')
    .map(event => event.step_update.tool_name || event.step_update.tool_info?.name || 'unknown'))];
  return { init: inits[0], result: results[0].result, toolNames };
}

export function validateResult({ init, result, toolNames = [] }, options, expectedConversation = null) {
  const forbidden = toolNames.filter(name => !allowedTools(options).includes(name));
  if (forbidden.length) throw new Error(`Gemini called tools outside its read-only set: ${forbidden.join(', ')}. Answer not accepted.`);
  if (result?.status !== 'SUCCESS') throw new Error(`Gemini did not complete successfully: ${result?.status || 'missing result'} ${result?.error || ''}`.trim());
  const conversationId = result.conversation_id;
  if (!UUID.test(conversationId || '') || init.conversation_id !== conversationId) throw new Error('Missing or inconsistent conversation ID.');
  if (expectedConversation && conversationId !== expectedConversation) throw new Error('Gemini returned a different conversation ID.');
  // init.model echoes the request; agy reports no server-side model.
  if (init.init?.model !== options.model || init.init?.agent !== agentName(options)) {
    throw new Error(`Requested ${options.model} with ${agentName(options)}; agy started ${init.init?.model || 'unknown'} with ${init.init?.agent || 'no agent'}.`);
  }
  if (typeof result.response !== 'string' || !result.response.trim()) {
    const denied = (result.denied_actions || []).map(action => action.action).join(', ');
    throw new Error(`Gemini returned no answer.${denied ? ` Denied actions: ${denied}.` : ''}`);
  }
  return { conversationId, answer: result.response, deniedActions: result.denied_actions || [] };
}

export function nextState(options, previous, cwd = process.cwd()) {
  if (!options.resume) {
    if (previous) throw new Error('State already exists. Use a new state file for a new council.');
    return { conversationId: null, model: options.model, effort: options.effort, noWeb: options.noWeb, cwd, turns: 0 };
  }
  if (!previous || previous.status !== 'completed' || previous.turns < 1) throw new Error('Resume requires a completed previous turn.');
  for (const key of ['model', 'effort', 'noWeb']) {
    if (previous[key] !== options[key]) throw new Error(`Cannot change ${key} during a council.`);
  }
  if (previous.cwd !== cwd) throw new Error('Resume from the original working directory.');
  if (!UUID.test(previous.conversationId || '')) throw new Error('Invalid saved conversation ID.');
  return { ...previous };
}

function runAgy(executable, args, input, rawPath, stderrPath, env) {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(rawPath, 'wx');
    let err;
    try { err = fs.openSync(stderrPath, 'wx'); }
    catch (error) { fs.closeSync(out); throw error; }
    const child = spawn(executable, args, { env, shell: false, windowsHide: true, stdio: ['pipe', out, err] });
    let failure;
    const interrupted = () => { failure = new Error('Gemini turn interrupted.'); child.kill('SIGKILL'); };
    process.once('SIGINT', interrupted);
    process.once('SIGTERM', interrupted);
    child.once('error', error => { failure = error; });
    child.stdin.on('error', error => { failure ||= error; });
    child.once('close', code => {
      process.removeListener('SIGINT', interrupted);
      process.removeListener('SIGTERM', interrupted);
      fs.closeSync(out);
      fs.closeSync(err);
      if (failure) reject(failure);
      else resolve(code);
    });
    child.stdin.end(input, 'utf8');
  });
}

export async function main(argv) {
  const options = parseArgs(argv);
  const prompt = fs.readFileSync(options.promptFile, 'utf8');
  if (!prompt.trim()) throw new Error('Empty handoff file.');
  const executable = findAgy();
  const env = buildGeminiEnv();
  const settingsPath = `${options.stateFile}.settings.json`;
  if (options.dryRun) {
    // Free check before Round 1: the account must offer this model and effort.
    requireModel(executable, env, options.model, options.effort);
    const previous = fs.existsSync(options.stateFile) ? JSON.parse(fs.readFileSync(options.stateFile, 'utf8')) : null;
    const state = nextState(options, previous);
    console.log(JSON.stringify({ executable, args: buildArgs(options, settingsPath, state.conversationId), settings: buildSettings(options),
      cwd: process.cwd(), agentRoot: AGENT_ROOT, modelAvailable: true, timeoutMs: null }, null, 2));
    return;
  }
  const lock = `${options.stateFile}.lock`;
  fs.mkdirSync(path.dirname(options.stateFile), { recursive: true });
  let lockFd;
  try { lockFd = fs.openSync(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Council lock exists: ${lock}. Check whether its recorded process is still running. Do not remove an active lock or automatically retry a possibly consumed turn.`);
    throw error;
  }
  fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  let state;
  const save = () => fs.writeFileSync(options.stateFile, JSON.stringify(state, null, 2) + '\n');
  try {
    const previous = fs.existsSync(options.stateFile) ? JSON.parse(fs.readFileSync(options.stateFile, 'utf8')) : null;
    state = nextState(options, previous);
    const round = state.turns + 1;
    for (const key of ['completedAt', 'deniedActions', 'error']) delete state[key];
    state.status = 'running';
    state.startedAt = new Date().toISOString();
    save();
    requireModel(executable, env, options.model, options.effort);
    fs.writeFileSync(settingsPath, JSON.stringify(buildSettings(options), null, 2) + '\n');
    const rawPath = `${options.stateFile}.round${round}.jsonl`;
    const stderrPath = `${options.stateFile}.round${round}.stderr.txt`;
    const input = JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n';
    const code = await runAgy(executable, buildArgs(options, settingsPath, state.conversationId), input, rawPath, stderrPath, env);
    const raw = fs.readFileSync(rawPath, 'utf8');
    if (!raw.trim()) throw new Error(`agy exited ${code} without output. See ${stderrPath}.`);
    let parsed;
    try { parsed = parseOutput(raw); }
    catch (error) { throw new Error(`Cannot read agy output (${error.message}). See ${rawPath}.`); }
    const { conversationId, answer, deniedActions } = validateResult(parsed, options, state.conversationId);
    if (code !== 0) throw new Error(`agy exited ${code}. See ${rawPath} and ${stderrPath}.`);
    state.conversationId = conversationId;
    state.turns = round;
    state.status = 'completed';
    state.completedAt = new Date().toISOString();
    state.deniedActions = deniedActions;
    save();
    console.log(JSON.stringify({ status: state.status, conversationId, model: state.model,
      requestedEffort: state.effort, noWeb: state.noWeb, turns: state.turns, deniedActions, result: answer }, null, 2));
  } catch (error) {
    if (state) { state.status = 'failed'; state.error = error.message; save(); }
    throw error;
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
