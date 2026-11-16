import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClaudeEnv, requireClaudeAccount, buildArgs } from './claude-member.mjs';

test('child auth excludes API routes without mutating parent or removing account OAuth', () => {
  const source = Object.freeze({
    PATH: 'system-path', ANTHROPIC_API_KEY: 'test-key', anthropic_auth_token: 'test-token',
    ANTHROPIC_BASE_URL: 'https://example.invalid', ANTHROPIC_CUSTOM_HEADERS: 'test-header',
    CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1',
    CLAUDE_CODE_OAUTH_TOKEN: 'test-account-token', APPDATA: 'test-appdata',
  });
  assert.deepEqual(buildClaudeEnv(source), {
    PATH: 'system-path', CLAUDE_CODE_OAUTH_TOKEN: 'test-account-token', APPDATA: 'test-appdata',
  });
  assert.equal(source.ANTHROPIC_API_KEY, 'test-key');
});

test('account check uses supplied environment and stores only auth method and provider', () => {
  const env = buildClaudeEnv({ ANTHROPIC_API_KEY: 'test-key', PATH: 'test-path' });
  const auth = requireClaudeAccount('claude', env, (exe, args, options) => {
    assert.equal(exe, 'claude');
    assert.deepEqual(args, ['--safe-mode', 'auth', 'status', '--json']);
    assert.equal(options.env, env);
    assert.equal(options.windowsHide, true);
    return JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'unused@example.invalid' });
  });
  assert.deepEqual(auth, { authMethod: 'claude.ai', apiProvider: 'firstParty' });
});

test('rejects unsigned, API and cloud authentication', () => {
  for (const auth of [
    { loggedIn: false, authMethod: 'claude.ai', apiProvider: 'firstParty' },
    { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' },
    { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' },
    {}, null,
  ]) {
    assert.throws(() => requireClaudeAccount('claude', {}, () => JSON.stringify(auth)), /requires Claude account login/);
  }
});

test('does not expose subprocess diagnostics when verification fails', () => {
  assert.throws(() => requireClaudeAccount('claude', {}, () => { throw new Error('test-secret'); }),
    error => /Cannot verify/.test(error.message) && !error.message.includes('test-secret'));
  assert.throws(() => requireClaudeAccount('claude', {}, () => 'not-json'), /Cannot verify/);
});

test('requested model, effort and read-only safe mode remain intact', () => {
  const args = buildArgs({ model: 'claude-opus-5-5', effort: 'xhigh', noWeb: false, resume: false }, 'test-session');
  assert.equal(args[args.indexOf('--model') + 1], 'claude-opus-5-5');
  assert.equal(args[args.indexOf('--effort') + 1], 'xhigh');
  assert.ok(args.includes('--safe-mode'));
  assert.equal(args[args.indexOf('--tools') + 1], 'Read,Glob,Grep,WebSearch,WebFetch');
});
