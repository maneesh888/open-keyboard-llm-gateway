type RecordValue = Record<string, unknown>;

export type CompatibilityFailure = {
  ok: false;
  message: string;
};

export type CompatibilitySuccess<T> = {
  ok: true;
  value: T;
};

export type CompatibilityResult<T> = CompatibilitySuccess<T> | CompatibilityFailure;

export type ChatCompletionRequest = RecordValue & {
  model?: string;
  messages?: unknown[];
  operation?: string;
  stream?: boolean;
};

export type PreparedChatCompletionStream = {
  stream: ReadableStream<Uint8Array>;
};

const numericGenerationFields = [
  'temperature',
  'top_p',
  'n',
  'max_tokens',
  'max_completion_tokens',
  'presence_penalty',
  'frequency_penalty',
  'seed',
  'top_logprobs',
] as const;

const encoder = new TextEncoder();
const MAX_SSE_EVENT_LENGTH = 1024 * 1024;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: RecordValue, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function failure(message: string): CompatibilityFailure {
  return { ok: false, message };
}

function validMessage(message: unknown): boolean {
  if (!isRecord(message) || typeof message.role !== 'string' || !message.role.trim()) return false;

  if (hasOwn(message, 'content')) {
    if (typeof message.content === 'string' || message.content === null) return true;
    if (Array.isArray(message.content)) {
      return message.content.every((part) => isRecord(part) && typeof part.type === 'string' && Boolean(part.type.trim()));
    }
    return false;
  }

  return Array.isArray(message.tool_calls) || isRecord(message.function_call);
}

export function parseChatCompletionRequest(body: string | undefined): CompatibilityResult<ChatCompletionRequest> {
  if (!body) return failure('Request body must be a JSON object.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return failure('Request body must contain valid JSON.');
  }
  if (!isRecord(parsed)) return failure('Request body must be a JSON object.');

  const request = parsed as ChatCompletionRequest;
  const isOperationRequest = typeof request.operation === 'string' && Boolean(request.operation.trim());

  if ((!isOperationRequest || hasOwn(request, 'model'))
    && (typeof request.model !== 'string' || !request.model.trim())) {
    return failure('model must be a non-empty string.');
  }

  if ((!isOperationRequest || hasOwn(request, 'messages')) && !Array.isArray(request.messages)) {
    return failure('messages must be an array.');
  }
  if (Array.isArray(request.messages) && !request.messages.every(validMessage)) {
    return failure('Each message must contain a non-empty role and valid content.');
  }

  if (hasOwn(request, 'stream') && typeof request.stream !== 'boolean') {
    return failure('stream must be a boolean.');
  }

  for (const field of numericGenerationFields) {
    if (hasOwn(request, field) && (typeof request[field] !== 'number' || !Number.isFinite(request[field]))) {
      return failure(`${field} must be a finite number.`);
    }
  }

  if (hasOwn(request, 'stop')) {
    const stop = request.stop;
    if (!(stop === null || typeof stop === 'string' || (Array.isArray(stop) && stop.every((item) => typeof item === 'string')))) {
      return failure('stop must be a string, an array of strings, or null.');
    }
  }

  return { ok: true, value: request };
}

export function validateChatCompletionResponse(body: string): CompatibilityResult<RecordValue> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return failure('The upstream returned an invalid Chat Completions response.');
  }

  if (!isRecord(parsed)
    || typeof parsed.id !== 'string'
    || parsed.object !== 'chat.completion'
    || typeof parsed.created !== 'number'
    || typeof parsed.model !== 'string'
    || !Array.isArray(parsed.choices)
    || parsed.choices.length === 0) {
    return failure('The upstream returned an invalid Chat Completions response.');
  }

  for (const choice of parsed.choices) {
    if (!isRecord(choice)
      || typeof choice.index !== 'number'
      || !isRecord(choice.message)
      || typeof choice.message.role !== 'string'
      || typeof choice.message.content !== 'string') {
      return failure('The upstream returned an invalid Chat Completions response.');
    }
    if (hasOwn(choice, 'finish_reason') && choice.finish_reason !== null && typeof choice.finish_reason !== 'string') {
      return failure('The upstream returned an invalid Chat Completions response.');
    }
  }

  return { ok: true, value: parsed };
}

type StreamEventResult = CompatibilityResult<{
  output?: Uint8Array;
  chunk: boolean;
  terminal: boolean;
}>;

class ChatCompletionStreamValidator {
  private sawChunk = false;
  private sawDone = false;

  event(rawEvent: string): StreamEventResult {
    const lines = rawEvent.replace(/\r\n/g, '\n').split('\n');
    const meaningful = lines.filter((line) => line.length > 0 && !line.startsWith(':'));
    if (meaningful.length === 0) return { ok: true, value: { chunk: false, terminal: false } };
    if (meaningful.some((line) => !line.startsWith('data:'))) {
      return failure('The upstream emitted unsupported SSE fields.');
    }

    const data = meaningful.map((line) => line.slice(5).trimStart()).join('\n').trim();
    if (data === '[DONE]') {
      if (!this.sawChunk || this.sawDone) return failure('The upstream emitted an invalid SSE termination sequence.');
      this.sawDone = true;
      return {
        ok: true,
        value: { output: encoder.encode('data: [DONE]\n\n'), chunk: false, terminal: true },
      };
    }
    if (this.sawDone) return failure('The upstream emitted data after [DONE].');

    let chunk: unknown;
    try {
      chunk = JSON.parse(data) as unknown;
    } catch {
      return failure('The upstream emitted malformed SSE JSON.');
    }

    if (!isRecord(chunk)
      || typeof chunk.id !== 'string'
      || chunk.object !== 'chat.completion.chunk'
      || typeof chunk.created !== 'number'
      || typeof chunk.model !== 'string'
      || !Array.isArray(chunk.choices)) {
      return failure('The upstream emitted an invalid Chat Completions chunk.');
    }

    if (chunk.choices.length === 0 && !isRecord(chunk.usage)) {
      return failure('The upstream emitted an empty Chat Completions chunk without usage.');
    }

    for (const choice of chunk.choices) {
      if (!isRecord(choice) || typeof choice.index !== 'number' || !isRecord(choice.delta)) {
        return failure('The upstream emitted an invalid Chat Completions delta.');
      }
      if (hasOwn(choice.delta, 'content') && choice.delta.content !== null && typeof choice.delta.content !== 'string') {
        return failure('The upstream emitted an invalid Chat Completions delta.');
      }
      if (hasOwn(choice, 'finish_reason') && choice.finish_reason !== null && typeof choice.finish_reason !== 'string') {
        return failure('The upstream emitted an invalid Chat Completions finish reason.');
      }
    }

    this.sawChunk = true;
    return {
      ok: true,
      value: { output: encoder.encode(`data: ${data}\n\n`), chunk: true, terminal: false },
    };
  }

  finish(): CompatibilityResult<undefined> {
    return this.sawChunk && this.sawDone
      ? { ok: true, value: undefined }
      : failure('The upstream stream ended before [DONE].');
  }
}

function takeEvent(buffer: string): { event: string; rest: string } | undefined {
  const separator = /\r?\n\r?\n/.exec(buffer);
  if (!separator || separator.index === undefined) return undefined;
  return {
    event: buffer.slice(0, separator.index),
    rest: buffer.slice(separator.index + separator[0].length),
  };
}

function streamFailureEvent(): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify({
    error: {
      message: 'The upstream emitted an invalid Chat Completions stream.',
      type: 'server_error',
      code: 'invalid_stream',
    },
  })}\n\ndata: [DONE]\n\n`);
}

export async function prepareChatCompletionStream(
  body: ReadableStream<Uint8Array> | null,
  upstreamController: AbortController,
): Promise<CompatibilityResult<PreparedChatCompletionStream>> {
  if (!body) return failure('The upstream returned an empty Chat Completions stream.');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const validator = new ChatCompletionStreamValidator();
  const prefetched: Uint8Array[] = [];
  let buffer = '';
  let firstChunkSeen = false;
  let terminalSeen = false;
  let upstreamDone = false;

  try {
    while (!firstChunkSeen && !terminalSeen) {
      const read = await reader.read();
      upstreamDone = read.done;
      buffer += decoder.decode(read.value, { stream: !read.done });

      let split = takeEvent(buffer);
      if (!split && buffer.length > MAX_SSE_EVENT_LENGTH) {
        const message = 'The upstream emitted an oversized SSE event.';
        await reader.cancel(message).catch(() => undefined);
        upstreamController.abort(message);
        return failure(message);
      }
      while (split) {
        if (split.event.length > MAX_SSE_EVENT_LENGTH) {
          const message = 'The upstream emitted an oversized SSE event.';
          await reader.cancel(message).catch(() => undefined);
          upstreamController.abort(message);
          return failure(message);
        }
        buffer = split.rest;
        const checked = validator.event(split.event);
        if (!checked.ok) {
          await reader.cancel(checked.message).catch(() => undefined);
          upstreamController.abort(checked.message);
          return checked;
        }
        if (checked.value.output) prefetched.push(checked.value.output);
        firstChunkSeen ||= checked.value.chunk;
        terminalSeen ||= checked.value.terminal;
        if (firstChunkSeen || terminalSeen) break;
        split = takeEvent(buffer);
      }

      if (upstreamDone && !firstChunkSeen && !terminalSeen) {
        const finished = validator.finish();
        return finished.ok ? failure('The upstream returned an empty Chat Completions stream.') : finished;
      }
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }

  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const prefetchedOutput = prefetched.shift();
        if (prefetchedOutput) {
          controller.enqueue(prefetchedOutput);
          if (terminalSeen) {
            await reader.cancel('OpenAI stream completed').catch(() => undefined);
            controller.close();
          }
          return;
        }

        while (!cancelled) {
          let split = takeEvent(buffer);
          if (split && split.event.length > MAX_SSE_EVENT_LENGTH) {
            const message = 'The upstream emitted an oversized SSE event.';
            controller.enqueue(streamFailureEvent());
            upstreamController.abort(message);
            await reader.cancel(message).catch(() => undefined);
            controller.close();
            return;
          }
          if (!split && buffer.length > MAX_SSE_EVENT_LENGTH) {
            const message = 'The upstream emitted an oversized SSE event.';
            controller.enqueue(streamFailureEvent());
            upstreamController.abort(message);
            await reader.cancel(message).catch(() => undefined);
            controller.close();
            return;
          }

          if (!split && upstreamDone) {
            const finished = validator.finish();
            if (!finished.ok) controller.enqueue(streamFailureEvent());
            controller.close();
            return;
          }

          if (!split) {
            const read = await reader.read();
            upstreamDone = read.done;
            buffer += decoder.decode(read.value, { stream: !read.done });
            continue;
          }

          buffer = split.rest;
          const checked = validator.event(split.event);
          if (!checked.ok) {
            controller.enqueue(streamFailureEvent());
            upstreamController.abort(checked.message);
            await reader.cancel(checked.message).catch(() => undefined);
            controller.close();
            return;
          }
          terminalSeen ||= checked.value.terminal;
          if (!checked.value.output) continue;

          controller.enqueue(checked.value.output);
          if (terminalSeen) {
            await reader.cancel('OpenAI stream completed').catch(() => undefined);
            controller.close();
          }
          return;
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    async cancel(reason) {
      cancelled = true;
      upstreamController.abort(reason);
      await reader.cancel(reason).catch(() => undefined);
    },
  }, { highWaterMark: 0 });

  return { ok: true, value: { stream } };
}
