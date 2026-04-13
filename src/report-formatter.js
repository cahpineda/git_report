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
 * Returns a warning marker if the entry has unreliable stats or suspiciously low lines.
 * - `[!]` = GitHub returned zero stats after all retries (data missing)
 * - `[?]` = zero total lines but has commits (suspicious, may be binary-only or missed)
 *
 * @param {{ commits: number, additions: number, deletions: number, unreliableCommits?: string[] }} entry
 * @returns {string}
 */
function statsWarning(entry) {
  const unreliable = entry.unreliableCommits?.length > 0;
  const zeroLines = entry.additions === 0 && entry.deletions === 0 && entry.commits > 0;
  if (unreliable) return ' `[!]`';
  if (zeroLines) return ' `[?]`';
  return '';
}

/**
 * Build a Markdown table from a sorted array of [key, entry] pairs.
 *
 * @param {Array<[string, { name: string, email: string, commits: number, additions: number, deletions: number, unreliableCommits?: string[] }]>} sorted
 * @returns {string}
 */
function buildTable(sorted) {
  const header = `| Developer | Commits | Lines Added | Lines Deleted |\n|-----------|---------|-------------|---------------|`;
  const rows = sorted.map(([key, entry]) => {
    const author = formatAuthor(key, entry);
    const warn = statsWarning(entry);
    return `| ${author}${warn} | ${entry.commits} | ${entry.additions} | ${entry.deletions} |`;
  });
  return header + '\n' + rows.join('\n');
}

/**
 * Build a warning block listing entries with unreliable or suspicious stats.
 *
 * @param {Array<[string, { name: string, email: string, commits: number, additions: number, deletions: number, unreliableCommits?: string[] }]>} sorted
 * @returns {string}
 */
function buildWarnings(sorted) {
  const warnings = [];

  for (const [key, entry] of sorted) {
    const unreliable = entry.unreliableCommits ?? [];
    const zeroLines = entry.additions === 0 && entry.deletions === 0 && entry.commits > 0;

    if (unreliable.length > 0) {
      const author = formatAuthor(key, entry);
      warnings.push(
        `- **${author}**: ${unreliable.length} commit(s) returned zero stats from GitHub API after retries — line counts may be incomplete. SHAs: ${unreliable.map((s) => s.slice(0, 7)).join(', ')}`
      );
    } else if (zeroLines) {
      const author = formatAuthor(key, entry);
      warnings.push(
        `- **${author}**: ${entry.commits} commit(s) but 0 lines changed — may be binary-only files or a GitHub stats delay.`
      );
    }
  }

  if (warnings.length === 0) return '';
  return `\n> **Data quality warnings** — verify these entries manually:\n>\n${warnings.map((w) => `> ${w}`).join('\n')}\n`;
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

  return `### ${repoName}\n\n${buildTable(sorted)}${buildWarnings(sorted)}\n`;
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

  return `## Global Summary — All Repositories\n\n${buildTable(sorted)}${buildWarnings(sorted)}\n`;
}
