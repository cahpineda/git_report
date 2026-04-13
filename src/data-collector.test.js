import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommitsPath,
  buildBranchesPath,
  filterMergeCommits,
  mapCommitData,
  listRepoCommits,
  listAllRepoCommits,
  getRateLimitInfo,
  getCommitStats,
  collectRepoStats,
  aggregateStats,
} from './data-collector.js';

// ---------------------------------------------------------------------------
// buildCommitsPath — pure URL builder
// ---------------------------------------------------------------------------

describe('buildCommitsPath', () => {
  it('includes since date with T00:00:00Z suffix', () => {
    const path = buildCommitsPath('myorg', 'myrepo', '2026-04-06', '2026-04-12');
    assert.ok(
      path.includes('since=2026-04-06T00:00:00Z'),
      `Expected since suffix, got: ${path}`
    );
  });

  it('includes until date with T23:59:59Z suffix', () => {
    const path = buildCommitsPath('myorg', 'myrepo', '2026-04-06', '2026-04-12');
    assert.ok(
      path.includes('until=2026-04-12T23:59:59Z'),
      `Expected until suffix, got: ${path}`
    );
  });

  it('includes org and repo in path', () => {
    const path = buildCommitsPath('inkaviation', 'my-repo', '2026-04-06', '2026-04-12');
    assert.ok(path.includes('/repos/inkaviation/my-repo/commits'), `Path missing org/repo: ${path}`);
  });

  it('includes per_page=100', () => {
    const path = buildCommitsPath('org', 'repo', '2026-04-06', '2026-04-12');
    assert.ok(path.includes('per_page=100'), `Missing per_page: ${path}`);
  });

  it('includes sha param when branch is provided', () => {
    const path = buildCommitsPath('org', 'repo', '2026-04-06', '2026-04-12', 'feature/my-branch');
    assert.ok(path.includes('sha=feature%2Fmy-branch'), `Missing sha param: ${path}`);
  });

  it('omits sha param when branch is null', () => {
    const path = buildCommitsPath('org', 'repo', '2026-04-06', '2026-04-12', null);
    assert.ok(!path.includes('sha='), `Should not include sha: ${path}`);
  });
});

// ---------------------------------------------------------------------------
// buildBranchesPath — pure URL builder
// ---------------------------------------------------------------------------

describe('buildBranchesPath', () => {
  it('returns correct branches API path', () => {
    const path = buildBranchesPath('inkaviation', 'my-repo');
    assert.equal(path, '/repos/inkaviation/my-repo/branches?per_page=100');
  });
});

// ---------------------------------------------------------------------------
// listAllRepoCommits — structural check (no network)
// ---------------------------------------------------------------------------

describe('listAllRepoCommits', () => {
  it('is an exported async function', () => {
    assert.equal(typeof listAllRepoCommits, 'function');
  });
});

// ---------------------------------------------------------------------------
// filterMergeCommits — pure filtering logic
// ---------------------------------------------------------------------------

describe('filterMergeCommits', () => {
  it('keeps a regular commit with 1 parent', () => {
    const commits = [{ sha: 'abc', parents: [{ sha: 'prev' }] }];
    const result = filterMergeCommits(commits);
    assert.equal(result.length, 1);
  });

  it('excludes a merge commit with 2 parents', () => {
    const commits = [{ sha: 'merge', parents: [{ sha: 'a' }, { sha: 'b' }] }];
    const result = filterMergeCommits(commits);
    assert.equal(result.length, 0);
  });

  it('keeps an initial commit with 0 parents', () => {
    const commits = [{ sha: 'init', parents: [] }];
    const result = filterMergeCommits(commits);
    assert.equal(result.length, 1);
  });

  it('filters mixed array correctly — keeps non-merge, excludes merge', () => {
    const commits = [
      { sha: 'a', parents: [] },                          // keep (initial)
      { sha: 'b', parents: [{ sha: 'a' }] },              // keep (regular)
      { sha: 'c', parents: [{ sha: 'a' }, { sha: 'b' }] }, // exclude (merge)
      { sha: 'd', parents: [{ sha: 'b' }] },              // keep (regular)
    ];
    const result = filterMergeCommits(commits);
    assert.equal(result.length, 3);
    assert.ok(result.every((c) => c.sha !== 'c'), 'merge commit c should be excluded');
  });
});

// ---------------------------------------------------------------------------
// mapCommitData — pure mapping, handles null GitHub user
// ---------------------------------------------------------------------------

describe('mapCommitData', () => {
  const baseCommit = {
    sha: 'abc123',
    author: { login: 'octocat' },
    commit: {
      author: {
        name: 'The Octocat',
        email: 'octocat@github.com',
        date: '2026-04-07T10:00:00Z',
      },
    },
    parents: [{ sha: 'prev' }],
  };

  it('maps author.login from commit.author.login', () => {
    const result = mapCommitData(baseCommit);
    assert.equal(result.author.login, 'octocat');
  });

  it('maps name and email from commit.commit.author', () => {
    const result = mapCommitData(baseCommit);
    assert.equal(result.author.name, 'The Octocat');
    assert.equal(result.author.email, 'octocat@github.com');
  });

  it('maps sha correctly', () => {
    const result = mapCommitData(baseCommit);
    assert.equal(result.sha, 'abc123');
  });

  it('maps date correctly', () => {
    const result = mapCommitData(baseCommit);
    assert.equal(result.date, '2026-04-07T10:00:00Z');
  });

  it('returns login: null when commit.author is null (unlinked GitHub account)', () => {
    const commitWithNullAuthor = {
      ...baseCommit,
      author: null,
    };
    const result = mapCommitData(commitWithNullAuthor);
    assert.equal(result.author.login, null);
  });

  it('still maps name and email when commit.author is null', () => {
    const commitWithNullAuthor = {
      ...baseCommit,
      author: null,
    };
    const result = mapCommitData(commitWithNullAuthor);
    assert.equal(result.author.name, 'The Octocat');
    assert.equal(result.author.email, 'octocat@github.com');
  });
});

// ---------------------------------------------------------------------------
// listRepoCommits — structural check (no network)
// ---------------------------------------------------------------------------

describe('listRepoCommits', () => {
  it('is an exported async function', () => {
    assert.equal(typeof listRepoCommits, 'function');
  });

  it('returns a Promise when called', () => {
    // Set a fake token so it doesn't throw on token check
    const saved = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'fake-token-for-test';
    try {
      const result = listRepoCommits('org', 'repo', '2026-04-06', '2026-04-12');
      assert.ok(result instanceof Promise, 'listRepoCommits should return a Promise');
      result.catch(() => {}); // Prevent unhandled rejection
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
// getRateLimitInfo — pure rate-limit decision logic
// ---------------------------------------------------------------------------

describe('getRateLimitInfo', () => {
  it('returns shouldSleep: false when remaining is 11', () => {
    const info = getRateLimitInfo({ 'x-ratelimit-remaining': '11', 'x-ratelimit-reset': '9999999999' });
    assert.equal(info.shouldSleep, false);
    assert.equal(info.remaining, 11);
  });

  it('returns shouldSleep: true when remaining is 10 (boundary)', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 60; // 60s in the future
    const info = getRateLimitInfo({
      'x-ratelimit-remaining': '10',
      'x-ratelimit-reset': String(resetEpoch),
    });
    assert.equal(info.shouldSleep, true);
    assert.ok(info.sleepMs > 0, 'sleepMs should be positive for future reset');
  });

  it('returns shouldSleep: true when remaining is 0', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 30;
    const info = getRateLimitInfo({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(resetEpoch),
    });
    assert.equal(info.shouldSleep, true);
  });

  it('returns shouldSleep: false and remaining: null when headers absent', () => {
    const info = getRateLimitInfo({});
    assert.equal(info.shouldSleep, false);
    assert.equal(info.remaining, null);
  });

  it('sleepMs is positive when resetEpoch is in the future', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 120; // 2 minutes ahead
    const info = getRateLimitInfo({
      'x-ratelimit-remaining': '5',
      'x-ratelimit-reset': String(resetEpoch),
    });
    assert.ok(info.sleepMs > 0, `sleepMs should be positive, got ${info.sleepMs}`);
  });

  it('sleepMs is 0 (clamped) when resetEpoch is already in the past', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) - 60; // 1 minute ago
    const info = getRateLimitInfo({
      'x-ratelimit-remaining': '5',
      'x-ratelimit-reset': String(resetEpoch),
    });
    assert.equal(info.sleepMs, 0, 'sleepMs should be 0 for past reset epoch');
  });
});

// ---------------------------------------------------------------------------
// getCommitStats — structural check (no network)
// ---------------------------------------------------------------------------

describe('getCommitStats', () => {
  it('is an exported async function', () => {
    assert.equal(typeof getCommitStats, 'function');
  });
});

// ---------------------------------------------------------------------------
// aggregateStats — pure aggregation logic
// ---------------------------------------------------------------------------

describe('aggregateStats', () => {
  const makeCommit = (sha, login, email, name = 'Dev Name') => ({
    sha,
    author: { login, name, email },
    date: '2026-04-07T10:00:00Z',
  });

  const makeStats = (sha, additions, deletions) => ({ sha, additions, deletions });

  it('single author accumulates correctly — commits=1', () => {
    const commits = [makeCommit('a1', 'alice', 'alice@example.com')];
    const statsList = [makeStats('a1', 50, 10)];
    const result = aggregateStats(commits, statsList);

    assert.equal(result.size, 1);
    const entry = result.get('alice');
    assert.ok(entry, 'should have entry for alice');
    assert.equal(entry.commits, 1);
    assert.equal(entry.additions, 50);
    assert.equal(entry.deletions, 10);
  });

  it('two commits by same author accumulates — commits=2, stats summed', () => {
    const commits = [
      makeCommit('a1', 'alice', 'alice@example.com'),
      makeCommit('a2', 'alice', 'alice@example.com'),
    ];
    const statsList = [makeStats('a1', 30, 5), makeStats('a2', 20, 3)];
    const result = aggregateStats(commits, statsList);

    assert.equal(result.size, 1);
    const entry = result.get('alice');
    assert.equal(entry.commits, 2);
    assert.equal(entry.additions, 50);
    assert.equal(entry.deletions, 8);
  });

  it('two commits by different authors produce separate Map entries', () => {
    const commits = [
      makeCommit('a1', 'alice', 'alice@example.com'),
      makeCommit('b1', 'bob', 'bob@example.com'),
    ];
    const statsList = [makeStats('a1', 10, 2), makeStats('b1', 5, 1)];
    const result = aggregateStats(commits, statsList);

    assert.equal(result.size, 2);
    assert.ok(result.has('alice'), 'Map should have alice');
    assert.ok(result.has('bob'), 'Map should have bob');
  });

  it('null login uses email as Map key', () => {
    const commits = [makeCommit('c1', null, 'carol@example.com', 'Carol')];
    const statsList = [makeStats('c1', 15, 3)];
    const result = aggregateStats(commits, statsList);

    assert.equal(result.size, 1);
    assert.ok(result.has('carol@example.com'), 'Key should be email when login is null');
    const entry = result.get('carol@example.com');
    assert.equal(entry.commits, 1);
    assert.equal(entry.additions, 15);
    assert.equal(entry.deletions, 3);
  });

  it('empty commits array returns empty Map', () => {
    const result = aggregateStats([], []);
    assert.equal(result.size, 0);
    assert.ok(result instanceof Map, 'Should return a Map');
  });
});

// ---------------------------------------------------------------------------
// collectRepoStats — structural check (no network)
// ---------------------------------------------------------------------------

describe('collectRepoStats', () => {
  it('is an exported async function', () => {
    assert.equal(typeof collectRepoStats, 'function');
  });
});
