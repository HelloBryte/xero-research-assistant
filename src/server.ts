import { createApp } from './app.js';
import { config } from './config.js';
import { ResearchService } from './service.js';

const service = new ResearchService();

createApp(service).listen(config.port, () => {
  const status = service.status();
  process.stdout.write(
    `Xero research assistant on http://localhost:${config.port}\n` +
      `  store: ${status.storePath}\n` +
      `  model: ${config.llm.model} (${status.modelConfigured ? 'configured' : 'NO credentials'})\n`,
  );
});
