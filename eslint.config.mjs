import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out/**', '**/coverage/**', '**/.turbo/**', '**/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: [
      'apps/server/**/*.ts',
      'apps/desktop/**/*.ts',
      'apps/android/scripts/**/*.mjs',
      '*.mjs',
      'tools/**/*.mjs',
    ],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // 웹 코드는 Electron을 직접 쓰지 않는다. 데스크톱 기능은 src/platform을 거친다.
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { paths: ['electron'] }],
    },
  },
  {
    // Capacitor(안드로이드 앱) 플러그인도 src/platform에서만 쓴다 (브라우저에서는 불러오지 않게).
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/platform/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: ['electron'], patterns: [{ group: ['@capacitor/*'] }] },
      ],
    },
  },
);
