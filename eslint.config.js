import antfu from '@antfu/eslint-config'

export default antfu({
  markdown: false, // Disable linting markdown files
  ignores: [
    '**/*.md',
    'docs/**',
    'coverage/**',
    'build/**',
  ],
})
