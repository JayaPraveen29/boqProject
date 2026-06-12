import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAN-2D3nfTkWvWOnhHH3UEjqfNC6061tvI",
  authDomain: "byqpro.firebaseapp.com",
  projectId: "byqpro",
  storageBucket: "byqpro.firebasestorage.app",
  messagingSenderId: "251704458815",
  appId: "1:251704458815:web:5f2d056084073ed3c4028a"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);