import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatRepoSection, formatGlobalSummary } from './report-formatter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a stats Map entry.
 */
function makeEntry(name, email, commits, additions, deletions) {
  return { name, email, commits, additions, deletions };
}

// ---------------------------------------------------------------------------
// formatRepoSection
// ---------------------------------------------------------------------------

describe('formatRepoSection', () => {
  it('non-empty map produces correct Markdown table', () => {
    const statsMap = new Map([
      ['alice', makeEntry('Alice Smith', 'alice@example.com', 5, 120, 30)],
    ]);
    const result = formatRepoSection('inkaviation/my-repo', statsMap);

    assert.ok(result.includes('### inkaviation/my-repo'), 'should include heading');
    assert.ok(result.includes('| Developer | Commits | Lines Added | Lines Deleted |'), 'should include table header');
    assert.ok(result.includes('Alice Smith (alice)'), 'should include author with login');
    assert.ok(result.includes('| 5 |'), 'should include commit count');
    assert.ok(result.includes('| 120 |'), 'should include additions');
    assert.ok(result.includes('| 30 |'), 'should include deletions');
  });

  it('empty map produces "No commits" message', () => {
    const result = formatRepoSection('inkaviation/quiet-repo', new Map());

    assert.ok(result.includes('### inkaviation/quiet-repo'), 'should include heading');
    assert.ok(result.includes('_No commits in this period._'), 'should include no-commits message');
    assert.ok(!result.includes('| Developer |'), 'should not include table when empty');
  });

  it('rows are sorted by commits descending', () => {
    const statsMap = new Map([
      ['charlie', makeEntry('Charlie', 'charlie@example.com', 2, 40, 10)],
      ['alice', makeEntry('Alice', 'alice@example.com', 10, 200, 50)],
      ['bob', makeEntry('Bob', 'bob@example.com', 5, 80, 20)],
    ]);
    const result = formatRepoSection('inkaviation/busy-repo', statsMap);

    const aliceIdx = result.indexOf('Alice');
    const bobIdx = result.indexOf('Bob');
    const charlieIdx = result.indexOf('Charlie');

    assert.ok(aliceIdx < bobIdx, 'Alice (10 commits) should appear before Bob (5 commits)');
    assert.ok(bobIdx < charlieIdx, 'Bob (5 commits) should appear before Charlie (2 commits)');
  });

  it('null login uses "name <email>" format instead of "(login)"', () => {
    // When key contains '@', it was stored as email (login was null)
    const statsMap = new Map([
      ['dana@example.com', makeEntry('Dana Doe', 'dana@example.com', 3, 60, 15)],
    ]);
    const result = formatRepoSection('inkaviation/repo', statsMap);

    assert.ok(result.includes('Dana Doe <dana@example.com>'), 'should use name <email> when login is null');
    assert.ok(!result.includes('Dana Doe ('), 'should not use (login) format when login is null');
  });
});

// ---------------------------------------------------------------------------
// formatGlobalSummary
// ---------------------------------------------------------------------------

describe('formatGlobalSummary', () => {
  it('produces correct header and sorted rows', () => {
    const allStats = new Map([
      ['bob', makeEntry('Bob Builder', 'bob@example.com', 7, 150, 40)],
      ['alice', makeEntry('Alice Coder', 'alice@example.com', 42, 980, 201)],
    ]);
    const result = formatGlobalSummary(allStats);

    assert.ok(result.includes('## Global Summary — All Repositories'), 'should include global summary heading');
    assert.ok(result.includes('| Developer | Commits | Lines Added | Lines Deleted |'), 'should include table header');

    // Alice (42 commits) should come before Bob (7 commits)
    const aliceIdx = result.indexOf('Alice Coder');
    const bobIdx = result.indexOf('Bob Builder');
    assert.ok(aliceIdx < bobIdx, 'Alice (42 commits) should appear before Bob (7 commits)');

    assert.ok(result.includes('| 42 |'), 'should include alice commit count');
    assert.ok(result.includes('| 980 |'), 'should include alice additions');
  });

  it('empty map produces "No commits found" message', () => {
    const result = formatGlobalSummary(new Map());

    assert.ok(result.includes('## Global Summary — All Repositories'), 'should include heading');
    assert.ok(result.includes('_No commits found in this period._'), 'should include no-commits message');
    assert.ok(!result.includes('| Developer |'), 'should not include table when empty');
  });
});
