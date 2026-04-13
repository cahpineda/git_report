import { githubRequest, parseLinkHeader } from './github-client.js';

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the GitHub API path for listing commits in a date range.
 *
 * @param {string} org
 * @param {string} repo
 * @param {string} since - date string e.g. '2026-04-06'
 * @param {string} until - date string e.g. '2026-04-12'
 * @returns {string}
 */
export function buildCommitsPath(org, repo, since, until, branch = null) {
  const base = `/repos/${org}/${repo}/commits?since=${since}T00:00:00Z&until=${until}T23:59:59Z&per_page=100`;
  return branch ? `${base}&sha=${encodeURIComponent(branch)}` : base;
}

/**
 * Build the GitHub API path for listing branches of a repo.
 *
 * @param {string} org
 * @param {string} repo
 * @returns {string}
 */
export function buildBranchesPath(org, repo) {
  return `/repos/${org}/${repo}/branches?per_page=100`;
}

/**
 * Filter out merge commits (those with more than 1 parent).
 *
 * @param {Array} commits - Raw commit objects from GitHub API
 * @returns {Array}
 */
export function filterMergeCommits(commits) {
  return commits.filter((commit) => commit.parents.length <= 1);
}

/**
 * Map a raw GitHub commit object to a normalized shape.
 * Note: commit.author (top-level) is the GitHub user and may be null for
 * commits with unrecognized emails. commit.commit.author is always present.
 *
 * @param {object} commit - Raw GitHub API commit object
 * @returns {{ sha: string, author: { login: string|null, name: string, email: string }, date: string }}
 */
export function mapCommitData(commit) {
  return {
    sha: commit.sha,
    author: {
      login: commit.author?.login ?? null,
      name: commit.commit.author.name,
      email: commit.commit.author.email,
    },
    date: commit.commit.author.date,
  };
}

/**
 * Pure helper: extract rate-limit info from response headers without side effects.
 *
 * @param {object} headers - Response headers (Node.js lowercases all header names)
 * @returns {{ remaining: number|null, resetEpoch: number|null, shouldSleep: boolean, sleepMs: number }}
 */
export function getRateLimitInfo(headers) {
  const remainingStr = headers['x-ratelimit-remaining'];
  const resetStr = headers['x-ratelimit-reset'];

  if (remainingStr === undefined || remainingStr === null) {
    return { remaining: null, resetEpoch: null, shouldSleep: false, sleepMs: 0 };
  }

  const remaining = parseInt(remainingStr, 10);
  const resetEpoch = resetStr ? parseInt(resetStr, 10) : null;
  const shouldSleep = remaining <= 10;

  let sleepMs = 0;
  if (shouldSleep && resetEpoch !== null) {
    sleepMs = resetEpoch * 1000 - Date.now() + 1000;
    if (sleepMs < 0) sleepMs = 0;
  }

  return { remaining, resetEpoch, shouldSleep, sleepMs };
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/**
 * Sleep for a given number of milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check response headers for GitHub rate-limit; sleep if limit is low.
 *
 * @param {object} headers
 * @returns {Promise<void>}
 */
async function checkRateLimit(headers) {
  const { remaining, shouldSleep, sleepMs: duration } = getRateLimitInfo(headers);
  if (shouldSleep && duration > 0) {
    process.stderr.write(
      `Rate limit low (${remaining} remaining). Sleeping ${Math.ceil(duration / 1000)}s until reset...\n`
    );
    await sleepMs(duration);
  }
}

// ---------------------------------------------------------------------------
// Main exported functions
// ---------------------------------------------------------------------------

/**
 * Fetch all commits for a single repo in the given date range,
 * following pagination and excluding merge commits.
 *
 * @param {string} org
 * @param {string} repo
 * @param {string} since - date string e.g. '2026-04-06'
 * @param {string} until - date string e.g. '2026-04-12'
 * @returns {Promise<Array<{ sha: string, author: { login: string|null, name: string, email: string }, date: string }>>}
 */
/**
 * List all branches for a repo (paginated).
 *
 * @param {string} org
 * @param {string} repo
 * @returns {Promise<string[]>} Array of branch names
 */
export async function listRepoBranches(org, repo) {
  const branches = [];
  let nextPath = buildBranchesPath(org, repo);

  while (nextPath) {
    const { data, headers } = await githubRequest(nextPath);
    for (const b of data) branches.push(b.name);
    const links = parseLinkHeader(headers.link);
    nextPath = links.next ? (() => { const u = new URL(links.next); return u.pathname + u.search; })() : null;
  }

  return branches;
}

/**
 * Fetch commits for a single branch of a repo in the given date range.
 * Returns raw normalized commits (deduplication happens in listAllRepoCommits).
 *
 * @param {string} org
 * @param {string} repo
 * @param {string} since
 * @param {string} until
 * @param {string|null} branch - null = default branch
 * @returns {Promise<Array>}
 */
export async function listRepoCommits(org, repo, since, until, branch = null) {
  const allCommits = [];
  let nextPath = buildCommitsPath(org, repo, since, until, branch);
  let page = 1;

  while (nextPath) {
    process.stderr.write(`Fetching commits for ${org}/${repo}${branch ? `@${branch}` : ''} page ${page}...\n`);

    const { data, headers } = await githubRequest(nextPath);
    allCommits.push(...data);

    const links = parseLinkHeader(headers.link);
    if (links.next) {
      const url = new URL(links.next);
      nextPath = url.pathname + url.search;
      page++;
    } else {
      nextPath = null;
    }
  }

  return filterMergeCommits(allCommits).map(mapCommitData);
}

/**
 * Fetch all commits across ALL branches for a repo, deduplicated by SHA.
 * This ensures commits on non-default branches are included in the report.
 *
 * @param {string} org
 * @param {string} repo
 * @param {string} since
 * @param {string} until
 * @returns {Promise<Array>}
 */
export async function listAllRepoCommits(org, repo, since, until) {
  const branches = await listRepoBranches(org, repo);
  const seen = new Set();
  const allCommits = [];

  for (const branch of branches) {
    const commits = await listRepoCommits(org, repo, since, until, branch);
    for (const commit of commits) {
      if (!seen.has(commit.sha)) {
        seen.add(commit.sha);
        allCommits.push(commit);
      }
    }
  }

  return allCommits;
}

/**
 * Fetch stats (additions/deletions) for a single commit.
 * Checks rate limit after the request and sleeps if needed.
 *
 * @param {string} org
 * @param {string} repo
 * @param {string} sha
 * @returns {Promise<{ sha: string, additions: number, deletions: number }>}
 */
export async function getCommitStats(org, repo, sha) {
  const { data, headers } = await githubRequest(`/repos/${org}/${repo}/commits/${sha}`);
  await checkRateLimit(headers);
  return {
    sha,
    additions: data.stats?.additions ?? 0,
    deletions: data.stats?.deletions ?? 0,
  };
}

/**
 * Aggregate per-commit stats into a per-developer Map.
 *
 * @param {Array} commits - Output from listRepoCommits
 * @param {Array<{ sha: string, additions: number, deletions: number }>} statsList
 * @returns {Map<string, { name: string, email: string, commits: number, additions: number, deletions: number }>}
 */
export function aggregateStats(commits, statsList) {
  const result = new Map();

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const stats = statsList[i];

    // Key: GitHub login if present, otherwise git email
    const key = commit.author.login !== null ? commit.author.login : commit.author.email;

    if (!result.has(key)) {
      result.set(key, {
        name: commit.author.name,
        email: commit.author.email,
        commits: 0,
        additions: 0,
        deletions: 0,
      });
    }

    const entry = result.get(key);
    entry.commits += 1;
    entry.additions += stats.additions;
    entry.deletions += stats.deletions;
    // Update name/email to last-seen (fine for display)
    entry.name = commit.author.name;
    entry.email = commit.author.email;
  }

  return result;
}

/**
 * Collect and aggregate per-developer commit stats for a repository.
 *
 * @param {string} org
 * @param {string} repo
 * @param {string} since
 * @param {string} until
 * @returns {Promise<Map<string, { name: string, email: string, commits: number, additions: number, deletions: number }>>}
 */
export async function collectRepoStats(org, repo, since, until) {
  const commits = await listAllRepoCommits(org, repo, since, until);

  if (commits.length === 0) {
    return new Map();
  }

  const statsList = [];
  for (let i = 0; i < commits.length; i++) {
    if ((i + 1) % 10 === 0 || i === 0) {
      process.stderr.write(`Fetching stats for ${org}/${repo}: ${i + 1}/${commits.length}...\n`);
    }
    const stats = await getCommitStats(org, repo, commits[i].sha);
    statsList.push(stats);
  }

  return aggregateStats(commits, statsList);
}
