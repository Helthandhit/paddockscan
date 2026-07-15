# Firebase production setup

Use the same Firebase project as the PaddockScan Android app.

## 1. Register the website

1. Open Firebase Console → Project settings.
2. Under **Your apps**, add a Web app.
3. Name it `PaddockScan Website`.
4. Copy the displayed configuration values into `site-config.js`.
5. Add `paddockscan.com`, `www.paddockscan.com` and your GitHub Pages hostname to Authentication → Settings → Authorised domains.

The Firebase Web API key is designed to be present in browser code. Security comes from Authentication, App Check and the included Firestore/Storage rules.

## 2. Authentication

Enable **Authentication → Sign-in method → Google**. Select the project support email and save.

## 3. Firestore and Storage

Create Firestore in production mode and enable Cloud Storage. Deploy the supplied `firestore.rules` and `storage.rules` using Firebase CLI, or paste them into the corresponding Rules editors in Firebase Console.

Cloud Storage may require the Firebase project to use the Blaze billing plan. Set budget alerts and upload limits before launch.

## 4. Give your account Owner Hub access

The website checks for a Firebase Authentication custom claim named `admin` with value `true`.

Use a trusted Firebase Admin environment, such as Cloud Shell, to run the following once. Replace `YOUR_UID` with the UID shown in Owner Hub → Settings after signing in.

```js
const admin = require('firebase-admin');
admin.initializeApp();
admin.auth().setCustomUserClaims('YOUR_UID', { admin: true })
  .then(() => console.log('PaddockScan admin enabled'));
```

Sign out and back in after setting the claim.

## 5. Optional App Check

Create a reCAPTCHA Enterprise or reCAPTCHA v3 web provider in Firebase App Check, then paste its site key into `appCheckSiteKey` in `site-config.js`. Test Authentication and uploads before enforcing App Check.

## 6. Android app hand-off

Add a button to the result screen that opens:

`https://paddockscan.com/#submit`

Later, pass non-sensitive draft fields in a Firestore draft owned by the signed-in UID rather than placing vehicle or user data in the URL.
