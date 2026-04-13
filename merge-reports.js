/**
 * merge-reports.js
 *
 * Consolidates two reports for the period 2026-04-06 → 2026-04-12:
 *   1. CSV  — Ink/AI agent usage (cost, tokens, tickets)
 *   2. MD   — GitHub git activity (commits, lines +/-)
 *
 * Output: reports/consolidated-2026-04-06_2026-04-12.md
 *
 * Usage: node merge-reports.js
 */

import fs from 'node:fs';

const CSV_PATH = 'reports/report_2026-04-06_2026-04-12.csv';
const MD_PATH  = 'reports/report-2026-04-13.md';
const OUT_PATH = 'reports/consolidated-2026-04-06_2026-04-12.md';

// ---------------------------------------------------------------------------
// Identity map: MD key (GitHub login or email) → canonical corporate email
// ---------------------------------------------------------------------------
const MD_KEY_TO_EMAIL = {
  // GitHub login → corporate email
  'cahpineda':             'carlos.hurtado@inkaviation.com',
  'AlejandroVelascoInk':   'alejandro.velasco@inkaviation.com',
  'warles28':              'warles.rivera@inkaviation.com',
  'MarcelaTrujilloToro10': 'marcela.trujillo@inkaviation.com',
  'DRodriguez322':         'diego.rodriguez@inkaviation.com',
  'asalmerontapia':        'alberto.salmeron@inkaviation.com',
  'Mauricio-Aguirre0':     'mauricio.aguirre@inkaviation.com',
  'damiandonat-ink':       'damian.donat@inkaviation.com',
  'michaelpineda-ink':     'michael.pineda@inkaviation.com',
  'salocin0430':           'nicolas.ruiz@inkaviation.com',
  'anonimotellez':         'neider.tellez@inkaviation.com',
  'alejandrovt':           'alejando.villada@inkaviation.com',
  'mateofullstack':        'mateo.tobon@inkaviation.com',
  'jaimincho':             'jaime.alvarez@inkaviation.com',
  'juan-jv1699':           'juan.valencia@inkaviation.com',
  'francisco-garcia-ink':  'francisco.garcia@inkaviation.com',
  'fabian447':             'fabian.lopez@inkaviation.com',
  'marioandresmiranda':    'mario.miranda@inkaviation.com',
  'andresgutierreza':      'andres.gutierrez@inkaviation.com',
  'JSebas95':              'sebastian.sanchez@inkaviation.com',
  'Jsmorales1415':         'jhon.morales@inkaviation.com',
  'fjamezcua96':           'francisco.amezcua@inkaviation.com',
  'cristian-ramirez-b':    'cristian.ramirez@inkaviation.com',
  'AldemarHdez':           'aldemar.hernandez@inkaviation.com',
  'AlejandroVelascoInk':   'alejandro.velasco@inkaviation.com',
  // GitHub email → corporate email
  'cesar.soto@inkaviation.com':         'cesar.soto@inkaviation.com',
  'agustin.boleda@inkaviation.com':     'agustin.boleda@inkaviation.com',
  'oscar.sanchez@inkaviation.com':      'oscar.sanchez@inkaviation.com',
  'alejandro.villada@gmail.com':        'alejando.villada@inkaviation.com',
  'juacanlopez12318@gmail.com':         'juan.lopez@inkaviation.com',
  'nikola.cvetanovic@inkaviaton.com':   'nikola.cvetanovic@inkaviation.com',
};

// Display name overrides: corporate email → proper display name
// Used when the git commit name is just a username (no full name in git config)
const NAME_OVERRIDES = {
  'cesar.soto@inkaviation.com':        'Cesar Soto',
  'warles.rivera@inkaviation.com':     'Warles Rivera',
  'fabian.lopez@inkaviation.com':      'Fabián López',
  'andres.gutierrez@inkaviation.com':  'Andrés Gutiérrez',
  'neider.tellez@inkaviation.com':     'Neider Téllez',
  'juan.valencia@inkaviation.com':     'Juan Valencia',
  'mateo.tobon@inkaviation.com':       'Mateo Tobón',
  'aldemar.hernandez@inkaviation.com': 'Aldemar Hernández',
  'jhon.morales@inkaviation.com':      'Jhon Morales',
  'sebastian.sanchez@inkaviation.com': 'Sebastian Sánchez',
  'diego.rodriguez@inkaviation.com':   'Diego Rodríguez',
  'alejandro.velasco@inkaviation.com': 'Alejandro Velasco',
  'alejando.villada@inkaviation.com':  'Alejandro Villada',
  'oscar.sanchez@inkaviation.com':     'Óscar Sánchez',
  'francisco.garcia@inkaviation.com':  'Francisco García',
};

// Bots / service accounts to exclude from the output
const BOTS = new Set([
  'dependabot[bot]',
  'gh-terraform-admin[bot]',
  'Semgrep Autofix',
  'autofix@semgrep.com',
  'Terraform User',
  'DEVOPS@inkaviation.com',
  'litellm',
  'claude_code_key_nikola.cvetanovic_wzwp',
]);

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields with embedded commas)
// ---------------------------------------------------------------------------
function parseCSVLine(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else { cur += c; }
  }
  fields.push(cur);
  return fields;
}

function loadCSV(path) {
  const lines = fs.readFileSync(path, 'utf8')
    .replace(/^\uFEFF/, '') // strip BOM
    .split('\n')
    .filter((l) => l.trim());

  return lines.slice(1).map((line) => {
    const [email, cost, commits, tickets, , toolsCount, , , inputTok, outputTok, cacheRead, cacheCreate] =
      parseCSVLine(line);
    const totalTokens =
      (parseInt(inputTok) || 0) +
      (parseInt(outputTok) || 0) +
      (parseInt(cacheRead) || 0) +
      (parseInt(cacheCreate) || 0);
    return {
      email: email.trim(),
      cost: parseFloat(cost) || 0,
      aiCommits: parseInt(commits) || 0,
      tickets: tickets.trim(),
      toolsCount: parseInt(toolsCount) || 0,
      totalTokens,
    };
  });
}

// ---------------------------------------------------------------------------
// MD global summary parser
// ---------------------------------------------------------------------------
function parseAuthorCell(cell) {
  const t = cell.trim();
  const loginMatch = t.match(/^(.+)\s+\(([^)]+)\)$/);
  if (loginMatch) return { name: loginMatch[1].trim(), key: loginMatch[2].trim() };
  const emailMatch = t.match(/^(.+)\s+<([^>]+)>$/);
  if (emailMatch) return { name: emailMatch[1].trim(), key: emailMatch[2].trim() };
  return { name: t, key: t };
}

function loadMDSummary(path) {
  const lines = fs.readFileSync(path, 'utf8').split('\n');
  const result = new Map(); // corporate email → { name, gitCommits, additions, deletions }

  let inSummary = false;
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith('## Global Summary')) { inSummary = true; continue; }
    if (!inSummary) continue;
    if (line.startsWith('---')) break; // footer

    if (line.startsWith('| Developer |')) { inTable = true; continue; }
    if (line.match(/^\|[-| ]+\|$/)) continue;

    if (inTable && line.startsWith('|')) {
      const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cols.length !== 4) continue;

      const { name, key } = parseAuthorCell(cols[0]);
      const gitCommits = parseInt(cols[1]) || 0;
      const additions  = parseInt(cols[2]) || 0;
      const deletions  = parseInt(cols[3]) || 0;

      // Skip bots
      if (BOTS.has(key) || BOTS.has(name)) continue;

      const corpEmail = MD_KEY_TO_EMAIL[key];
      if (!corpEmail) {
        process.stderr.write(`[WARN] No email mapping for MD key: "${key}" (${name})\n`);
        continue;
      }

      // Merge (same person may appear with login + email in the MD)
      if (result.has(corpEmail)) {
        const e = result.get(corpEmail);
        e.gitCommits += gitCommits;
        e.additions  += additions;
        e.deletions  += deletions;
      } else {
        result.set(corpEmail, { name, gitCommits, additions, deletions });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Consolidate
// ---------------------------------------------------------------------------
function consolidate(csvRows, mdMap) {
  // canonical email → merged record
  const merged = new Map();

  // Seed from CSV (all users who used the AI tool)
  for (const row of csvRows) {
    if (BOTS.has(row.email)) continue;
    merged.set(row.email, {
      email: row.email,
      displayName: row.email.split('@')[0].replace('.', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      cost: row.cost,
      aiCommits: row.aiCommits,
      tickets: row.tickets,
      toolsCount: row.toolsCount,
      totalTokens: row.totalTokens,
      gitCommits: 0,
      additions: 0,
      deletions: 0,
    });
  }

  // Merge git stats from MD
  for (const [email, gitData] of mdMap) {
    if (merged.has(email)) {
      const r = merged.get(email);
      r.gitCommits = gitData.gitCommits;
      r.additions  = gitData.additions;
      r.deletions  = gitData.deletions;
      // Use git name, but prefer override if available
      r.displayName = NAME_OVERRIDES[email] || gitData.name;
    } else {
      // Git user not in CSV (no AI tool usage recorded)
      merged.set(email, {
        email,
        displayName: NAME_OVERRIDES[email] || gitData.name,
        cost: 0,
        aiCommits: 0,
        tickets: '',
        toolsCount: 0,
        totalTokens: 0,
        gitCommits: gitData.gitCommits,
        additions: gitData.additions,
        deletions: gitData.deletions,
      });
    }
  }

  return [...merged.values()].sort((a, b) => b.cost - a.cost || b.gitCommits - a.gitCommits);
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------
function fmt(n) { return n.toLocaleString('en-US'); }
function fmtCost(n) { return n > 0 ? `$${n.toFixed(2)}` : '-'; }
function fmtTokens(n) { return n > 0 ? `${(n / 1_000_000).toFixed(1)}M` : '-'; }

function buildMD(rows) {
  const totalCost     = rows.reduce((s, r) => s + r.cost, 0);
  const totalGitC     = rows.reduce((s, r) => s + r.gitCommits, 0);
  const totalAdd      = rows.reduce((s, r) => s + r.additions, 0);
  const totalDel      = rows.reduce((s, r) => s + r.deletions, 0);
  const totalAiC      = rows.reduce((s, r) => s + r.aiCommits, 0);
  const totalTokens   = rows.reduce((s, r) => s + r.totalTokens, 0);

  const lines = [
    '# Informe Consolidado — inkaviation',
    'Período: 2026-04-06 → 2026-04-12',
    `Generado: ${new Date().toISOString()}`,
    '',
    '## Resumen por Recurso',
    '',
    '| Recurso | Git Commits | Líneas + | Líneas - | Commits IA | Costo IA | Tokens | Tickets |',
    '|---------|-------------|----------|----------|------------|----------|--------|---------|',
  ];

  for (const r of rows) {
    lines.push(
      `| ${r.displayName} | ${fmt(r.gitCommits)} | ${fmt(r.additions)} | ${fmt(r.deletions)} | ${r.aiCommits || '-'} | ${fmtCost(r.cost)} | ${fmtTokens(r.totalTokens)} | ${r.tickets || '-'} |`
    );
  }

  lines.push('|---------|-------------|----------|----------|------------|----------|--------|---------|');
  lines.push(
    `| **TOTAL** | **${fmt(totalGitC)}** | **${fmt(totalAdd)}** | **${fmt(totalDel)}** | **${totalAiC}** | **$${totalCost.toFixed(2)}** | **${fmtTokens(totalTokens)}** | |`
  );

  lines.push('');
  lines.push('---');
  lines.push(`Fuentes: ${CSV_PATH} · ${MD_PATH}`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const csvRows = loadCSV(CSV_PATH);
const mdMap   = loadMDSummary(MD_PATH);
const rows    = consolidate(csvRows, mdMap);
const md      = buildMD(rows);

fs.writeFileSync(OUT_PATH, md, 'utf8');
process.stderr.write(`Consolidated report written to: ${OUT_PATH}\n`);
process.stderr.write(`Rows: ${rows.length} | Total cost: $${rows.reduce((s,r)=>s+r.cost,0).toFixed(2)}\n`);
