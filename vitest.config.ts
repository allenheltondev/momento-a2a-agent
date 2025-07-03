import { defineConfig } from 'vitest/config';
import path from 'node:path';

const providerStub = path.resolve(
  __dirname,
  'test/__stubs__/tracingProvider.ts',
);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@openai\/agents-core\/.*\/tracing\/provider(\.js|\.ts)?$/,
        replacement: providerStub,
      },
    ],
  },

  test: {
    setupFiles: ['./test/setup.ts']
  }
});
