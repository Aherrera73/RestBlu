// Registro por consola con hora local y un origen corto: [tcp], [api], etc.
function stamp() {
  return new Date().toLocaleString('es-CL', { hour12: false });
}

export function createLogger(scope, sink = console) {
  const line = (message) => `${stamp()} [${scope}] ${message}`;
  return {
    info: (message) => sink.log(line(message)),
    warn: (message) => sink.warn(line(message)),
    error: (message, error) => sink.error(line(error ? `${message}: ${error.message || error}` : message)),
  };
}

export const silentLogger = { info() {}, warn() {}, error() {} };
