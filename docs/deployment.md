# Deploying MealMuster

A staged runbook: set up a real Firebase project, deploy to a **preview
channel**, prove the two things the emulators cannot, and only then go live.
Nothing here sends invitations. The organiser creates and shares every link.

Commands use `npx firebase ... --project prod`. Keep `.firebaserc`'s `default`
pointing at `demo-mealmuster`, so a forgotten `--project` fails harmlessly
instead of deploying somewhere unexpected.

## 0. Decide first

| Decision | Notes |
| --- | --- |
| Which Google account owns the project | Not the same as which account the Firebase CLI is signed in to (`npx firebase login:list`). The project is hard to move later. |
| Project id | Cannot be renamed. The display name can. |
| Region | `europe-west2` (London) for Firestore and Functions. **The Firestore location cannot be changed afterwards.** The code assumes `europe-west2`. |
| Domain | `<id>.web.app` works. A custom domain is optional and can come later. |
| Backups | A Firestore backup or point-in-time recovery keeps deleted personal data. That undercuts "we delete names after the event". Decide deliberately and say so in the privacy notice. |
| First owner | The email address of the person who will approve the menu. |

## 1. Create the project (console, you)

1. Firebase console, **Add project**. Skip Google Analytics.
2. **Upgrade to Blaze** (Cloud Functions and Secret Manager need it) and set a
   **budget alert** straight away. `maxInstances` is capped at 10 in the code.
3. **Firestore**: create a database in `europe-west2`, **production mode**. If
   the wizard pre-ticks a weekly backup, untick it unless you decided otherwise.
   Backups are your decision. The reference deployment used **daily, kept for
   14 days**. Create a schedule after the database exists, then read the
   retention back (`1209600s` is 14 days):
   ```
   gcloud firestore backups schedules create --database="(default)" --recurrence=daily --retention=14d --project=<your-project-id>
   gcloud firestore backups schedules list --database="(default)" --project=<your-project-id>
   ```
   Consequence to state in the privacy notice: when an organiser deletes
   guests' details, copies remain in backups for up to 14 days.
4. **Authentication**: enable **Email/Password** only. Then Settings, User
   actions, switch off **Enable create (sign-up)**, so strangers cannot make
   accounts. (An account alone grants nothing, but there is no reason to allow
   it. If the option is not offered, it sits behind the Identity Platform
   upgrade link.)
5. **Authentication, Users**: add the organiser's account with a strong
   password. There is no in-app password reset, so use the console's
   "send password reset email" when needed.
6. **Project settings, Your apps**: register a **web app** and copy its config.
7. **Hosting**: click Get started (nothing to install; the CLI deploys).

## 2. Configure locally (you, then me)

1. `.firebaserc`: add an alias, keeping the demo default:
   ```json
   { "projects": { "default": "demo-mealmuster", "prod": "<your-project-id>" } }
   ```
2. `web/.env.production` (git-ignored): copy `web/env.example` and fill in the
   three `VITE_FIREBASE_*` values. The API key is public by design. The deploy
   **refuses to build** if they are missing, point at a demo project or
   localhost, or if `VITE_USE_AUTH_EMULATOR` is true.
3. `functions/.env.<your-project-id>` (git-ignored):
   ```
   ALLOWED_ORIGINS=https://<id>.web.app,https://<id>.firebaseapp.com
   ```
   Only these origins may redeem links and save bookings.
4. The secret that keys link hashes and sessions. Generate and store it without
   it ever appearing on screen:
   ```
   node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" | npx firebase functions:secrets:set MEALMUSTER_SECRET --project prod --data-file -
   ```
   Never change it casually: **rotating it invalidates every link and session**.
   That is also your emergency off-switch.
5. Before any deploy, from a clean tree: `npm run check`, `npm test`,
   `npm run test:e2e`, `npm run test:csp`. All must pass. Commit first, so what
   is deployed is what is tracked.

## 3. Deploy the back end

```
npx firebase deploy --only firestore --project prod
npx firebase deploy --only functions --project prod
```

- Firestore deploys the deny-all rules. Clients never touch the database.
- Functions run `scripts/sync-shared.js` first (the shared code is generated
  and git-ignored, so without that the function would crash on start).
- The first functions deploy on a new project can end with a cleanup-policy
  error. Run `npx firebase functions:artifacts:setpolicy --location europe-west2 --force`
  and deploy again.

## 4. Deploy to a preview channel (not live)

```
node scripts/check-build-env.js
npm run build
npx firebase hosting:channel:deploy preview --expires 7d --project prod
```

The output gives a URL like `https://<id>--preview-<hash>.web.app`. Add it to
`ALLOWED_ORIGINS` (comma separated) in `functions/.env.<id>` and redeploy the
functions. The preview's domain is added to Authentication's authorised domains
by itself.

## 5. Prove what the emulators could not

The local Hosting emulator neither applies the `headers` block nor passes a
function's `Set-Cookie`. Both are unproven until now.

First create a throwaway event in its own organisation. This needs Application
Default Credentials for the real project, which you run yourself:
```
gcloud auth application-default login
gcloud auth application-default set-quota-project <id>
```
(On this machine gcloud may need `CLOUDSDK_PYTHON` set to its bundled Python.)
Then, dry run first:
```
node scripts/prod-setup.js --project <id> --owner <organiser-email> --smoke
node scripts/prod-setup.js --project <id> --owner <organiser-email> --smoke --yes
```
It writes a fictitious RSVP-only event and owner access to `smoke-test-org`. It
uses `create`, so it never overwrites anything.

Then, on the preview URL:

1. **Headers.** `curl -I <preview-url>/` shows `content-security-policy`,
   `strict-transport-security`, `x-frame-options`, `permissions-policy` and the
   rest of the set in `firebase.json`. `curl -I <preview-url>/api/session` shows
   `cache-control: no-store`.
2. **Organiser sign-in** works at `/admin` and lists "MealMuster smoke test".
3. **Create a link** for the smoke event and open it in a private window.
4. **The session cookie.** In DevTools, Application, Cookies: `__session` is
   present, HttpOnly, Secure, SameSite=Strict, and survives a reload. Reply
   "attending" and reload: the reply is still there.
5. **Revoke** the link in the dashboard; opening it again must fail.
6. **Exports** download; **delete personal data** works after closing the event.
7. No errors in the browser console or in Functions logs.

If `__session` is missing or does not survive a reload, **stop**. Hosting is not
passing the cookie and the invitee flow needs a different design. Tell me before
going further.

When satisfied, remove the test event:
```
node scripts/prod-setup.js --project <id> --owner <organiser-email> --remove-smoke --yes
```

## 6. Go live

```
npx firebase deploy --only hosting --project prod
```

Then put the real event in place (dry run first, as before):
```
node scripts/prod-setup.js --project <id> --owner <organiser-email> --example-event
node scripts/prod-setup.js --project <id> --owner <organiser-email> --example-event --yes
```
This creates the Example Social Club draft: **unapproved, not open, no links**. It
uses `create`, so re-running never overwrites checks or approval the organiser
has made. From here it is the organiser's work, in the app: see
`docs/example-event.md`. Links stay blocked until the menu is approved and the
date, contact and deadlines are set.

## 7. Before real people use it

- The club answers the open questions in `docs/example-event.md`.
- A person runs the screen-reader script in `docs/accessibility.md`.
- A privacy notice names the data controller and retention. The app tells guests
  the organiser will delete their details after the event: make that true
  (delete from the dashboard, or run retention) and decide on backups.
- Schedule or diarise the retention purge (`POST /api/admin/retention/purge`).
- Check the budget alert and read the Functions logs after the first real
  replies.

## Rolling back

- **Site:** Hosting console, Release history, roll back to the previous release.
- **Back end:** redeploy the previous commit's functions.
- **Emergency stop:** rotate `MEALMUSTER_SECRET` (all links and sessions stop
  working), or revoke links one by one in the dashboard.
- Nothing is destroyed by any of these. Data is only deleted by an owner's
  explicit action.
