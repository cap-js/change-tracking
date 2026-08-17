export default {
  test: {
    silent: true,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    setupFiles: ['./tests/setup-java.js']
  }
};
