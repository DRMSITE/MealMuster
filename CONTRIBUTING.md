# Contributing to MealMuster

Thank you for thinking of it. MealMuster does one job: someone organising a meal invites people, collects their replies and meal choices, and hands the venue a clear order. I would like it to stay small enough that a volunteer organiser can run it, so contributions that fit that are welcome, from bug reports to documentation to code, and the smaller ones are often the most useful.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately ([SECURITY.md](SECURITY.md)), not as public issues, since a public report tells everyone about a hole before anyone has had the chance to close it.

## Before you start

- **Bugs and ideas:** open an issue first for anything bigger than a small fix, so that we can agree it fits before you spend time on it. A week's work that does not fit helps nobody.
- **Documentation fixes** are very welcome, especially where the set-up steps did not work for you. That is a bug in the documentation, and nobody finds it more reliably than someone who has just followed it.
- **Nothing real in the repository.** Tests, seeds, screenshots and examples use made-up people, venues, menus and prices. A real venue's menu belongs to the venue, and a real guest's details belong to the guest, so neither goes in a commit, an issue or a pull request, however useful it would be as a test.
- Please do not add a framework or a dependency without a clear benefit, because every dependency is something a volunteer has to keep up to date.

## Setting up

You need Node 22 or later, and Java 21 for the Firebase emulators.

```bash
git clone https://github.com/DRMSITE/MealMuster.git
cd MealMuster
npm ci
npm --prefix functions ci
npx playwright install chromium    # once, for the browser tests
```

Everything runs against the Firebase emulators with made-up data, and nothing here needs a Firebase project of your own. Read [README.md](README.md), [docs/security.md](docs/security.md) and [AGENTS.md](AGENTS.md) first. The last was written for AI coding assistants, though it is also the shortest list of the project's rules, and people have been known to read it too.

## Checks

Run these before opening a pull request, and say which you ran:

```bash
npm run check           # Biome and the JSDoc type check
npm test                # unit tests
npx firebase emulators:exec --only auth,firestore --project demo-mealmuster "npm run test:integration"
npm run test:e2e        # anything visible, including accessibility
npm run test:csp        # anything touching headers, scripts or styles
```

Pull requests are checked by the same commands on GitHub. On Windows the Firestore emulator's Java process can outlive a run, and the next run then reports "port taken": stop that one process and try again.

- **Add or update a test** when behaviour changes, and test what the software does rather than how it does it, so that a tidy-up does not break the suite.
- **Accessibility is a requirement** (WCAG 2.2 AA), not a finishing touch: keyboard use, visible focus, labelled controls, a useful page title, no colour-only meaning, reduced motion respected, and usable at 320px wide. If you can try it with a real screen reader, the script in [docs/accessibility.md](docs/accessibility.md) still needs doing, and the result would be very welcome.
- **Security changes** (links, sessions, organiser access, retention, the headers) need tests, and must keep `docs/security.md` in step, because the server is the real boundary and the browser only mirrors it.
- Use **UK English** in text, comments and documentation. Formatting is Biome (2 spaces, double quotes), and `npm run format` applies it.

## Pull requests

- Keep each pull request to one concern, with a short description of what changed and why, so that a reviewer can say yes or no in one sitting.
- Update the documentation and [CHANGELOG.md](CHANGELOG.md) when behaviour changes.
- Do not commit anything particular to one organiser or venue: no `.env` files, keys, invitation links or real menus.

## Sign off your commits (Developer Certificate of Origin)

By contributing you confirm that you have the right to, under the project's licence
(AGPL-3.0-or-later). Add a sign-off to each commit with `git commit -s`, which adds a line:

```
Signed-off-by: Your Name <you@example.org>
```

That line means you agree to the Developer Certificate of Origin 1.1:

> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I have the right to submit it
> under the open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of my knowledge, is covered
> under an appropriate open source license and I have the right under that license to submit that
> work with modifications, whether created in whole or in part by me, under the same open source
> license (unless I am permitted to submit under a different license), as indicated in the file; or
>
> (c) The contribution was provided directly to me by some other person who certified (a), (b) or
> (c) and I have not modified it.
>
> (d) I understand and agree that this project and the contribution are public and that a record of
> the contribution (including all personal information I submit with it, including my sign-off) is
> maintained indefinitely and may be redistributed consistent with this project or the open source
> license(s) involved.

(Developer Certificate of Origin, version 1.1. Copyright 2004, 2006 The Linux Foundation and its
contributors.) A check on each pull request looks for the sign-off.
