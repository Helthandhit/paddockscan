/*
  PHONE SETUP: replace the placeholder Firebase values with the Web App config
  shown in Firebase Console > Project settings > Your apps > Web app.
  This configuration is designed to be public. Security is enforced by the
  Firestore and Storage rules included in this package, not by hiding this file.
*/
window.PADDOCKSCAN_CONFIG = {
  firebase: {
    apiKey: "PASTE_WEB_API_KEY",
    authDomain: "paddockscan.firebaseapp.com",
    projectId: "paddockscan",
    storageBucket: "paddockscan.firebasestorage.app",
    messagingSenderId: "467483184710",
    appId: "PASTE_WEB_APP_ID"
  },
  appCheckSiteKey: "",
  domain: "paddockscan.com",
  contactEmail: "paddockscan@gmail.com",
  playStoreUrl: "https://play.google.com/apps/testing/com.healthandhit.paddockscan"
};
