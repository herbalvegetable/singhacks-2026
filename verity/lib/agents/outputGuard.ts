function collectSourceNumbers(
  value: unknown,
  numbers: number[] = [],
): number[] {
  if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
  else if (typeof value === "string") {
    numbers.push(...extractProseNumbers(value));
  }
  else if (Array.isArray(value)) {
    value.forEach((item) => collectSourceNumbers(item, numbers));
  } else if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectSourceNumbers(item, numbers),
    );
  }
  return numbers;
}

export function extractProseNumbers(text: string): number[] {
  const withoutIdentifiers = text.replace(
    /\b(?:CL|SIG|PF|EVT|DIV|action)-[A-Z0-9:-]+\b/gi,
    "",
  );
  return [...withoutIdentifiers.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => Number(match[0].replaceAll(",", "")))
    .filter(Number.isFinite);
}

export function numbersAreTraceable(
  text: string,
  source: unknown,
  toleranceRatio = 0.005,
): boolean {
  const sourceNumbers = collectSourceNumbers(source);
  return extractProseNumbers(text).every((candidate) =>
    sourceNumbers.some((expected) => {
      const tolerance = Math.max(0.01, Math.abs(expected) * toleranceRatio);
      return Math.abs(candidate - expected) <= tolerance;
    }),
  );
}
