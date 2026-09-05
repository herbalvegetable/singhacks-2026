const INTERNAL_REFERENCE_TAG =
  /[\[(](?:client|signal|holding|mandate|facility|cash_need|commitment|transaction|note|narrative|diversification):[^)\]\r\n]+[\])]/gi;

export function stripInternalReferenceTags(text: string): string {
  return text
    .replace(INTERNAL_REFERENCE_TAG, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function stripInternalReferenceTagsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return stripInternalReferenceTags(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(stripInternalReferenceTagsDeep) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        stripInternalReferenceTagsDeep(child),
      ]),
    ) as T;
  }
  return value;
}
