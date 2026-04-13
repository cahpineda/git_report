import fs from 'node:fs';
import { config } from './src/config.js';
import { listOrgRepos } from './src/github-client.js';
import { collectRepoStats } from './src/data-collector.js';
import { formatRepoSection, formatGlobalSummary } from './src/report-formatter.js';

// ---------------------------------------------------------------------------
// Resume helpers
// ---------------------------------------------------------------------------

/**
 * Parse a "Developer" cell back to { key, name, email }.
 * Handles two formats produced by formatAuthor():
 *   "Name (login)"        → key = login
 *   "Name <email>"        → key = email
 *
 * @param {string} cell
 * @returns {{ key: string, name: string, email: string }|null}
 */
function parseAuthorCell(cell) {
  const t = cell.trim();
  const loginMatch = t.match(/^(.+)\s+\(([^)]+)\)$/);
  if (loginMatch) return { key: loginMatch[2].trim(), name: loginMatch[1].trim(), email: '' };
  const emailMatch = t.match(/^(.+)\s+<([^>]+)>$/);
  if (emailMatch) return { key: emailMatch[2].trim(), name: emailMatch[1].trim(), email: emailMatch[2].trim() };
  return null;
}

/**
 * Parse an existing (possibly incomplete) report file.
 *
 * Returns:
 *   alreadyDone  — Set of repo full names already written (e.g. "inkaviation/my-repo")
 *   globalStats  — Map reconstructed from all per-repo tables in the file
 *
 * Skips the "## Global Summary" section so we don't double-count.
 *
 * @param {string} filePath
 * @returns {{ alreadyDone: Set<string>, globalStats: Map<string,object> }}
 */
function parseExistingReport(filePath) {
  const alreadyDone = new Set();
  const globalStats = new Map();

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { alreadyDone, globalStats };
  }

  let inTable = false;
  let inGlobalSummary = false;

  for (const line of content.split('\n')) {
    // Repo section heading: "### org/repo"
    const repoHeading = line.match(/^### (.+\/.+)$/);
    if (repoHeading) {
      alreadyDone.add(repoHeading[1].trim());
      inTable = false;
      inGlobalSummary = false;
      continue;
    }

    // Global summary heading — stop counting rows into globalStats here
    if (line.startsWith('## Global Summary')) {
      inGlobalSummary = true;
      inTable = false;
      continue;
    }

    // Table header row
    if (!inGlobalSummary && line.startsWith('| Developer |')) {
      inTable = true;
      continue;
    }

    // Separator row (|---|...)
    if (line.match(/^\|[-| ]+\|$/)) {
      continue;
    }

    // Data row inside a per-repo table
    if (!inGlobalSummary && inTable && line.startsWith('|')) {
      const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cols.length === 4) {
        const authorInfo = parseAuthorCell(cols[0]);
        const commits = parseInt(cols[1], 10);
        const additions = parseInt(cols[2], 10);
        const deletions = parseInt(cols[3], 10);
        if (authorInfo && !isNaN(commits)) {
          const { key, name, email } = authorInfo;
          if (globalStats.has(key)) {
            const e = globalStats.get(key);
            e.commits += commits;
            e.additions += additions;
            e.deletions += deletions;
          } else {
            globalStats.set(key, { name, email, commits, additions, deletions });
          }
        }
      }
      continue;
    }

    // Any non-table line resets inTable
    if (!line.startsWith('|')) {
      inTable = false;
    }
  }

  return { alreadyDone, globalStats };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  try {
    const { githubOrg, sinceDate, untilDate } = config;

    // Output file path passed as first CLI argument (set by run-report.sh)
    const outputPath = process.argv[2];
    if (!outputPath) {
      process.stderr.write('Usage: node report.js <output-file>\n');
      process.exit(1);
    }

    // Parse existing report to determine resume state
    const { alreadyDone, globalStats } = parseExistingReport(outputPath);
    const isResume = alreadyDone.size > 0;

    if (isResume) {
      process.stderr.write(
        `Resuming — ${alreadyDone.size} repo(s) already written, skipping them.\n`
      );
    }

    // Open file: append when resuming, create/overwrite on fresh start
    const outFd = fs.openSync(outputPath, isResume ? 'a' : 'w');
    const write = (str) => fs.writeSync(outFd, str);

    // Print header only on fresh start
    if (!isResume) {
      const now = new Date().toISOString();
      write(`# GitHub Activity Report — ${githubOrg}\n`);
      write(`Period: ${sinceDate} → ${untilDate}\n`);
      write(`Generated: ${now}\n\n`);
    }

    // List all org repos
    const repos = await listOrgRepos(githubOrg);

    let reposWithActivity = alreadyDone.size; // already-written repos all had activity

    // Process each repo sequentially
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];

      if (alreadyDone.has(repo.full_name)) {
        process.stderr.write(`[SKIP] ${repo.full_name}\n`);
        continue;
      }

      process.stderr.write(`Processing repo ${i + 1}/${repos.length}: ${repo.name}\n`);

      const repoStatsMap = await collectRepoStats(githubOrg, repo.name, sinceDate, untilDate);

      if (repoStatsMap.size === 0) {
        continue;
      }

      reposWithActivity++;

      // Merge into globalStats (includes already-parsed stats from resume)
      for (const [key, entry] of repoStatsMap) {
        if (globalStats.has(key)) {
          const g = globalStats.get(key);
          g.commits += entry.commits;
          g.additions += entry.additions;
          g.deletions += entry.deletions;
          g.name = entry.name;
          g.email = entry.email;
        } else {
          globalStats.set(key, { ...entry });
        }
      }

      write(formatRepoSection(repo.full_name, repoStatsMap));
      write('\n');
    }

    // Write global summary (reflects all repos — existing + newly processed)
    write(formatGlobalSummary(globalStats));
    write('\n');

    // Footer
    write(
      `---\nTotal repositories scanned: ${repos.length} | Repositories with activity: ${reposWithActivity}\n`
    );

    fs.closeSync(outFd);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
})();
