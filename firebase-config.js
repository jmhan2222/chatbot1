import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js';

// Firebase 콘솔 → 프로젝트 설정 → 웹 앱 추가 후 아래 값을 채워넣으세요
const firebaseConfig = {
    apiKey: "AIzaSyDjjYL5VS-88wl3KhhQMgnIJGEmvbRk2vs",
    authDomain: "chatbot-7aacc.firebaseapp.com",
    projectId: "chatbot-7aacc",
    storageBucket: "chatbot-7aacc.firebasestorage.app",
    messagingSenderId: "118233272903",
    appId: "1:118233272903:web:eb3aad5634a126ff631762"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
