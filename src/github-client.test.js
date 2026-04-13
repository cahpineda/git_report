import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinkHeader, githubRequest, listOrgRepos } from './github-client.js';

// ---------------------------------------------------------------------------
// parseLinkHeader — pure logic, no network calls needed
// ---------------------------------------------------------------------------

describe('parseLinkHeader', () => {
  it('returns {} for null input', () => {
    assert.deepEqual(parseLinkHeader(null), {});
  });

  it('returns {} for undefined input', () => {
    assert.deepEqual(parseLinkHeader(undefined), {});
  });

  it('returns {} for empty string', () => {
    assert.deepEqual(parseLinkHeader(''), {});
  });

  it('parses a single rel="next" entry', () => {
    const header = '<https://api.github.com/orgs/foo/repos?page=2>; rel="next"';
    const result = parseLinkHeader(header);
    assert.deepEqual(result, {
      next: 'https://api.github.com/orgs/foo/repos?page=2',
    });
  });

  it('parses multiple rels from a combined header', () => {
    const header =
      '<https://api.github.com/orgs/foo/repos?page=2>; rel="next", ' +
      '<https://api.github.com/orgs/foo/repos?page=5>; rel="last"';
    const result = parseLinkHeader(header);
    assert.deepEqual(result, {
      next: 'https://api.github.com/orgs/foo/repos?page=2',
      last: 'https://api.github.com/orgs/foo/repos?page=5',
    });
  });

  it('preserves query parameters in URL', () => {
    const header =
      '<https://api.github.com/orgs/foo/repos?per_page=100&page=3&type=all>; rel="next"';
    const result = parseLinkHeader(header);
    assert.equal(result.next, 'https://api.github.com/orgs/foo/repos?per_page=100&page=3&type=all');
  });

  it('parses prev and first rels too', () => {
    const header =
      '<https://api.github.com/orgs/foo/repos?page=1>; rel="first", ' +
      '<https://api.github.com/orgs/foo/repos?page=2>; rel="prev"';
    const result = parseLinkHeader(header);
    assert.ok(result.first);
    assert.ok(result.prev);
  });
});

// ---------------------------------------------------------------------------
// githubRequest — error handling without network calls
// ---------------------------------------------------------------------------

describe('githubRequest', () => {
  it('throws synchronously when GITHUB_TOKEN is not set', () => {
    const saved = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    try {
      assert.throws(
        () => githubRequest('/orgs/foo/repos'),
        (err) => {
          assert.ok(
            err.message.includes('GITHUB_TOKEN'),
            `Expected error about GITHUB_TOKEN, got: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      // Always restore the env var
      if (saved !== undefined) {
        process.env.GITHUB_TOKEN = saved;
      }
    }
  });

  it('returns a Promise when token is present', () => {
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token-value';

    try {
      const result = githubRequest('/orgs/foo/repos');
      assert.ok(result instanceof Promise, 'githubRequest should return a Promise');
      // Abort the in-flight request by ignoring the promise
      result.catch(() => {}); // Prevent unhandled rejection — network will fail
    } finally {
      if (saved !== undefined) {
        process.env.GITHUB_TOKEN = saved;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// listOrgRepos — structural check (no network)
// ---------------------------------------------------------------------------

describe('listOrgRepos', () => {
  it('is an exported async function', () => {
    assert.equal(typeof listOrgRepos, 'function');
    // Async functions return Promises; check by calling (with token guard)
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'test-token';
    try {
      const result = listOrgRepos('test-org');
      assert.ok(result instanceof Promise, 'listOrgRepos should return a Promise');
      result.catch(() => {}); // Ignore network failure
    } finally {
      if (saved !== undefined) {
        process.env.GITHUB_TOKEN = saved;
      } else {
        delete process.env.GITHUB_TOKEN;
      }
    }
  });
});
