# Contributing to Project Ars

Thanks for helping improve Project Ars.

## Development setup

1. Fork the repository and create a feature branch from `main`.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure local environment:
   ```bash
   cp .env.example .env
   ```
4. Start the app:
   ```bash
   npm run dev
   ```

## Before opening a pull request

- Keep changes focused and scoped to one objective.
- Run the relevant checks locally:
  ```bash
  npm run typecheck
  npm test
  ```
- Update documentation when behavior or setup changes.
- Do not commit secrets (`.env`, API keys, tokens, private keys).

## Pull request guidelines

- Use a clear title and describe:
  - what changed,
  - why it changed,
  - how to test it.
- Link related issues when applicable.
- Prefer small PRs over large cross-cutting changes.

## Reporting security issues

Please do not open public issues for vulnerabilities. Follow [SECURITY.md](./SECURITY.md).
