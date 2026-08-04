export function serializeEvaluation(value: unknown, maxLength = 30_000) {
  let serialized: string;

  try {
    serialized = JSON.stringify(value, (_key, nestedValue) => {
      if (nestedValue instanceof Uint8Array) {
        return `[binary ${nestedValue.byteLength} bytes]`;
      }

      return nestedValue;
    });
  } catch {
    serialized = String(value);
  }

  return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}…` : serialized;
}
