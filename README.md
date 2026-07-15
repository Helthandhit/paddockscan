# PaddockScan Community Website

A mobile-first public website and installable Owner Hub for PaddockScan.

## Works immediately

Open `index.html` through a web host and the site runs in **phone preview mode**. Demo sign-in, submissions, moderation, posts, homepage design, reports, backup/export and Car of the Month controls are stored locally in the browser.

## Production mode

Paste the Firebase Web App configuration into `site-config.js`, enable Google Authentication, deploy the included Firestore and Storage rules, and add the administrator custom claim. The same Firebase project can be shared with the Android app.

Read `FIREBASE_SETUP.md` and `GITHUB_PHONE_SETUP.md` before going live.
