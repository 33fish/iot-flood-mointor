importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");

importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");
 
firebase.initializeApp({

  apiKey: "AIzaSyDBaSsi_F1ij7fyZEpx-ZgIezEVvEeVOBI",

  authDomain: "flood-monitoring-system-6fd9b.firebaseapp.com",

  projectId: "flood-monitoring-system-6fd9b",

  storageBucket: "flood-monitoring-system-6fd9b.firebasestorage.app",

  messagingSenderId: "710760027385",

  appId: "1:710760027385:web:79820a660f7cebc239be28",

  measurementId: "G-7HHDB6PFKX"

});
 
const messaging = firebase.messaging();
 
messaging.onBackgroundMessage((payload) => {

  console.log("Background message received:", payload);
 
  self.registration.showNotification(

    payload.notification?.title || "Smart Flood Sentinel Alert",

    {

      body: payload.notification?.body || "Flood alert received.",

      icon: "/icon.png"

    }

  );

});
 