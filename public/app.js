/* Minimal reviewer-facing UI. Visual polish is deliberately not the point:
   everything here exists to make the application's behaviour observable. */

const $ = (id) => document.getElementById(id);

function text(value) {
  return String(value ?? '');
}

/** Build an element with text content; never interpolates HTML from stored page content. */
function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = text(content);
  return node;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message ?? `Request failed (${response.status})`);
    error.kind = payload?.error?.kind ?? 'http_error';
    error.detail = payload?.error?.detail;
    throw error;
  }
  return payload;
}

async function loadStatus() {
  const status = await api('/api/status');
  const container = $('status');
  container.replaceChildren();

  const summary = el(
    'p',
    'muted',
    `${status.storedSources} of ${status.configuredSources} configured source(s) stored, ` +
      `${status.storedPassages} passage(s). Model: ${status.model} ` +
      `(${status.modelConfigured ? 'credentials configured' : 'no credentials — answering disabled'}).`,
  );
  container.append(summary);

  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const label of ['Source', 'Retrieved', 'Content last changed', 'Passages', 'State']) {
    head.append(el('th', null, label));
  }
  table.append(head);

  for (const source of status.sources) {
    const row = document.createElement('tr');
    const first = document.createElement('td');
    const link = document.createElement('a');
    link.href = source.finalUrl || source.url;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = source.title || source.id;
    first.append(link, el('div', 'muted', source.id));
    row.append(first);
    row.append(el('td', null, source.fetchedAt));
    row.append(el('td', null, source.contentChangedAt));
    row.append(el('td', null, source.chunkCount));
    const state = document.createElement('td');
    if (source.lastError) {
      state.className = 'error';
      state.textContent = `last refresh failed: ${source.lastError.kind} (evidence above is the older copy)`;
    } else {
      state.textContent = source.configured ? 'ok' : 'no longer in config';
    }
    row.append(state);
    table.append(row);
  }
  container.append(table);

  for (const pending of status.pending) {
    container.append(el('p', 'error', `Not stored: ${pending.sourceId} — ${pending.lastError ?? 'never fetched'}`));
  }
}

async function runResearch(mode, force) {
  const busy = $('research-busy');
  busy.textContent = `${mode} running…`;
  try {
    const report = await api(`/api/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: Boolean(force) }),
    });
    $('run-report').textContent = report.sources
      .map((source) => {
        const detail =
          source.outcome === 'failed'
            ? `${source.error?.kind}: ${source.error?.message}` +
              (source.servingEvidenceFrom
                ? ` | still serving evidence retrieved ${source.servingEvidenceFrom} (not refreshed)`
                : ' | no stored evidence')
            : `${source.chunkCount ?? 0} passage(s)`;
        return `${source.outcome.padEnd(12)} ${source.sourceId}  ${detail}`;
      })
      .join('\n');
    busy.textContent = report.ok ? 'done' : 'finished with failures (see last run)';
  } catch (error) {
    busy.textContent = '';
    $('run-report').textContent = `Failed: ${error.message}`;
  }
  await loadStatus();
  await loadActivity();
}

function renderCitation(citation) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.append(`${citation.label} — ${citation.sourceTitle}`);
  details.append(summary);

  const link = document.createElement('a');
  link.href = citation.url;
  link.target = '_blank';
  link.rel = 'noreferrer noopener';
  link.textContent = citation.url;
  details.append(el('div', 'muted', `passage ${citation.chunkId}`), link);

  const context = [
    `retrieved ${citation.retrievedAt}`,
    citation.region ? `region ${citation.region}` : null,
    citation.currency ? `currency ${citation.currency}` : null,
    citation.heading ? `section "${citation.heading}"` : null,
  ]
    .filter(Boolean)
    .join(' | ');
  details.append(el('div', 'muted', context));
  if (citation.staleWarning) details.append(el('div', 'error', citation.staleWarning));
  details.append(el('pre', null, citation.snippet));
  return details;
}

function renderAnswer(result) {
  const container = $('answer');
  container.replaceChildren();

  container.append(el('h3', null, `Status: ${result.status}`));
  container.append(el('p', null, result.answer || '(no answer text)'));
  if (result.notes) container.append(el('p', 'muted', `Context: ${result.notes}`));

  if (result.unknowns.length) {
    container.append(el('strong', null, 'Not established by the stored evidence:'));
    const list = document.createElement('ul');
    for (const unknown of result.unknowns) list.append(el('li', null, unknown));
    container.append(list);
  }

  for (const warning of result.warnings) container.append(el('p', 'error', `Warning: ${warning}`));

  if (result.claims.length) {
    container.append(el('h3', null, 'Claim checks'));
    container.append(
      el(
        'p',
        'muted',
        'Each claim is compared by the application against the passage the model cited: figures must appear in ' +
          'the cited text and the wording must overlap it.',
      ),
    );
    const table = document.createElement('table');
    const head = document.createElement('tr');
    for (const label of ['Verdict', 'Claim', 'Cites', 'Why']) head.append(el('th', null, label));
    table.append(head);
    for (const claim of result.claims) {
      const row = document.createElement('tr');
      row.append(el('td', `verdict-${claim.check.verdict}`, claim.check.verdict));
      row.append(el('td', null, claim.text));
      row.append(el('td', null, claim.citations.map((citation) => citation.chunkId).join(', ') || '—'));
      row.append(el('td', 'muted', `${claim.check.reason} (overlap ${claim.check.overlap.toFixed(2)})`));
      table.append(row);
    }
    container.append(table);
  }

  if (result.citations.length) {
    container.append(el('h3', null, 'Evidence'));
    for (const citation of result.citations) container.append(renderCitation(citation));
  }

  const model = result.model;
  container.append(
    el(
      'p',
      'muted',
      `Retrieved ${result.retrieval.selected.length} of ${result.retrieval.consideredChunks} stored passage(s) ` +
        `(coverage ${result.retrieval.coverage}, ${result.retrieval.quality}); no source was fetched to answer this. ` +
        (model?.called
          ? `Model ${model.name}: ${model.usage.totalTokens} tokens ` +
            `(${model.usage.promptTokens} prompt, ${model.usage.completionTokens} completion of which ` +
            `${model.usage.reasoningTokens} reasoning), ${model.latencyMs}ms.`
          : 'No model call was needed.'),
    ),
  );
}

async function ask() {
  const question = $('question').value.trim();
  if (!question) return;
  const container = $('answer');
  container.replaceChildren(el('p', 'muted', 'Retrieving evidence and calling the model…'));
  try {
    renderAnswer(await api('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    }));
  } catch (error) {
    container.replaceChildren(
      el('p', 'error', `No answer produced (${error.kind}): ${error.message}`),
      el('p', 'muted', error.detail ?? 'The stored research is unchanged.'),
    );
  }
  await loadActivity();
}

async function preview() {
  const question = $('question').value.trim();
  if (!question) return;
  const container = $('answer');
  container.replaceChildren(el('p', 'muted', 'Retrieving…'));
  try {
    const result = await api(`/api/preview?q=${encodeURIComponent(question)}`);
    container.replaceChildren(
      el('h3', null, 'Retrieved evidence (no model call)'),
      el(
        'p',
        'muted',
        `Matched ${result.matchedTerms.length}/${result.terms.length} query terms (${result.quality}) ` +
          `across ${result.consideredChunks} stored passage(s).`,
      ),
    );
    for (const item of result.results) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `${item.chunkId} — score ${item.score.toFixed(3)} — ${item.heading ?? ''}`;
      details.append(summary, el('pre', null, item.text));
      container.append(details);
    }
  } catch (error) {
    container.replaceChildren(el('p', 'error', error.message));
  }
}

async function loadActivity() {
  const { events } = await api('/api/activity?limit=60');
  $('activity').textContent = events
    .map((event) => `${event.ts}  ${event.op}/${event.runId}  ${event.type.padEnd(18)} ${event.message}`)
    .join('\n');
}

$('gather').addEventListener('click', () => runResearch('gather'));
$('refresh').addEventListener('click', () => runResearch('refresh'));
$('rebuild').addEventListener('click', () => runResearch('refresh', true));
$('reload-activity').addEventListener('click', loadActivity);
$('preview').addEventListener('click', preview);
$('ask-form').addEventListener('submit', (event) => {
  event.preventDefault();
  ask();
});

loadStatus();
loadActivity();
