/**
 * Format a developer's display name from a statsMap entry.
 *
 * @param {string} key - Map key (login or email)
 * @param {{ name: string, email: string }} entry
 * @returns {string}
 */
function formatAuthor(key, entry) {
  // If the key looks like an email (contains @), login was null — use name <email>
  if (key.includes('@')) {
    return `${entry.name} <${entry.email}>`;
  }
  // key is a GitHub login
  return `${entry.name} (${key})`;
}

/**
 * Build a Markdown table from a sorted array of [key, entry] pairs.
 *
 * @param {Array<[string, { name: string, email: string, commits: number, additions: number, deletions: number }]>} sorted
 * @returns {string}
 */
function buildTable(sorted) {
  const header = `| Developer | Commits | Lines Added | Lines Deleted |\n|-----------|---------|-------------|---------------|`;
  const rows = sorted.map(([key, entry]) => {
    const author = formatAuthor(key, entry);
    return `| ${author} | ${entry.commits} | ${entry.additions} | ${entry.deletions} |`;
  });
  return header + '\n' + rows.join('\n');
}

/**
 * Format a Markdown section for one repository.
 *
 * @param {string} repoName - Full repo name, e.g. "inkaviation/my-repo"
 * @param {Map<string, { name: string, email: string, commits: number, additions: number, deletions: number }>} statsMap
 * @returns {string}
 */
export function formatRepoSection(repoName, statsMap) {
  if (statsMap.size === 0) {
    return `### ${repoName}\n\n_No commits in this period._\n`;
  }

  // Sort by commits descending
  const sorted = [...statsMap.entries()].sort((a, b) => b[1].commits - a[1].commits);

  return `### ${repoName}\n\n${buildTable(sorted)}\n`;
}

/**
 * Format a global summary table across all repositories.
 *
 * @param {Map<string, { name: string, email: string, commits: number, additions: number, deletions: number }>} allStats
 * @returns {string}
 */
export function formatGlobalSummary(allStats) {
  if (allStats.size === 0) {
    return `## Global Summary — All Repositories\n\n_No commits found in this period._\n`;
  }

  // Sort by commits descending
  const sorted = [...allStats.entries()].sort((a, b) => b[1].commits - a[1].commits);

  return `## Global Summary — All Repositories\n\n${buildTable(sorted)}\n`;
}
