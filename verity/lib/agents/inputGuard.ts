const INSTRUCTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|system|developer)\b/i,
  /\b(?:system|developer|assistant)\s*(?:message|prompt)?\s*:/i,
  /\breveal\s+(?:the\s+)?(?:system|developer)\s+prompt\b/i,
  /\bdo\s+not\s+follow\s+(?:the\s+)?(?:system|developer)\b/i,
  /\bact\s+as\s+(?:an?\s+)?(?:administrator|system|developer)\b/i,
];

export function containsInstructionInjection(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}

export function untrustedDataBlock(
  kind: string,
  id: string,
  text: string,
): string {
  const value = containsInstructionInjection(text)
    ? "[WITHHELD: instruction-like content detected]"
    : text;
  return [
    `BEGIN_UNTRUSTED_${kind.toUpperCase()}_DATA`,
    JSON.stringify({ id, value }),
    `END_UNTRUSTED_${kind.toUpperCase()}_DATA`,
  ].join("\n");
}
