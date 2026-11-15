export async function readChatStream(
  response: Response,
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<{ model?: string; processing?: string }> {
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (!reader) throw new Error('The local service returned an empty reply stream.');
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      pending += value;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        if (typeof event.delta === 'string') onDelta(event.delta);
        if (event.done === true) return event;
      }
    }
    throw new Error('The reply stream ended before the answer completed.');
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function recordResponseTime(stage: string, start: number) {
  const name = `Oracle: ${stage}`;
  performance.clearMeasures(name);
  performance.measure(name, { start, end: performance.now() });
}
