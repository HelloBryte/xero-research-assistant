import { ModelFailure } from './llm.js';
import { ResearchService } from './service.js';
import type { AnswerResult } from './answer.js';

const USAGE = `Xero research assistant

  npm run gather                 fetch any source that is not already stored (reuses the rest)
  npm run refresh                re-fetch every source; unchanged pages are not reprocessed
  npm run cli -- refresh --only id  refresh a single source
  npm run cli -- refresh --force    re-fetch and rebuild passages even if a page is unchanged
  npm run ask "question"         retrieve evidence and answer with the configured model
  npm run cli preview "question" show which passages a question retrieves, without a model call
  npm run status                 what is stored, when it was retrieved, and whether a model is configured
  npm run cli trace <passageId>  print the full stored passage behind a citation
  npm run cli -- log [--tail 40]    recent activity: fetches, reuse, model calls, failures

Flags: --only a,b   --force   --k 8   --json   --tail 40
Note: npm needs a "--" before a flag, for example: npm run cli -- refresh --force`;

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token.startsWith('--')) {
      const [name, inline] = token.slice(2).split('=', 2);
      if (inline !== undefined) flags[name!] = inline;
      else if (rest[i + 1] && !rest[i + 1]!.startsWith('--')) flags[name!] = rest[++i]!;
      else flags[name!] = true;
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function list(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function numberFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<number> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const json = flags.json === true || flags.json === 'true';
  const service = new ResearchService();

  switch (command) {
    case 'gather':
    case 'refresh': {
      const report = await (command === 'gather'
        ? service.gather({ only: list(flags.only) })
        : service.refresh({ only: list(flags.only), force: flags.force === true || flags.force === 'true' }));
      if (json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`\n${command} ${report.ok ? 'completed' : 'completed with failures'}:`);
        for (const source of report.sources) {
          const suffix =
            source.outcome === 'failed'
              ? `  ${source.error?.kind}: ${source.error?.message}` +
                (source.servingEvidenceFrom ? `\n      still serving evidence retrieved ${source.servingEvidenceFrom}` : '')
              : `  ${source.chunkCount ?? 0} passage(s)`;
          console.log(`  ${source.outcome.padEnd(12)} ${source.sourceId}${suffix}`);
        }
      }
      return report.ok ? 0 : 1;
    }

    case 'ask': {
      const question = positional.join(' ');
      if (!question) {
        console.error('Usage: npm run ask "your question"');
        return 2;
      }
      try {
        const result = await service.ask(question, { topK: numberFlag(flags.k) });
        if (json) console.log(JSON.stringify(result, null, 2));
        else printAnswer(result);
        return result.status === 'insufficient' ? 0 : 0;
      } catch (error) {
        if (error instanceof ModelFailure) {
          console.error(`\nNo answer produced. Model call failed (${error.kind}): ${error.message}`);
          console.error('Stored research is unchanged. Nothing was fetched and no answer was generated.');
          return 1;
        }
        throw error;
      }
    }

    case 'preview': {
      const question = positional.join(' ');
      if (!question) {
        console.error('Usage: npm run cli preview "your question"');
        return 2;
      }
      const retrieval = service.preview(question, numberFlag(flags.k));
      if (json) {
        console.log(JSON.stringify(retrieval, null, 2));
        return 0;
      }
      console.log(`\nQuery terms: ${retrieval.terms.join(', ') || '(none)'}`);
      console.log(`Matched ${retrieval.matchedTerms.length}/${retrieval.terms.length} terms (${retrieval.quality})`);
      console.log(`Searched ${retrieval.consideredChunks} stored passage(s); no network or model call.\n`);
      for (const [position, item] of retrieval.results.entries()) {
        console.log(`E${position + 1} ${item.chunk.id}  score=${item.score.toFixed(3)}  ${item.chunk.heading ?? ''}`);
        console.log(`   ${item.chunk.text.slice(0, 180).replace(/\n/g, ' ')}\n`);
      }
      return 0;
    }

    case 'status': {
      const status = service.status();
      if (json) {
        console.log(JSON.stringify(status, null, 2));
        return 0;
      }
      console.log(`\nStore: ${status.storePath}`);
      console.log(`Model: ${status.model} (${status.modelConfigured ? 'credentials configured' : 'NO credentials - answers unavailable'})`);
      console.log(`Sources: ${status.storedSources} stored / ${status.configuredSources} configured, ${status.storedPassages} passage(s)\n`);
      for (const source of status.sources) {
        console.log(`  ${source.id}${source.configured ? '' : '  [no longer in config]'}`);
        console.log(`     ${source.url}`);
        console.log(
          `     retrieved ${source.fetchedAt} | processed ${source.processedAt} | ${source.chunkCount} passage(s) | hash ${source.contentHash.slice(0, 12)}`,
        );
        if (source.lastError) {
          console.log(`     last refresh FAILED ${source.lastError.at}: ${source.lastError.kind} - ${source.lastError.message}`);
        }
      }
      for (const pending of status.pending) {
        console.log(`  ${pending.sourceId}  NOT STORED  ${pending.url}`);
        if (pending.lastError) console.log(`     last attempt: ${pending.lastError}`);
      }
      return 0;
    }

    case 'trace': {
      const id = positional[0];
      if (!id) {
        console.error('Usage: npm run cli trace <passageId>   (for example xero-pricing-au#3)');
        return 2;
      }
      const found = service.trace(id);
      if (!found) {
        console.error(`No stored passage with id "${id}".`);
        return 1;
      }
      if (json) {
        console.log(JSON.stringify(found, null, 2));
        return 0;
      }
      console.log(`\n${found.chunk.id}`);
      console.log(`Source:    ${found.source.title}`);
      console.log(`URL:       ${found.source.finalUrl || found.source.url}`);
      console.log(`Retrieved: ${found.source.fetchedAt}`);
      if (found.source.region) console.log(`Region:    ${found.source.region}${found.source.currency ? ` (${found.source.currency})` : ''}`);
      if (found.chunk.heading) console.log(`Section:   ${found.chunk.heading}`);
      console.log(`\n${found.chunk.text}\n`);
      return 0;
    }

    case 'log': {
      const events = service.activity.tail(numberFlag(flags.tail) ?? 40);
      if (json) {
        console.log(JSON.stringify(events, null, 2));
        return 0;
      }
      for (const event of events) {
        console.log(`${event.ts}  ${event.op}/${event.runId}  ${event.type.padEnd(18)} ${event.message}`);
      }
      return 0;
    }

    default:
      console.log(USAGE);
      return command === 'help' ? 0 : 2;
  }
}

function printAnswer(result: AnswerResult): void {
  console.log(`\n--- ${result.status.toUpperCase()} ---\n`);
  console.log(result.answer || '(no answer text)');

  if (result.notes) console.log(`\nContext: ${result.notes}`);

  if (result.unknowns.length) {
    console.log('\nNot established by the stored evidence:');
    for (const unknown of result.unknowns) console.log(`  - ${unknown}`);
  }

  if (result.claims.length) {
    console.log('\nClaim checks (application-side verification of the model’s own citations):');
    for (const claim of result.claims) {
      const labels = claim.citations.map((citation) => `${citation.label}=${citation.chunkId}`).join(', ') || 'none';
      console.log(`  [${claim.check.verdict}] ${claim.text}`);
      console.log(`      cites ${labels}  overlap=${claim.check.overlap.toFixed(2)}  ${claim.check.reason}`);
    }
  }

  if (result.citations.length) {
    console.log('\nSources:');
    for (const citation of result.citations) {
      console.log(`  ${citation.label} ${citation.sourceTitle}`);
      console.log(`     ${citation.url}`);
      console.log(`     retrieved ${citation.retrievedAt}${citation.region ? ` | region ${citation.region}` : ''}${citation.currency ? ` | ${citation.currency}` : ''}`);
      console.log(`     passage ${citation.chunkId} (npm run cli trace ${citation.chunkId})`);
      if (citation.staleWarning) console.log(`     ${citation.staleWarning}`);
    }
  }

  for (const warning of result.warnings) console.log(`\nWARNING: ${warning}`);

  const model = result.model;
  console.log(
    `\nRetrieval: ${result.retrieval.selected.length} of ${result.retrieval.consideredChunks} stored passage(s), ` +
      `coverage ${result.retrieval.coverage} (${result.retrieval.quality}); no sources were fetched.`,
  );
  if (model?.called) {
    console.log(
      `Model: ${model.name}, ${model.usage?.totalTokens ?? 0} tokens (${model.usage?.promptTokens ?? 0} prompt / ${model.usage?.completionTokens ?? 0} completion), ${model.latencyMs}ms`,
    );
  } else {
    console.log('Model: not called.');
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`\nError: ${(error as Error).message}`);
    process.exitCode = 1;
  });
