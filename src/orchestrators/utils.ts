export interface SanitizationOptions {
  preserveThinkingTags?: boolean;
}

export function sanitizeResponse(text: string, options: SanitizationOptions = {}): string {
  if (options.preserveThinkingTags) {
    return text.trim();
  }
  return text.replace(/<thinking>[\s\S]*?<\/thinking>\s*/g, '').trim();
}
