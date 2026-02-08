module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'refactor']],
    'subject-max-length': [2, 'always', 100],
    'subject-min-length': [2, 'always', 3],
  },
};
