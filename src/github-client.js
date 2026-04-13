import https from 'node:https';

/**
 * Parse GitHub Link header into an object of rel => url.
 * Returns {} for null/undefined input.
 *
 * Example input: '<https://api.github.com/orgs/foo/repos?page=2>; rel="next", <https://api.github.com/orgs/foo/repos?page=5>; rel="last"'
 * Returns: { next: 'https://...', last: 'https://...' }
 *
 * @param {string|null|undefined} linkHeader
 * @returns {Record<string, string>}
 */
export function parseLinkHeader(linkHeader) {
  if (!linkHeader) return {};

  const result = {};
  const parts = linkHeader.split(',');

  for (const part of parts) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
    if (match) {
      const url = match[1];
      const rel = match[2];
      result[rel] = url;
    }
  }

  return result;
}

/**
 * Make a single raw HTTPS GET request to api.github.com.
 * Returns { statusCode, headers, body } regardless of status.
 *
 * @param {string} path
 * @param {string} token
 * @returns {Promise<{ statusCode: number, headers: object, body: string }>}
 */
function rawRequest(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path,
        method: 'GET',
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'github-activity-report',
          Accept: 'application/vnd.github+json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', (err) => reject(new Error(`Network error requesting ${path}: ${err.message}`)));
    req.end();
  });
}

/**
 * Make an authenticated HTTPS GET request to api.github.com.
 * Automatically sleeps and retries on 403/429 rate-limit responses.
 *
 * Reads GITHUB_TOKEN from environment — throws if missing.
 *
 * @param {string} path - API path, e.g. '/orgs/inkaviation/repos?per_page=100'
 * @returns {Promise<{ data: any, headers: object }>}
 */
export async function githubRequest(path) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { statusCode, headers, body } = await rawRequest(path, token);

    if (statusCode >= 200 && statusCode < 300) {
      try {
        const data = JSON.parse(body);
        return { data, headers };
      } catch (err) {
        throw new Error(`Failed to parse JSON response from ${path}: ${err.message}`);
      }
    }

    // Rate limit: 403 or 429 — sleep until reset then retry
    if (statusCode === 403 || statusCode === 429) {
      const resetStr = headers['x-ratelimit-reset'] || headers['retry-after'];
      let sleepMs = 60_000; // default: wait 60s if no header present

      if (resetStr) {
        const resetEpoch = parseInt(resetStr, 10);
        if (resetEpoch > 1_000_000_000) {
          // Unix epoch seconds (x-ratelimit-reset)
          sleepMs = Math.max(0, resetEpoch * 1000 - Date.now()) + 2000;
        } else {
          // Seconds to wait (retry-after)
          sleepMs = resetEpoch * 1000 + 2000;
        }
      }

      const waitSec = Math.ceil(sleepMs / 1000);
      process.stderr.write(
        `Rate limit hit (HTTP ${statusCode}). Waiting ${waitSec}s until reset...\n`
      );
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      continue; // retry same request
    }

    throw new Error(`GitHub API error ${statusCode} for ${path}: ${body}`);
  }
}

/**
 * List all repositories for a GitHub org, following pagination automatically.
 *
 * @param {string} org - GitHub org name, e.g. 'inkaviation'
 * @returns {Promise<Array>} Flat array of all repo objects
 */
export async function listOrgRepos(org) {
  const allRepos = [];
  let page = 1;
  let nextPath = `/orgs/${org}/repos?per_page=100&type=all`;

  while (nextPath) {
    process.stderr.write(`Fetching repos page ${page}...\n`);

    const { data, headers } = await githubRequest(nextPath);
    allRepos.push(...data);

    const links = parseLinkHeader(headers.link);
    if (links.next) {
      // Link header returns absolute URLs — extract path+search
      const url = new URL(links.next);
      nextPath = url.pathname + url.search;
      page++;
    } else {
      nextPath = null;
    }
  }

  return allRepos;
}
