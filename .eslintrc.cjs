// ESLint config (eslintrc format, ESLint 8). Uses .cjs so it loads as
// CommonJS despite "type": "module" in package.json.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    browser: true,
    es2022: true,
    webextensions: true,
  },
  rules: {
    // Allow intentionally-empty catch blocks (used for best-effort DOM/messaging
    // calls that may fail when Instagram swaps the DOM or the SW is asleep).
    'no-empty': ['error', { allowEmptyCatch: true }],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
  overrides: [
    {
      files: ['tests/**/*.js'],
      env: { node: true },
      globals: {
        vi: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    {
      files: ['*.cjs', '*.config.js', 'esbuild.config.js'],
      env: { node: true },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '**/*.bundle.js', '**/*.bundle.js.map'],
};
