/**
 * Minimal robots.txt support. We only need to answer "may this user agent fetch
 * this path", plus any crawl-delay the site asks for. Anything we cannot parse
 * is treated as "allowed", which matches the robots.txt convention, except that
 * a robots.txt we could not read at all is treated as allowed too (the standard
 * says a 4xx means unrestricted).
 */

interface Rule {
  allow: boolean;
  path: string;
}

export interface RobotsPolicy {
  rules: Rule[];
  crawlDelayMs: number | null;
}

const ALLOW_ALL: RobotsPolicy = { rules: [], crawlDelayMs: null };

export function parseRobots(text: string, userAgentToken: string): RobotsPolicy {
  const ua = userAgentToken.toLowerCase();
  // Group directives by the user-agent lines that precede them.
  const groups: { agents: string[]; rules: Rule[]; crawlDelay: number | null }[] = [];
  let current: { agents: string[]; rules: Rule[]; crawlDelay: number | null } | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    if (!current) continue;
    if (field === 'disallow') current.rules.push({ allow: false, path: value });
    else if (field === 'allow') current.rules.push({ allow: true, path: value });
    else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds * 1000;
    }
  }

  // Most specific matching group wins: exact agent match beats the "*" group.
  const exact = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const wildcard = groups.filter((g) => g.agents.includes('*'));
  const chosen = exact.length > 0 ? exact : wildcard;
  if (chosen.length === 0) return ALLOW_ALL;

  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelayMs: chosen.reduce<number | null>(
      (acc, g) => (g.crawlDelay === null ? acc : Math.max(acc ?? 0, g.crawlDelay)),
      null,
    ),
  };
}

/** Longest matching rule wins; ties go to Allow, per the common interpretation. */
export function isAllowed(policy: RobotsPolicy, path: string): boolean {
  let best: Rule | null = null;
  for (const rule of policy.rules) {
    if (!matches(rule.path, path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

function matches(pattern: string, path: string): boolean {
  if (pattern === '') return false; // "Disallow:" with no value means allow everything
  const mustEnd = pattern.endsWith('$');
  const body = mustEnd ? pattern.slice(0, -1) : pattern;
  const parts = body.split('*');

  let index = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (part === '') continue;
    if (i === 0) {
      if (!path.startsWith(part)) return false;
      index = part.length;
    } else {
      const found = path.indexOf(part, index);
      if (found === -1) return false;
      index = found + part.length;
    }
  }
  if (mustEnd) {
    const tail = parts[parts.length - 1]!;
    return tail === '' ? true : path.endsWith(tail);
  }
  return true;
}
