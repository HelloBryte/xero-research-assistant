import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, redact } from './config.js';

export type ActivityType =
  | 'run_started'
  | 'run_finished'
  | 'source_fetched'
  | 'source_reused'
  | 'source_unchanged'
  | 'source_reprocessed'
  | 'source_failed'
  | 'source_removed'
  | 'retrieval'
  | 'model_call'
  | 'model_failed'
  | 'answer'
  | 'answer_refused';

export type ActivityOp = 'gather' | 'refresh' | 'ask' | 'eval' | 'server';

export interface ActivityEvent {
  ts: string;
  runId: string;
  op: ActivityOp;
  type: ActivityType;
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Append-only record of what the application did: which sources were fetched,
 * reused, reprocessed or failed, and when a model was called. This is the
 * output a reviewer compares between a first and a repeated run without
 * reading the source code.
 */
export class ActivityLog {
  private readonly file: string;

  constructor(dataDir: string = config.dataDir) {
    mkdirSync(dataDir, { recursive: true });
    this.file = join(dataDir, 'activity.jsonl');
  }

  get path(): string {
    return this.file;
  }

  startRun(op: ActivityOp): RunLog {
    return new RunLog(this, op);
  }

  append(event: ActivityEvent): void {
    appendFileSync(this.file, `${JSON.stringify(event)}\n`, 'utf8');
  }

  /** Most recent events, newest last. */
  tail(limit = 50): ActivityEvent[] {
    // `slice(-0)` is `slice(0)`, which returns everything: a limit of 0 or a
    // negative limit arriving from a query string used to dump the whole log.
    const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
    if (count === 0) return [];
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    const events: ActivityEvent[] = [];
    for (const line of lines.slice(-count)) {
      try {
        events.push(JSON.parse(line) as ActivityEvent);
      } catch {
        // A truncated final line from an interrupted write is skipped rather
        // than failing the whole read.
      }
    }
    return events;
  }
}

/** Events for a single operation, collected so they can also be returned to the caller. */
export class RunLog {
  readonly runId = randomUUID().slice(0, 8);
  readonly events: ActivityEvent[] = [];

  constructor(
    private readonly log: ActivityLog,
    readonly op: ActivityOp,
  ) {}

  event(type: ActivityType, message: string, detail?: Record<string, unknown>): ActivityEvent {
    const event: ActivityEvent = {
      ts: new Date().toISOString(),
      runId: this.runId,
      op: this.op,
      type,
      message: redact(message),
      ...(detail ? { detail: redactDetail(detail) } : {}),
    };
    this.events.push(event);
    this.log.append(event);
    if (process.env.ACTIVITY_QUIET !== '1') {
      process.stderr.write(`[${event.ts}] ${this.op}/${this.runId} ${type.padEnd(18)} ${event.message}\n`);
    }
    return event;
  }

  /** Counts by event type, used for the per-request summary shown in the UI. */
  summary(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const event of this.events) counts[event.type] = (counts[event.type] ?? 0) + 1;
    return counts;
  }
}

function redactDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (/key|token|secret|authorization/i.test(key)) {
      out[key] = '[redacted]';
    } else if (typeof value === 'string') {
      out[key] = redact(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
