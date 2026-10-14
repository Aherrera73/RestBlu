// Cliente del servidor de IA (API compatible con OpenAI: Ollama u otro). Pide
// la respuesta en modo streaming para poder mostrarla mientras se escribe.

export function createAiClient({ baseUrl, apiKey, model, fetchImpl = fetch }) {
  const configured = () => Boolean(baseUrl && apiKey && model);

  async function post(body, signal) {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, think: false, reasoning_effort: 'none', ...body }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const detail = String(payload?.error?.message || payload?.error || payload?.message || '').slice(0, 300);
      throw new Error(detail || `El servidor de IA respondió con HTTP ${response.status}.`);
    }
    return response;
  }

  // onDelta(textoAcumulado) se llama a medida que llegan trozos.
  async function chat(messages, { temperature = 0.2, maxTokens = 500, timeoutMs = 120_000, onDelta = null } = {}) {
    if (!configured()) throw new Error('La IA no está configurada. Completa AI_BASE_URL, AI_API_KEY y AI_MODEL.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await post({ messages, temperature, max_tokens: maxTokens, stream: true }, controller.signal);
      const type = response.headers.get('content-type') || '';
      let answer = '';
      let usedModel = model;
      if (!type.includes('text/event-stream') || !response.body) {
        const payload = await response.json();
        answer = String(payload?.choices?.[0]?.message?.content || '');
        usedModel = payload?.model || model;
      } else {
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            let event;
            try { event = JSON.parse(data); } catch { continue; }
            usedModel = event.model || usedModel;
            const piece = event.choices?.[0]?.delta?.content || '';
            if (piece) {
              answer += piece;
              onDelta?.(answer);
            }
          }
        }
      }
      answer = answer.trim();
      if (!answer) throw new Error('El modelo no entregó una respuesta final visible.');
      return { answer, model: usedModel, elapsedMs: Date.now() - started };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('El servidor de IA tardó demasiado en responder.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // Una consulta mínima mantiene el modelo cargado en la GPU: sin ella, Ollama
  // lo descarga tras unos minutos sin uso y la siguiente pregunta tarda ~1 min.
  async function warm() {
    if (!configured()) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await post({ messages: [{ role: 'user', content: 'ok' }], max_tokens: 1, stream: false }, controller.signal);
      await response.json().catch(() => ({}));
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  return { configured, chat, warm };
}
