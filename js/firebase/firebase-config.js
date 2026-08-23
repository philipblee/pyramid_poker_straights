// Import the functions you need from the SDKs you need

//import { initializeApp } from "firebase/app";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyABHwEeiywm_dFSQo0whN-hCQT0yziw8fU",
  authDomain: "pyramid-poker-straights.firebaseapp.com",
  databaseURL: "https://pyramid-poker-straights-default-rtdb.firebaseio.com/",
  projectId: "pyramid-poker-straights",
  storageBucket: "pyramid-poker-straights.firebasestorage.app",
  messagingSenderId: "347706752532",
  appId: "1:347706752532:web:a261304871487755623101"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Export for use in other files
window.firebaseAuth = firebase.auth();
window.firebaseDb = firebase.firestore();

console.log('🔥 Firebase initialized successfully');