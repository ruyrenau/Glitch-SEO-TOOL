/**
 * robots.txt parser following RFC 9309 / Google's behaviour:
 * - the most specific user-agent group wins (fallback to "*"),
 * - the longest matching rule wins; on a tie, Allow wins,
 * - "*" wildcards and a trailing "$" anchor are supported.
 */
interface Rule {
  allow: boolean;
  pattern: string;
  regex: RegExp;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelay?: number;
}

export interface RobotsTxt {
  groups: Group[];
  sitemaps: string[];
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobotsTxt(text: string): RobotsTxt {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') {
      sitemaps.push(value);
    } else if (current && (key === 'allow' || key === 'disallow')) {
      if (key === 'disallow' && value === '') continue; // empty Disallow = allow all
      current.rules.push({ allow: key === 'allow', pattern: value, regex: toRegex(value) });
    } else if (current && key === 'crawl-delay') {
      const d = Number(value);
      if (Number.isFinite(d) && d >= 0) current.crawlDelay = d;
    }
  }
  return { groups, sitemaps };
}

/** Picks the group whose user-agent token is the longest substring match of the product token. */
function selectGroup(robots: RobotsTxt, userAgent: string): Group | null {
  const token = userAgent.toLowerCase().split('/')[0].trim();
  let best: Group | null = null;
  let bestLen = -1;
  for (const g of robots.groups) {
    for (const a of g.agents) {
      if (a !== '*' && token.includes(a) && a.length > bestLen) {
        best = g;
        bestLen = a.length;
      }
    }
  }
  if (best) return best;
  return robots.groups.find(g => g.agents.includes('*')) ?? null;
}

export function isAllowedByRobots(robots: RobotsTxt, userAgent: string, pathAndQuery: string): boolean {
  const group = selectGroup(robots, userAgent);
  if (!group) return true;
  let match: Rule | null = null;
  for (const r of group.rules) {
    if (!r.regex.test(pathAndQuery)) continue;
    if (!match || r.pattern.length > match.pattern.length || (r.pattern.length === match.pattern.length && r.allow)) match = r;
  }
  return match ? match.allow : true;
}

export function crawlDelayFor(robots: RobotsTxt, userAgent: string): number | undefined {
  return selectGroup(robots, userAgent)?.crawlDelay;
}
