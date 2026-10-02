#!/usr/bin/env node
// Standalone runtime. The real key stays in this process and is never persisted.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MODEL = '@preset/z-ai-glm-5-3-flash';
export const DEFAULT_EXPECTED_MODEL = 'z-ai/glm-5.3-flash';
const UPSTREAM = 'https://openrouter.ai';
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*(?:@preset\/[A-Za-z0-9][A-Za-z0-9._-]*)?$|^@preset\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BODY_LIMIT = 16 * 1024 * 1024;

export class RuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = details;
  }
}
const fail = (code, message, details) => { throw new RuntimeError(code, message, details); };
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const safeCode = (value) => typeof value === 'number' ? value : (
  typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined
);
const safeError = (error) => error instanceof RuntimeError ? error : new RuntimeError('INTERNAL_ERROR', 'Runtime operation failed.');

export function normalizeInput(raw) {
  if (!record(raw)) fail('INVALID_INPUT', 'Input must be a JSON object.');
  const model = raw.model ?? DEFAULT_MODEL;
  const preset = model === DEFAULT_MODEL;
  const expectedModel = raw.expectedModel ?? (preset ? DEFAULT_EXPECTED_MODEL : undefined);
  const effort = raw.effort ?? (preset ? 'max' : undefined);
  for (const [key, value] of Object.entries({ workingDirectory: raw.workingDirectory, codexHome: raw.codexHome, codexEntry: raw.codexEntry, authScript: raw.authScript, apiKey: raw.apiKey })) {
    if (typeof value !== 'string' || !value.trim()) fail('INVALID_INPUT', `Missing or invalid ${key}.`);
  }
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model) || model.includes('..')) fail('INVALID_MODEL', 'Model identifier is invalid.');
  if (expectedModel !== undefined && (typeof expectedModel !== 'string' || !MODEL_PATTERN.test(expectedModel) || expectedModel.includes('@preset/'))) fail('INVALID_EXPECTED_MODEL', 'Expected model must be a concrete model identifier.');
  if (effort !== undefined && !EFFORTS.has(effort)) fail('INVALID_EFFORT', 'Reasoning effort is invalid.');
  const timeoutSeconds = raw.timeoutSeconds ?? 1500;
  const maxRequests = raw.maxRequests ?? 8;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 86400) fail('INVALID_TIMEOUT', 'Timeout must be an integer from 1 to 86400 seconds.');
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100) fail('INVALID_REQUEST_LIMIT', 'Request limit must be an integer from 1 to 100.');
  if (raw.validateOnly !== undefined && typeof raw.validateOnly !== 'boolean') fail('INVALID_INPUT', 'validateOnly must be a boolean.');
  if (!raw.validateOnly && (typeof raw.task !== 'string' || !raw.task.trim())) fail('INVALID_INPUT', 'Task must not be empty for an inference session.');
  if (![raw.workingDirectory, raw.codexHome, raw.codexEntry, raw.authScript].every((item) => path.isAbsolute(item))) fail('INVALID_PATH', 'Dependency paths must be absolute.');
  if (typeof raw.apiKey !== 'string' || /[\r\n]/.test(raw.apiKey)) fail('INVALID_API_KEY', 'API key is invalid.');
  return { ...raw, model, expectedModel, effort, effortSource: raw.effort !== undefined ? 'explicit' : preset ? 'helper_default' : undefined, timeoutSeconds, maxRequests, validateOnly: raw.validateOnly ?? false };
}

export async function checkLocalDependencies(input) {
  const checks = [
    ['working_directory', input.workingDirectory, 'directory'],
    ['codex_home', input.codexHome, 'directory'],
    ['codex_entry', input.codexEntry, 'file'],
    ['auth_script', input.authScript, 'file'],
    ['isolated_config', path.join(input.codexHome, 'config.toml'), 'file'],
  ];
  for (const [name, target, kind] of checks) {
    let info;
    try { info = await stat(target); } catch { fail('MISSING_DEPENDENCY', `Missing local dependency: ${name}.`); }
    if (kind === 'directory' ? !info.isDirectory() : !info.isFile()) fail('INVALID_DEPENDENCY', `Invalid local dependency: ${name}.`);
  }
  if (Number(process.versions.node.split('.')[0]) < 20 || typeof AbortSignal.any !== 'function') fail('UNSUPPORTED_NODE', 'Node.js 20.3 or newer is required.');
  return { node: process.version, codex_entry: 'present', auth_script: 'present', isolated_config: 'present', working_directory: 'present', codex_home: 'present' };
}

async function readJson(response, label) {
  const data = await readBounded(response.body, BODY_LIMIT);
  let body;
  try { body = JSON.parse(data.toString('utf8')); } catch { fail('INVALID_UPSTREAM_JSON', `${label} returned invalid JSON.`); }
  if (!record(body)) fail('INVALID_UPSTREAM_JSON', `${label} returned an invalid object.`);
  return body;
}

async function readBounded(body, maximum) {
  if (!body) fail('EMPTY_UPSTREAM_BODY', 'Upstream returned no response body.');
  let size = 0;
  const chunks = [];
  for await (const chunk of body) {
    size += chunk.length;
    if (size > maximum) fail('BODY_TOO_LARGE', 'Request or response exceeds the size limit.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function checkedFetch(fetchImpl, apiKey, endpoint, signal, options = {}) {
  let response;
  try {
    response = await fetchImpl(`${UPSTREAM}${endpoint}`, {
      ...options,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...(options.headers ?? {}) },
      redirect: 'manual', signal,
    });
  } catch {
    if (signal?.aborted) throw signal.reason instanceof RuntimeError ? signal.reason : new RuntimeError('TIMEOUT', 'Session deadline reached.');
    fail('UPSTREAM_NETWORK_ERROR', 'OpenRouter network request failed.');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => {});
    fail('UPSTREAM_REDIRECT', 'OpenRouter redirect was blocked.', { http_status: response.status });
  }
  if (!response.ok) {
    let code;
    try { code = safeCode((await readJson(response, 'OpenRouter error')).error?.code); } catch {}
    fail('UPSTREAM_HTTP_ERROR', `OpenRouter returned HTTP ${response.status}.`, { http_status: response.status, ...(code === undefined ? {} : { upstream_code: code }) });
  }
  return response;
}

export function resolveCapabilities(input, catalog, presetDocument) {
  if (!Array.isArray(catalog?.data)) fail('INVALID_MODEL_CATALOG', 'Model catalog is missing its model list.');
  let selected = input.model;
  let presetConfig;
  let presetSlug;
  const marker = input.model.indexOf('@preset/');
  if (marker >= 0) {
    presetSlug = input.model.slice(marker + '@preset/'.length);
    const preset = presetDocument?.data;
    if (!record(preset) || preset.status !== 'active' || preset.slug !== presetSlug || !record(preset.designated_version?.config)) fail('INVALID_PRESET', 'Preset is inactive or has no valid designated configuration.');
    presetConfig = preset.designated_version.config;
    if (Array.isArray(presetConfig.models) && presetConfig.models.length > 1 || Array.isArray(presetConfig.fallbacks) && presetConfig.fallbacks.length > 0 || presetConfig.route != null) fail('AMBIGUOUS_PRESET', 'Preset has dynamic routing or fallback models; select a single-model preset.');
    const candidates = [presetConfig.model, ...(Array.isArray(presetConfig.models) ? presetConfig.models : [])].filter((item) => typeof item === 'string' && item.length > 0);
    const unique = [...new Set(candidates)];
    if (marker > 0) selected = input.model.slice(0, marker);
    else if (unique.length === 1) selected = unique[0];
    else fail('AMBIGUOUS_PRESET', 'Preset does not resolve to exactly one concrete model.');
  }
  let modelInfo = catalog.data.find((item) => record(item) && item.id === selected);
  const alias = selected === 'openrouter/auto' || selected === 'openrouter/free' || !modelInfo;
  if (alias) {
    if (!input.expectedModel) fail('UNRESOLVED_MODEL', 'An unresolved or dynamic model requires explicit expectedModel.');
    modelInfo = catalog.data.find((item) => record(item) && item.id === input.expectedModel);
    if (!modelInfo) fail('EXPECTED_MODEL_NOT_IN_CATALOG', 'Expected model is absent from the model catalog.');
  } else if (input.expectedModel && input.expectedModel !== selected) fail('PREFLIGHT_MODEL_MISMATCH', 'Resolved model differs from expectedModel.');
  const expected = input.expectedModel ?? selected;
  if (expected.includes('@preset/') || !MODEL_PATTERN.test(expected)) fail('UNRESOLVED_MODEL', 'Expected responding model is not concrete.');
  const reasoning = record(modelInfo.reasoning) ? modelInfo.reasoning : {};
  const supported = reasoning.supported_efforts;
  if (supported !== undefined && supported !== null && (!Array.isArray(supported) || supported.some((item) => !EFFORTS.has(item)))) fail('INVALID_MODEL_CAPABILITIES', 'Model effort capabilities are invalid.');
  const presetEffort = presetConfig?.reasoning?.effort ?? presetConfig?.reasoning_effort;
  if (presetEffort !== undefined && !EFFORTS.has(presetEffort)) fail('INVALID_PRESET_EFFORT', 'Preset reasoning effort is invalid.');
  const effectiveEffort = input.effort ?? presetEffort ?? reasoning.default_effort;
  if (effectiveEffort !== undefined && !EFFORTS.has(effectiveEffort)) fail('INVALID_MODEL_CAPABILITIES', 'Model default effort is invalid.');
  if (effectiveEffort !== undefined && (supported === undefined || supported !== null && !supported.includes(effectiveEffort) || effectiveEffort === 'none' && reasoning.mandatory === true)) fail('UNSUPPORTED_EFFORT', 'Selected effort is not supported by the resolved model.');
  const tools = Array.isArray(presetConfig?.tools) ? presetConfig.tools : [];
  const serverTools = tools.map((tool) => typeof tool === 'string' ? tool : (tool?.type === 'function' ? 'function' : tool?.type)).filter((item) => typeof item === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(item));
  const unknown = [];
  if (alias) unknown.push('alias_resolution_not_proven_until_response');
  if (supported === undefined) unknown.push('supported_efforts_not_exposed');
  if (effectiveEffort === undefined) unknown.push('default_effort_not_exposed');
  if (presetConfig && !Array.isArray(presetConfig.tools)) unknown.push('preset_server_tools_not_exposed');
  return {
    expectedModel: expected, effectiveEffort,
    effortSource: input.effortSource ?? (presetEffort !== undefined ? 'preset_default' : effectiveEffort !== undefined ? 'catalog_default' : 'model_default_unreported'),
    report: {
      resolved_model: alias ? null : selected,
      expected_model: expected,
      model_catalog: { model: modelInfo.id, supported_efforts: supported ?? null, effort_selection_exposed: supported !== undefined, default_effort: reasoning.default_effort ?? null, mandatory_reasoning: reasoning.mandatory ?? null, supported_parameters: Array.isArray(modelInfo.supported_parameters) ? modelInfo.supported_parameters.filter((item) => typeof item === 'string') : null },
      preset: presetConfig ? { slug: presetSlug, status: 'active', resolved_model: alias ? null : selected, effort: presetEffort ?? null, server_tools: serverTools, designated_version: presetDocument.data.designated_version.version ?? null } : null,
      unknown,
    },
  };
}

export async function preflight(input, { fetchImpl = fetch, signal = new AbortController().signal, checkDependencies = checkLocalDependencies } = {}) {
  const dependencies = await checkDependencies(input);
  const get = async (endpoint, label) => {
    const requestController = new AbortController();
    const timer = setTimeout(() => requestController.abort(new RuntimeError('PREFLIGHT_TIMEOUT', 'OpenRouter preflight GET timed out.')), 20000);
    const requestSignal = AbortSignal.any([signal, requestController.signal]);
    try { return await readJson(await checkedFetch(fetchImpl, input.apiKey, endpoint, requestSignal, { method: 'GET' }), label); }
    catch (error) { if (requestSignal.aborted) throw requestSignal.reason; throw error; }
    finally { clearTimeout(timer); }
  };
  // These GETs are intentionally sequential and never submit an inference request.
  const catalog = await get('/api/v1/models', 'Model catalog');
  const marker = input.model.indexOf('@preset/');
  const preset = marker < 0 ? undefined : await get(`/api/v1/presets/${encodeURIComponent(input.model.slice(marker + 8))}`, 'Preset');
  const capabilities = resolveCapabilities(input, catalog, preset);
  return { ...capabilities, report: { ...capabilities.report, local_dependencies: dependencies, api_key: 'configured', model_called: false, inference_transport: 'not_tested', server_tool_execution: 'not_tested' } };
}

// Handles CR, LF, UTF-8, and multiline data across arbitrary network chunks.
export class SSEInspector {
  constructor(onEvent) { this.decoder = new TextDecoder(); this.buffer = ''; this.data = []; this.event = ''; this.onEvent = onEvent; }
  feed(chunk) { this.consume(this.decoder.decode(chunk, { stream: true })); }
  consume(text) {
    this.buffer += text;
    if (this.buffer.length > BODY_LIMIT) fail('SSE_FRAME_TOO_LARGE', 'Upstream SSE frame exceeds the size limit.');
    while (true) {
      const match = /[\r\n]/.exec(this.buffer);
      if (!match || match[0] === '\r' && match.index === this.buffer.length - 1) return;
      const index = match.index;
      const line = this.buffer.slice(0, index);
      const length = this.buffer[index] === '\r' && this.buffer[index + 1] === '\n' ? 2 : 1;
      this.buffer = this.buffer.slice(index + length);
      this.line(line);
    }
  }
  line(line) {
    if (line === '') { this.dispatch(); return; }
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const key = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (key === 'event') this.event = value;
    if (key === 'data') {
      this.data.push(value);
      if (this.data.reduce((size, item) => size + item.length, 0) > BODY_LIMIT) fail('SSE_FRAME_TOO_LARGE', 'Upstream SSE frame exceeds the size limit.');
    }
  }
  dispatch() {
    if (this.data.length) {
      const data = this.data.join('\n');
      if (data !== '[DONE]') {
        let payload;
        try { payload = JSON.parse(data); } catch { fail('INVALID_UPSTREAM_SSE', 'OpenRouter SSE event is not valid JSON.'); }
        this.onEvent(payload, this.event);
      }
    }
    this.data = []; this.event = '';
  }
  finish() {
    this.consume(this.decoder.decode());
    if (this.buffer.endsWith('\r')) { this.line(this.buffer.slice(0, -1)); this.buffer = ''; }
    if (this.buffer.length || this.data.length) fail('TRUNCATED_UPSTREAM_SSE', 'OpenRouter SSE response ended mid-event.');
  }
}

export class ModelProof {
  constructor(expectedModel) { this.expectedModel = expectedModel; this.models = new Set(); this.completed = false; }
  observe(payload, event = '') {
    if (!record(payload)) return;
    const type = typeof payload.type === 'string' ? payload.type : event;
    if (type === 'error' || type === 'response.failed' || payload.error) fail('UPSTREAM_RESPONSE_ERROR', 'OpenRouter response reported an error.', { ...(safeCode(payload.error?.code ?? payload.code) === undefined ? {} : { upstream_code: safeCode(payload.error?.code ?? payload.code) }) });
    const response = record(payload.response) ? payload.response : payload;
    const model = response.model;
    if (typeof model === 'string' && (record(payload.response) || response.object === 'response' || type.startsWith('response.'))) {
      if (model !== this.expectedModel) fail('RESPONSE_MODEL_MISMATCH', 'Responding model differs from the expected model.');
      this.models.add(model);
    }
    if (type === 'response.completed' || response.object === 'response' && response.status === 'completed') this.completed = true;
    if (type === 'response.incomplete' || response.status === 'incomplete' || response.status === 'failed') fail('INCOMPLETE_RESPONSE', 'OpenRouter did not complete the response.');
  }
  verify() {
    if (!this.models.size) fail('MISSING_MODEL_PROOF', 'OpenRouter response did not identify the responding model.');
    if (!this.completed) fail('MISSING_COMPLETION_PROOF', 'OpenRouter response did not prove completion.');
  }
}

function sendError(response, error) {
  if (response.destroyed) return;
  if (response.headersSent) { response.destroy(); return; }
  const status = error.code === 'REQUEST_LIMIT' ? 429 : error.code === 'LOCAL_AUTH_ERROR' ? 401 : 502;
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { code: error.code, message: error.message } }));
}

function checkNonce(header, nonce) {
  const provided = Buffer.from(typeof header === 'string' ? header : '');
  const expected = Buffer.from(`Bearer ${nonce}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function createGateway(input, capabilities, { fetchImpl = fetch, signal, onFatal = () => {}, nonce = randomBytes(32).toString('hex') } = {}) {
  const state = { requestsSent: 0, verifiedRequests: 0, observedModels: new Set(), forwardedEfforts: new Set(), childEffortsRemoved: 0, active: new Set(), fatal: null };
  const fatal = (error) => {
    if (!state.fatal) { state.fatal = safeError(error); onFatal(state.fatal); }
    return state.fatal;
  };
  const server = http.createServer(async (request, response) => {
    try {
      if (!checkNonce(request.headers.authorization, nonce)) fail('LOCAL_AUTH_ERROR', 'Loopback gateway authentication failed.');
      if (signal.aborted) throw signal.reason;
      if (state.fatal) throw state.fatal;
      const localUrl = new URL(request.url, 'http://gateway.local');
      const safeQuery = [...localUrl.searchParams].every(([key, value]) => key === 'client_version' && /^[A-Za-z0-9_.+-]{1,128}$/.test(value));
      const localPath = request.url.startsWith('/') && !request.url.startsWith('//') && localUrl.origin === 'http://gateway.local';
      const catalogRequest = localPath && request.method === 'GET' && localUrl.pathname === '/api/v1/models' && safeQuery;
      const inferenceRequest = request.method === 'POST' && request.url === '/api/v1/responses';
      if (!catalogRequest && !inferenceRequest) fail('LOCAL_PATH_BLOCKED', 'Loopback gateway path or method is not allowed.');
      let payload;
      let body;
      if (inferenceRequest) {
        if (state.requestsSent >= input.maxRequests) fail('REQUEST_LIMIT', 'Maximum OpenRouter request count reached.');
        const bytes = await readBounded(request, BODY_LIMIT);
        try { payload = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_CHILD_JSON', 'Codex request is not valid JSON.'); }
        if (!record(payload) || payload.model !== input.model || payload.models != null || payload.route != null || payload.fallbacks != null) fail('CHILD_MODEL_MISMATCH', 'Codex request changed the selected model or routing.');
        if (capabilities.effectiveEffort !== undefined) {
          if (payload.reasoning?.effort !== capabilities.effectiveEffort) fail('CHILD_EFFORT_MISMATCH', 'Codex did not send the selected reasoning effort.');
          state.forwardedEfforts.add(payload.reasoning.effort);
        } else if (record(payload.reasoning) && Object.hasOwn(payload.reasoning, 'effort')) {
          // A model with no exposed default must receive its own upstream default.
          payload.reasoning = { ...payload.reasoning };
          delete payload.reasoning.effort;
          state.childEffortsRemoved += 1;
          if (!Object.keys(payload.reasoning).length) delete payload.reasoning;
        }
        body = JSON.stringify(payload);
        // Count immediately before forwarding, including failed attempts. No retries.
        if (state.requestsSent >= input.maxRequests) fail('REQUEST_LIMIT', 'Maximum OpenRouter request count reached.');
        state.requestsSent += 1;
      }
      const pending = (async () => {
        const upstream = await checkedFetch(fetchImpl, input.apiKey, request.url, signal, { method: request.method, ...(body === undefined ? {} : { body }) });
        const contentType = upstream.headers.get('content-type') ?? 'application/json';
        if (catalogRequest) {
          const bytes = await readBounded(upstream.body, BODY_LIMIT);
          response.writeHead(200, { 'content-type': contentType }); response.end(bytes); return;
        }
        const proof = new ModelProof(capabilities.expectedModel);
        if (contentType.toLowerCase().includes('text/event-stream')) {
          const parser = new SSEInspector((item, event) => proof.observe(item, event));
          response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
          for await (const chunk of upstream.body) {
            parser.feed(chunk);
            if (!response.destroyed && !response.write(Buffer.from(chunk))) await new Promise((resolve, reject) => {
              response.once('drain', resolve); response.once('close', () => reject(new RuntimeError('CHILD_DISCONNECTED', 'Codex closed the response connection.')));
            });
          }
          parser.finish(); proof.verify();
          response.end();
        } else {
          const bytes = await readBounded(upstream.body, BODY_LIMIT);
          let item;
          try { item = JSON.parse(bytes.toString('utf8')); } catch { fail('INVALID_UPSTREAM_JSON', 'OpenRouter response is not valid JSON.'); }
          proof.observe(item); proof.verify();
          response.writeHead(200, { 'content-type': 'application/json' }); response.end(bytes);
        }
        state.verifiedRequests += 1;
        for (const model of proof.models) state.observedModels.add(model);
      })();
      state.active.add(pending);
      try { await pending; } finally { state.active.delete(pending); }
    } catch (error) {
      const normalized = safeError(error);
      // Invalid local authentication cannot consume budget or terminate the session.
      if (normalized.code !== 'LOCAL_AUTH_ERROR' && normalized.code !== 'LOCAL_PATH_BLOCKED') fatal(normalized);
      sendError(response, normalized);
    }
  });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    state, nonce, baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await Promise.allSettled([...state.active]);
    },
  };
}

export function buildCodexArguments(input, capabilities, baseUrl, lastMessagePath) {
  const args = [input.codexEntry, 'exec', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '--skip-git-repo-check', '--output-last-message', lastMessagePath, '--cd', input.workingDirectory, '--model', input.model];
  const overrides = {
    model_provider: 'openrouter', approval_policy: 'never',
    'model_providers.openrouter.base_url': baseUrl,
    'model_providers.openrouter.wire_api': 'responses',
    'model_providers.openrouter.requires_openai_auth': false,
    'model_providers.openrouter.request_max_retries': 0,
    'model_providers.openrouter.stream_max_retries': 0,
    'model_providers.openrouter.auth.command': 'powershell',
    'model_providers.openrouter.auth.args': ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', input.authScript],
    'model_providers.openrouter.auth.timeout_ms': 5000,
    'model_providers.openrouter.auth.refresh_interval_ms': 0,
  };
  if (capabilities.effectiveEffort !== undefined) {
    overrides.model_reasoning_effort = capabilities.effectiveEffort;
    overrides.model_supports_reasoning_summaries = true;
  }
  for (const [key, value] of Object.entries(overrides)) args.push('-c', `${key}=${JSON.stringify(value)}`);
  args.push('-');
  return args;
}

export function childEnvironment(input, nonce, environment = process.env) {
  // Drop copies of the supplied secret, even under an unexpected environment name.
  const env = Object.fromEntries(Object.entries(environment).filter(([, value]) => typeof value === 'string' && !value.includes(input.apiKey)));
  for (const key of Object.keys(env)) if (['OPENROUTER_API_KEY', 'CODEX_HOME'].includes(key.toUpperCase())) delete env[key];
  return { ...env, CODEX_HOME: input.codexHome, OPENROUTER_API_KEY: nonce };
}

export async function killOwnedChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => { killer.kill(); resolve(); }, 5000);
      killer.once('error', () => { clearTimeout(timer); child.kill(); resolve(); });
      killer.once('close', () => { clearTimeout(timer); resolve(); });
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

function waitChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new RuntimeError('CHILD_START_ERROR', 'Codex process could not be started.')));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

export async function run(raw, dependencies = {}) {
  const started = Date.now();
  let input;
  let gateway;
  let child;
  let tempDirectory;
  let failure;
  let stopResolve;
  const stopped = new Promise((resolve) => { stopResolve = resolve; });
  const controller = new AbortController();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const spawnImpl = dependencies.spawnImpl ?? spawn;
  const killChild = dependencies.killChild ?? killOwnedChild;
  let timer;
  let killPromise;
  const stop = (error) => {
    if (failure) return;
    failure = safeError(error);
    controller.abort(failure);
    stopResolve();
    if (child) killPromise = killChild(child);
  };
  let onSigint;
  let onSigterm;
  try {
    input = normalizeInput(raw);
    timer = setTimeout(() => stop(new RuntimeError('TIMEOUT', 'Session deadline reached.')), input.timeoutSeconds * 1000);
    onSigint = () => stop(new RuntimeError('CANCELLED', 'Session was cancelled.'));
    onSigterm = onSigint;
    process.once('SIGINT', onSigint); process.once('SIGTERM', onSigterm);
    const capabilities = await preflight(input, { fetchImpl, signal: controller.signal, checkDependencies: dependencies.checkDependencies ?? checkLocalDependencies });
    if (failure) throw failure;
    const common = { provider: 'openrouter', requested_model: input.model, expected_model: capabilities.expectedModel, effort: capabilities.effectiveEffort ?? null, effort_source: capabilities.effortSource, max_requests: input.maxRequests, timeout_seconds: input.timeoutSeconds };
    if (input.validateOnly) return { status: 'ready', ...common, model: null, requests_sent: 0, elapsed_seconds: (Date.now() - started) / 1000, preflight: capabilities.report };
    gateway = await createGateway(input, capabilities, { fetchImpl, signal: controller.signal, onFatal: stop });
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'openrouter-codex-'));
    const lastMessagePath = path.join(tempDirectory, 'last-message.txt');
    if (failure) throw failure;
    child = spawnImpl(process.execPath, buildCodexArguments(input, capabilities, gateway.baseUrl, lastMessagePath), {
      shell: false, windowsHide: true, cwd: input.workingDirectory,
      detached: process.platform !== 'win32',
      env: childEnvironment(input, gateway.nonce), stdio: ['pipe', 'ignore', 'ignore'],
    });
    const completion = waitChild(child);
    // Suppress EPIPE if Codex exits before consuming the task. The exit remains checked.
    child.stdin.on('error', () => {});
    child.stdin.end(input.task);
    const result = await Promise.race([completion, stopped.then(() => null)]);
    if (failure) throw failure;
    if (!result || result.code !== 0) fail('CHILD_EXIT_ERROR', 'Codex process failed.', { child_exit_code: result?.code ?? null });
    await Promise.allSettled([...gateway.state.active]);
    if (failure || gateway.state.fatal) throw failure ?? gateway.state.fatal;
    if (!gateway.state.requestsSent || gateway.state.verifiedRequests !== gateway.state.requestsSent || gateway.state.observedModels.size !== 1) fail('MISSING_MODEL_PROOF', 'The complete session has no verified responding model.');
    let response;
    try { response = (await readFile(lastMessagePath, 'utf8')).trim(); } catch { fail('MISSING_FINAL_RESPONSE', 'Codex produced no final response file.'); }
    if (!response) fail('EMPTY_FINAL_RESPONSE', 'Codex produced an empty final response.');
    for (const secret of [input.apiKey, gateway.nonce]) response = response.replaceAll(secret, '[redacted]');
    return { status: 'completed', ...common, model: [...gateway.state.observedModels][0], requests_sent: gateway.state.requestsSent, elapsed_seconds: (Date.now() - started) / 1000, effort_forwarded: [...gateway.state.forwardedEfforts], child_efforts_removed_for_model_default: gateway.state.childEffortsRemoved, response };
  } catch (error) {
    stop(safeError(error));
    return { status: 'error', provider: 'openrouter', requested_model: input?.model ?? null, model: null, effort: input?.effort ?? null, requests_sent: gateway?.state.requestsSent ?? 0, elapsed_seconds: (Date.now() - started) / 1000, error: { code: failure.code, message: failure.message, ...failure.details } };
  } finally {
    clearTimeout(timer);
    if (onSigint) process.removeListener('SIGINT', onSigint);
    if (onSigterm) process.removeListener('SIGTERM', onSigterm);
    controller.abort(failure ?? new RuntimeError('SESSION_FINISHED', 'Session finished.'));
    if (killPromise) await killPromise;
    else if (child && child.exitCode === null && child.signalCode === null) await killChild(child);
    if (gateway) await gateway.close();
    if (tempDirectory) {
      const target = path.resolve(tempDirectory);
      if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('openrouter-codex-')) fail('UNSAFE_TEMP_CLEANUP', 'Temporary cleanup target failed its scope check.');
      await rm(target, { recursive: true, force: true });
    }
  }
}

async function main() {
  let raw;
  try { raw = JSON.parse((await readBounded(process.stdin, BODY_LIMIT)).toString('utf8').replace(/^\uFEFF/, '')); }
  catch { process.stdout.write(JSON.stringify({ status: 'error', provider: 'openrouter', error: { code: 'INVALID_INPUT', message: 'stdin must contain one valid JSON object.' } }) + '\n'); process.exitCode = 1; return; }
  const result = await run(raw);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (result.status === 'error') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
