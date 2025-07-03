import { vi } from 'vitest';

process.exit = vi.fn((_code?: number | string | null | undefined) => {
  console.warn(`⚠️ process.exit suppressed in tests`);
}) as unknown as typeof process.exit;
