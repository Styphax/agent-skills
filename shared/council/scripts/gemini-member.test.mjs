import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildGeminiEnv, parseArgs, buildArgs, buildSettings, requireModel, parseOutput, validateResult, nextState, findAgy, agentName, AGENT_ROOT } from './gemini-member.mjs';

const base = ['--prompt-file', 'h.md', '--state-file', 's.json'];
const conv = '3e1996c6-81c4-47c2-95de-72d7012c8076';

test('child environment drops API keys and T3 overrides without mutating the parent', () => {
  const source = Object.freeze({ PATH: 'p', GEMINI_HOME: 'h', gemini_api_key: 'k', GOOGLE_API_KEY: 'k',
    ANTIGRAVITY_EXTENSION_PORT: '1', GOOGLE_APPLICATION_CREDENTIALS: 'c', USERPROFILE: 'u' });
  assert.deepEqual(buildGeminiEnv(source), { PATH: 'p', USERPROFILE: 'u' });
  assert.equal(source.GEMINI_HOME, 'h');
});

test('aliases map to Gemini 4 models and the default is Neon at xhigh', () => {
  assert.equal(parseArgs(base).model, 'gemini-4-neon');
  assert.equal(parseArgs(base).effort, 'xhigh');
  assert.equal(parseArgs(['--model', 'hydrogen', ...base]).model, 'gemini-4-hydrogen');
  assert.equal(parseArgs(['--model', 'gemini-4-argon', '--effort', 'high', ...base]).model, 'gemini-4-argon');
  assert.equal(parseArgs(['--model', 'Neon', ...base]).model, 'gemini-4-neon');
});

test('rejects unsupported effort instead of substituting it', () => {
  assert.throws(() => parseArgs(['--model', 'argon', ...base]), /no effort "xhigh".*do not substitute/);
  assert.throws(() => parseArgs(['--effort', 'max', ...base]), /no effort "max"/);
  assert.throws(() => parseArgs(['--model', 'gemini-3.8-flash', ...base]), /Unsupported model/);
  assert.throws(() => parseArgs(['--model', 'opus', ...base]), /Unsupported model/);
});

test('web and no-web runs use different agents; both settings deny writes and commands', () => {
  const web = parseArgs(base);
  const offline = parseArgs(['--no-web', ...base]);
  const args = buildArgs(web, 'set.json');
  assert.equal(args[args.indexOf('--agent') + 1], 'council-member-web');
  assert.equal(buildArgs(offline, 'set.json')[buildArgs(offline, 'set.json').indexOf('--agent') + 1], 'council-member');
  assert.equal(args[args.indexOf('--settings') + 1], 'set.json');
  assert.ok(!args.includes('--conversation'));
  assert.deepEqual(buildArgs(web, 'set.json', conv).slice(-2), ['--conversation', conv]);
  for (const settings of [buildSettings(web), buildSettings(offline)]) {
    assert.ok(settings.permissions.deny.includes('write_file(*)') && settings.permissions.deny.includes('command(*)'));
    assert.equal(settings.modelProvider, '');
  }
  assert.ok(buildSettings(offline).permissions.deny.includes('read_url(*)'));
  assert.ok(!buildSettings(web).permissions.deny.includes('read_url(*)'));
});

test('model check needs the exact model and effort slug', () => {
  const listing = 'Fetching available models...\ngemini-4-neon-xhigh\tGemini 4 Neon (XHigh)\ngemini-4-argon-high\tGemini 4 Argon (High)\n';
  requireModel('agy', {}, 'gemini-4-neon', 'xhigh', () => listing);
  assert.throws(() => requireModel('agy', {}, 'gemini-4-carbon', 'high', () => listing), /not available/);
  assert.throws(() => requireModel('agy', {}, 'gemini-4-neon', 'xhigh', () => { throw new Error('x'); }), /Cannot list/);
});

test('result validation', () => {
  const options = parseArgs(base);
  const init = { event: 'init', conversation_id: conv, init: { model: 'gemini-4-neon', agent: 'council-member-web' } };
  const ok = { status: 'SUCCESS', conversation_id: conv, response: 'Answer.' };
  assert.equal(validateResult({ init, result: ok }, options).answer, 'Answer.');
  assert.equal(validateResult({ init, result: ok }, options, conv).conversationId, conv);
  assert.throws(() => validateResult({ init, result: { ...ok, response: '', denied_actions: [{ action: 'command' }] } }, options), /no answer.*command/);
  assert.throws(() => validateResult({ init, result: { ...ok, status: 'ERROR', error: 'quota' } }, options), /ERROR quota/);
  assert.throws(() => validateResult({ init, result: ok }, options, '00000000-0000-0000-0000-000000000000'), /different conversation/);
  assert.throws(() => validateResult({ init: { ...init, init: { model: 'gemini-4-neon' } }, result: ok }, options), /no agent/);
  assert.throws(() => validateResult({ init: { ...init, init: { ...init.init, model: 'gemini-4-argon' } }, result: ok }, options), /agy started gemini-4-argon/);
  assert.throws(() => validateResult({ init: { ...init, conversation_id: '00000000-0000-0000-0000-000000000000' }, result: ok }, options), /inconsistent/);
  assert.equal(validateResult({ init, result: ok, toolNames: ['read_file', 'search_web'] }, options).answer, 'Answer.');
  assert.throws(() => validateResult({ init, result: ok, toolNames: ['read_file', 'run_command'] }, options), /outside its read-only set: run_command/);
  const offline = parseArgs(['--no-web', ...base]);
  const offlineInit = { ...init, init: { ...init.init, agent: 'council-member' } };
  assert.throws(() => validateResult({ init: offlineInit, result: ok, toolNames: ['search_web'] }, offline), /search_web/);
});

test('resume keeps model, effort, web setting and working directory', () => {
  const options = parseArgs(base);
  const done = { ...nextState(options, null, 'C:/w'), status: 'completed', turns: 1, conversationId: conv };
  assert.throws(() => nextState(options, done, 'C:/w'), /already exists/);
  const resume = { ...options, resume: true };
  assert.equal(nextState(resume, done, 'C:/w').conversationId, conv);
  assert.throws(() => nextState({ ...resume, noWeb: true }, done, 'C:/w'), /Cannot change noWeb/);
  assert.throws(() => nextState(resume, done, 'C:/other'), /original working directory/);
  assert.throws(() => nextState(resume, { ...done, status: 'failed' }, 'C:/w'), /completed previous turn/);
});

test('output parsing collects called tools and needs one init and one result', () => {
  const lines = [
    { event: 'init', conversation_id: conv, init: { model: 'gemini-4-neon', agent: 'council-member-web', tools: ['run_command'] } },
    { event: 'step_update', step_update: { step_type: 'tool', tool_name: 'read_file', state: 'DONE' } },
    { event: 'step_update', step_update: { step_type: 'tool', tool_info: { name: 'search_web' }, state: 'ACTIVE' } },
    { event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'x' } },
    { event: 'result', result: { status: 'SUCCESS', conversation_id: conv, response: 'A' } },
  ].map(e => JSON.stringify(e));
  assert.deepEqual(parseOutput(lines.join('\n')).toolNames, ['read_file', 'search_web']);
  assert.throws(() => parseOutput(lines.slice(1).join('\n')), /exactly one init/);
  assert.throws(() => parseOutput([...lines, lines.at(-1)].join('\n')), /exactly one init/);
  assert.throws(() => parseOutput(lines[0] + '\n{"event":'), SyntaxError);
});

test('agent definitions match the agent names and the web rule', () => {
  const dir = path.join(AGENT_ROOT, '.agents', 'agents');
  const web = fs.readFileSync(path.join(dir, agentName({ noWeb: false }) + '.md'), 'utf8');
  const offline = fs.readFileSync(path.join(dir, agentName({ noWeb: true }) + '.md'), 'utf8');
  assert.match(web, /^name: council-member-web$/m);
  assert.match(offline, /^name: council-member$/m);
  assert.match(web, /- search_web/);
  assert.doesNotMatch(offline, /search_web/);
  for (const text of [web, offline]) assert.doesNotMatch(text, /run_command|write_to_file|invoke_subagent/);
});

test('finds agy through T3 Code active.json when it is not on PATH', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'));
  const base = path.join(home, '.t3', 'tools', 'antigravity-acp', `${process.platform}-${process.arch}`);
  const exe = path.join(base, 'versions', 'r1', process.platform === 'win32' ? 'agy.exe' : 'agy');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  fs.writeFileSync(path.join(base, 'active.json'), JSON.stringify({ releaseId: 'r1' }));
  assert.equal(findAgy({ PATH: '' }, home), exe);
  fs.rmSync(home, { recursive: true });
  assert.throws(() => findAgy({ PATH: '' }, home), /agy not found/);
});
