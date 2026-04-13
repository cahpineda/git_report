import { config } from './src/config.js';
import { listOrgRepos } from './src/github-client.js';
import { collectRepoStats } from './src/data-collector.js';
import { formatRepoSection, formatGlobalSummary } from './src/report-formatter.js';

(async () => {
  try {
    const { githubOrg, sinceDate, untilDate } = config;

    // 1. Print header
    const now = new Date().toISOString();
    process.stdout.write(`# GitHub Activity Report — ${githubOrg}\n`);
    process.stdout.write(`Period: ${sinceDate} → ${untilDate}\n`);
    process.stdout.write(`Generated: ${now}\n\n`);

    // 2. List all org repos
    const repos = await listOrgRepos(githubOrg);

    // 3. Initialize global stats map
    /** @type {Map<string, { name: string, email: string, commits: number, additions: number, deletions: number }>} */
    const globalStats = new Map();

    let reposWithActivity = 0;

    // 4. Process each repo sequentially
    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i];
      process.stderr.write(`Processing repo ${i + 1}/${repos.length}: ${repo.name}\n`);

      const repoStatsMap = await collectRepoStats(githubOrg, repo.name, sinceDate, untilDate);

      // Skip repos with 0 commits
      if (repoStatsMap.size === 0) {
        continue;
      }

      reposWithActivity++;

      // Merge repoStatsMap into globalStats
      for (const [key, entry] of repoStatsMap) {
        if (globalStats.has(key)) {
          const global = globalStats.get(key);
          global.commits += entry.commits;
          global.additions += entry.additions;
          global.deletions += entry.deletions;
          // Keep latest name/email
          global.name = entry.name;
          global.email = entry.email;
        } else {
          globalStats.set(key, { ...entry });
        }
      }

      // Output per-repo section
      process.stdout.write(formatRepoSection(repo.full_name, repoStatsMap));
      process.stdout.write('\n');
    }

    // 5. Output global summary
    process.stdout.write(formatGlobalSummary(globalStats));
    process.stdout.write('\n');

    // 6. Print footer
    process.stdout.write(`---\nTotal repositories scanned: ${repos.length} | Repositories with activity: ${reposWithActivity}\n`);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
})();
