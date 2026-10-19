# Quantum Bot

React/Vite dashboard on Cloudflare Pages; Express/execution engine on Botkeep; authenticated Cloudflare Worker/D1 storage and Telegram status ingress.

```sh
npm ci
npm run check
npm run evaluate
```

Use Node 22.12+ (CI uses Node 22). Build output is separated: `dist/` is public UI, `build/server.cjs` is the backend. Start with `npm start` after configuring `.env.example` values securely. Public account registration is disabled; operator provisioning and persistent auth storage are documented below.

- [Operating and deployment guide](docs/OPERATIONS.md)
- [Roadmap implementation and outstanding work](docs/ROADMAP_IMPLEMENTATION.md)
- [Strategy/council evaluation findings](docs/EVALUATION_RESULTS.md)

The synthetic evaluation suite does not establish profitability. Hosted integrations, historical validation and a staging reliability exercise remain required before real-money operation. Older deployment guides may describe retired endpoints/authentication flows; use OPERATIONS.md for this version.
