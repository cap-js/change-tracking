const isJavaEnv = /java/i.test(process.env.CDS_ENV || '');
const javaOverrides = isJavaEnv
  ? {
      hookTimeout: 10 * 60_000,
      teardownTimeout: 60_000,
      maxWorkers: 1,
      isolate: false,
      fileParallelism: false
    }
  : {};

export default {
  test: {
    silent: true,
    testTimeout: 120_000,
    setupFiles: ['./tests/setup-java.js'],
    ...javaOverrides
  }
};
