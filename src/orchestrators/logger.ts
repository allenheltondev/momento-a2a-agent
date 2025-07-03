/**
 * Simple debug logger for orchestrator classes
 */
export class OrchestratorLogger {
  private debug: boolean;
  private prefix: string;

  constructor(debug: boolean = false, prefix: string = '') {
    this.debug = debug;
    this.prefix = prefix ? `[${prefix}] ` : '';
  }

  /**
   * Debug-level logging - only shown when debug is enabled
   */
  log(...args: any[]) {
    if (this.debug) {
      console.log(`${this.prefix}DEBUG:`, ...args);
    }
  }

  /**
   * Info-level logging - only shown when debug is enabled
   */
  info(...args: any[]) {
    if (this.debug) {
      console.info(`${this.prefix}INFO:`, ...args);
    }
  }

  /**
   * Warning-level logging - always shown
   */
  warn(...args: any[]) {
    console.warn(`${this.prefix}WARN:`, ...args);
  }

  /**
   * Error-level logging - always shown
   */
  error(...args: any[]) {
    console.error(`${this.prefix}ERROR:`, ...args);
  }

  /**
   * Creates a child logger with an additional prefix
   */
  child(childPrefix: string): OrchestratorLogger {
    const newPrefix = this.prefix ? `${this.prefix.slice(1, -2)}:${childPrefix}` : childPrefix;
    return new OrchestratorLogger(this.debug, newPrefix);
  }

  /**
   * Estimates token count for text (rough approximation)
   * This is a simple heuristic - for production you might want to use a proper tokenizer
   */
  estimateTokens(text: string): number {
    // Rough approximation: 4 characters per token (varies by model and language)
    return Math.ceil(text.length / 4);
  }

  /**
   * Logs token estimation if debug is enabled
   */
  logTokenEstimate(label: string, text: string) {
    if (this.debug) {
      const tokens = this.estimateTokens(text);
      this.log(`${label} estimated tokens: ${tokens} (${text.length} chars)`);
    }
  }

  /**
   * Times a function execution and logs the duration
   */
  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    this.log(`Starting: ${label}`);

    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.log(`Completed: ${label} (${duration}ms)`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(`Failed: ${label} (${duration}ms)`, error);
      throw error;
    }
  }

  /**
   * Times a synchronous function execution and logs the duration
   */
  timeSync<T>(label: string, fn: () => T): T {
    const start = Date.now();
    this.log(`Starting: ${label}`);

    try {
      const result = fn();
      const duration = Date.now() - start;
      this.log(`Completed: ${label} (${duration}ms)`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(`Failed: ${label} (${duration}ms)`, error);
      throw error;
    }
  }
}
