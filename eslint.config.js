// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Flat config (pattern shared with bms-core / bms-editor / bms-electron-app).
 * Baseline: js + typescript-eslint recommended. Rules downgraded to "warn"
 * reflect pre-existing patterns in this codebase — tighten incrementally.
 */
export default tseslint.config(
    { ignores: ['dist/', 'coverage/', 'node_modules/'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: { ecmaFeatures: { jsx: true } },
            globals: {
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                AudioWorkletProcessor: 'readonly',
                registerProcessor: 'readonly',
                sampleRate: 'readonly',
            },
        },
        plugins: { 'react-hooks': reactHooks },
        rules: {
            // Classic pair only — matches bms-editor; v7's newer recommended
            // rules are deferred.
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
        },
    },
);
