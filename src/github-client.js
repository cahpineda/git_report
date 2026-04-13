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
 * Make an authenticated HTTPS GET request to api.github.com.
 *
 * Reads GITHUB_TOKEN from environment — throws if missing.
 *
 * @param {string} path - API path, e.g. '/orgs/inkaviation/repos?per_page=100'
 * @param {object} [options={}] - Additional options (reserved for future use)
 * @returns {Promise<{ data: any, headers: object }>}
 */
export function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required');
  }

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'github-activity-report',
        Accept: 'application/vnd.github+json',
      },
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        const { statusCode, headers } = res;

        if (statusCode >= 200 && statusCode < 300) {
          try {
            const data = JSON.parse(body);
            resolve({ data, headers });
          } catch (err) {
            reject(new Error(`Failed to parse JSON response from ${path}: ${err.message}`));
          }
        } else {
          reject(new Error(`GitHub API error ${statusCode} for ${path}: ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Network error requesting ${path}: ${err.message}`));
    });

    req.end();
  });
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
