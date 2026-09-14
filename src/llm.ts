import { config, redact } from './config.js';

export type ModelFailureKind =
  | 'not_configured'
  | 'timeout'
  | 'rate_limited'
  | 'http_error'
  | 'invalid_response'
  | 'network';

export class ModelFailure extends Error {
  constructor(
    readonly kind: ModelFailureKind,
    message: string,
    readonly httpStatus?: number,
  ) {
    // Every message that can reach a log or an HTTP response goes through
    // redaction so an upstream error can never echo the API key back out.
    super(redact(message));
    this.name = 'ModelFailure';
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * Reasoning models bill hidden thinking tokens inside the completion count
   * and inside max_tokens. Reporting them separately is what makes the cost of
   * a question legible.
   */
  reasoningTokens: number;
  cachedPromptTokens: number;
}

export interface ModelResponse {
  text: string;
  model: string;
  usage: ModelUsage;
  latencyMs: number;
  attempts: number;
}

export interface ChatOptions {
  /** Ask the endpoint for a JSON object response. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

/** The model interface the answering pipeline depends on. Tests supply their own. */
export type ChatModel = (messages: ChatMessage[], options?: ChatOptions) => Promise<ModelResponse>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chat completion against any OpenAI-compatible endpoint (DeepSeek by default).
 *
 * Failures are classified rather than thrown as opaque errors: the caller needs
 * to tell a timeout from an invalid response so it can report that no answer
 * was produced instead of inventing one.
 */
export const chat: ChatModel = async (messages, options = {}) => {
  if (!config.llm.apiKey.trim()) {
    throw new ModelFailure(
      'not_configured',
      'No model credentials configured. Set LLM_API_KEY (see .env.example) to enable real-model answers.',
    );
  }

  const body = {
    model: config.llm.model,
    messages,
    temperature: options.temperature ?? config.llm.temperature,
    max_tokens: options.maxTokens ?? config.llm.maxTokens,
    stream: false,
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
  };

  let lastFailure: ModelFailure | null = null;
  for (let attempt = 1; attempt <= config.llm.maxRetries + 1; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.llm.timeoutMs),
      });

      if (response.status === 429 || response.status >= 500) {
        const detail = (await response.text()).slice(0, 300);
        lastFailure = new ModelFailure(
          response.status === 429 ? 'rate_limited' : 'http_error',
          `Model endpoint returned ${response.status}: ${detail}`,
          response.status,
        );
        if (attempt <= config.llm.maxRetries) {
          await sleep(Math.min(1_000 * 2 ** (attempt - 1), 8_000));
          continue;
        }
        throw lastFailure;
      }

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new ModelFailure('http_error', `Model endpoint returned ${response.status}: ${detail}`, response.status);
      }

      const payload = (await response.json()) as {
        model?: string;
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_cache_hit_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      const choice = payload.choices?.[0];
      const text = choice?.message?.content;

      if (choice?.finish_reason === 'length') {
        // A truncated reply parses as broken JSON further downstream, and on a
        // reasoning model it can arrive with no content at all because the
        // token budget went on hidden thinking. Saying so here turns a
        // confusing parse error into an actionable one.
        throw new ModelFailure(
          'invalid_response',
          `Model reply was cut off at the ${body.max_tokens} token limit ` +
            `(${payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0} of them reasoning tokens). ` +
            'Raise LLM_MAX_TOKENS or reduce RETRIEVAL_TOP_K.',
        );
      }
      if (typeof text !== 'string' || text.trim() === '') {
        throw new ModelFailure('invalid_response', 'Model endpoint returned no message content');
      }

      return {
        text,
        model: payload.model ?? config.llm.model,
        usage: {
          promptTokens: payload.usage?.prompt_tokens ?? 0,
          completionTokens: payload.usage?.completion_tokens ?? 0,
          totalTokens: payload.usage?.total_tokens ?? 0,
          reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
          cachedPromptTokens: payload.usage?.prompt_cache_hit_tokens ?? 0,
        },
        latencyMs: Date.now() - startedAt,
        attempts: attempt,
      };
    } catch (error) {
      if (error instanceof ModelFailure) throw error;
      const err = error as Error;
      const kind: ModelFailureKind =
        err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : 'network';
      lastFailure = new ModelFailure(
        kind,
        kind === 'timeout'
          ? `Model call timed out after ${config.llm.timeoutMs}ms`
          : `Model call failed: ${err.message}`,
      );
      if (kind === 'timeout' && attempt <= config.llm.maxRetries) {
        await sleep(500 * attempt);
        continue;
      }
      throw lastFailure;
    }
  }
  throw lastFailure ?? new ModelFailure('network', 'Model call failed');
};
