// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD9Dbg3jSaoXd8wWObgsVKv_2g2L-tpbZ8",
  authDomain: "paddockscan.firebaseapp.com",
  projectId: "paddockscan",
  storageBucket: "paddockscan.firebasestorage.app",
  messagingSenderId: "467483184710",
  appId: "1:467483184710:web:6936967ac1ca259c6c4447",
  measurementId: "G-JKX1XVX9L1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
