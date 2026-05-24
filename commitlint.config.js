export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore"
      ]
    ],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."]
  }
};
