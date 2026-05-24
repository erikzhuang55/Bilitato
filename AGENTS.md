# Repository Instructions

## Git Commits

When creating commits in this repository, always use Conventional Commits:

```text
<type>[optional scope]: <short description>
```

Allowed types:

- `feat`: add a feature
- `fix`: fix a bug
- `docs`: documentation changes
- `style`: formatting-only changes
- `refactor`: code restructuring without behavior changes
- `perf`: performance improvements
- `test`: tests
- `build`: build or dependency changes
- `ci`: CI configuration
- `chore`: maintenance

Keep the description concise and start it with a verb. Do not add a body or footer unless the user asks for one.

Examples:

```text
feat: add extension e2e smoke test
fix: handle missing subtitle timeline
test: cover provider adapter error cases
chore: update release build script
```
