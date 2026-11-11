module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['api.js', 'db.js', 'cli.js'],
  coverageReporters: ['text', 'text-summary'],
  coverageThreshold: {
    global: {
      lines: 100
    }
  }
};