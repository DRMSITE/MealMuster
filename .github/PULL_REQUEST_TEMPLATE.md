## What and why

<!-- A sentence or two on what changed and the reason for it. Link the issue if there is one. -->

## Checks run

<!-- Tick what you ran, and say plainly if something could not be run. -->

- [ ] `npm run check` and `npm test`
- [ ] `npm run test:integration` (anything touching `firestore.rules`, the Firestore code or the API)
- [ ] `npm run test:e2e` (anything visible, including accessibility)
- [ ] `npm run test:csp` (anything touching headers, scripts or styles)

## Also

- [ ] Documentation and `CHANGELOG.md` updated if behaviour changed
- [ ] Nothing real is included: no venue's menu or prices, no real people, links, keys or `.env` files
- [ ] Commits are signed off (`git commit -s`)
- [ ] If the security model changed (links, sessions, organiser access, retention), `docs/security.md` and its tests changed with it
