# Accessibility

Target: WCAG 2.2 AA, on desktop and mobile, for both the invitee journey and
the organiser area.

## What is checked automatically

`npm run test:e2e` runs `tests/e2e/a11y.spec.js` on a desktop and a mobile
browser. It covers every significant screen: the invitee form, error summary,
review, confirmation, closed event and invalid link, and every organiser
screen. The checks are in `tests/e2e/a11y-helpers.js`.

| Check | WCAG | How |
| --- | --- | --- |
| Markup rules (names, roles, labels, contrast, ARIA) | many | axe-core with all WCAG 2.0 to 2.2 A and AA rules |
| Page title is specific and differs between views | 2.4.2 | each view and state sets its own title |
| One `h1`, no skipped heading levels, landmarks, `lang` | 1.3.1, 2.4.6, 3.1.1 | DOM inspection |
| No sideways scrolling at 320 CSS px (400% zoom) | 1.4.10 | viewport resize; data tables scroll inside their own wrapper |
| Nothing clipped with the required text spacing | 1.4.12 | injects the WCAG spacing CSS |
| Targets at least 24 by 24 px (44 px used for radios, checkboxes and links) | 2.5.8 | bounding boxes of every control |
| Every keyboard stop shows a visible focus indicator | 2.4.7, 2.4.13 | pixel comparison of each stop with and without focus; also in forced-colours mode |
| Nothing animates when reduced motion is requested | 2.3.3 | `getAnimations()` |
| Forced-colours mode keeps controls usable | 1.4.11 | axe and focus checks under `forced-colors: active` |
| A whole order can be placed with the keyboard alone | 2.1.1 | Tab, Space, Enter only, desktop |
| Chosen options are shown on review | 3.3.4 | the sauce choice appears before submitting |
| Each error links to the thing to fix, focus moves there | 3.3.1, 2.4.3 | click the summary link, check focus |
| Focus is not lost when the form changes | 2.4.3 | after a choice the focus returns to the same control; after submitting it moves to the confirmation |
| Long unbroken text wraps | 1.4.10 | hostile long strings in the XSS tests |

The audit tests itself: `the audit itself detects known accessibility defects`
feeds the helpers a deliberately bad page and fails if any of them stops
noticing a problem.

## What the pass found and fixed

- **Every page had the same title** ("MealMuster"). Each view and state now has a
  specific one, for example "Check your order: Demo Club Dinner – MealMuster".
- **Radios and checkboxes were 20 px tall**, under the 24 px minimum and cramped
  on a phone. They are now at least 44 px. Standalone links were 21 px and are
  now 44 px.
- **Focus was lost after submitting.** The confirmation could not take focus, so
  keyboard and screen-reader users landed on nothing after their Submit button
  vanished. The confirmation is now focused (and announced). The same defect
  had already been fixed for the error summary.
- **Focus was lost after choosing an option.** The form re-renders after a
  choice, and Web Awesome radios only become focusable a moment later. Focus now
  waits for them and returns to the same radio.
- **The review page did not show chosen options**, so a guest could not check
  their sauce before submitting. It does now.
- **Long names widened the page** past the screen on phones. Text now wraps.
- **Errors were a list with no way to reach the fields.** Each is now a link that
  moves focus to the field, or to the diner's heading for choice problems.

## What still needs a person

Automation cannot judge these. Please test on real devices before the first
real event, and record the result here.

1. **Screen readers.** Complete the invitee journey and the organiser dashboard
   with at least: NVDA with Firefox or Chrome on Windows, VoiceOver with Safari
   on iPhone, and TalkBack with Chrome on Android. Check that:
   - the page title is announced on each view;
   - headings and landmarks give a sensible outline (rotor or headings list);
   - each radio, checkbox and field announces its label, group and state;
   - errors are announced when the summary appears, and its links work;
   - the confirmation is announced after submitting;
   - the organiser table reads row by row, with sensible button names such as
     "Revoke for Alex Example".
2. **Real browser zoom** to 200% and 400% with a large text setting.
3. **Windows High Contrast / forced colours** by eye, and dark mode.
4. **Voice control** (Voice Control on iOS, Windows Voice Access): say the visible
   label of a button or field. Accessible names start with the visible text.
5. **Copy.** Read the guest wording aloud for plain language, and confirm the
   allergy wording is acceptable to the club.

## Known limitations

- **Field-level error messages.** Problems are listed in the summary with links,
  but the individual fields are not marked `aria-invalid` or tied to their
  message with `aria-describedby`. The summary is the reliable route today.
- **Web Awesome internals.** Controls such as `wa-radio` and `wa-input` keep
  their native elements in a shadow root. Their accessibility comes from the
  library; axe and the keyboard tests pass, but a screen-reader check is the real
  confirmation.
- **Session length.** An invitee session lasts two hours. After that, saving
  fails with a message asking them to open their link again. Edits not yet saved
  are kept on the page while it stays open, but a warning before expiry is not
  built.
- **Printing.** The printable summary hides navigation and keeps each booking
  together, but it has not been tried on paper.
