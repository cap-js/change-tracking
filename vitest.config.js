export default {
  test: {
    silent: true,
    testTimeout: 120_000,
    hookTimeout: 100_000,
    setupFiles: ['./tests/setup-java.js']
  }
};
