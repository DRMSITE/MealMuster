# Security policy

## Reporting a vulnerability

Please **do not** open a public issue or pull request for a security problem. A public report tells everyone about a weakness before anyone has had the chance to close it, and the people running this software are volunteers organising a meal, not a security team.

Use GitHub's private reporting: on the repository, choose **Security**, then **Report a vulnerability**. Include what you found, how to reproduce it, and what it could allow. If you cannot use that, contact DRMSITE LTD through [drmsite.com](https://drmsite.com) and ask for a private way to send the details. Please test only against your own deployment and your own data.

You can expect an acknowledgement within a few working days. This is a small project maintained by a small company, so I cannot promise a fix by a particular date, but I will tell you what I decide and credit you if you wish.

## What counts

Especially welcome are ways around the checks the server relies on: the Origin and CSRF checks, link revocation and expiry, and the rule that organiser access comes only from server-written membership records. Reading or changing another event's or organisation's data counts, as does a link token surviving in a URL, a log or a response after it has been redeemed, a way to guess or enumerate links, cross-site scripting, and anything that leaks a guest's details to a third party or into an export that should not carry them.

Some things are not vulnerabilities in MealMuster, though they may still matter to you. A private link works like a key, so anyone holding it can edit that booking, and the application says so; that is documented behaviour. Weaknesses in someone's own Firebase or Google account set-up, an organiser misusing their own access, and the behaviour of Google's services are also outside it.

## Supported versions

Only the latest release receives security fixes while the project is at version 0.x. There are too few people working on it to look after older ones as well.

## If you run MealMuster

You are the data controller for your own deployment. Read [docs/security.md](docs/security.md) and [docs/deployment.md](docs/deployment.md), publish a privacy notice, and decide your backup retention deliberately, since a backup keeps deleted guest details until it expires. Keep your dependencies and deployment up to date, because a fix I publish protects nobody who has not installed it, and turn on GitHub's secret scanning and push protection for your fork. If you suspect `MEALMUSTER_SECRET` has leaked, rotate it: that invalidates every link and session, which is the point.
