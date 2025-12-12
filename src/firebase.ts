import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBAet0suTRzfrSp2hh7gerb3yYEMhN1FoA",
  authDomain: "sensor-dht20.firebaseapp.com",
  databaseURL: "https://sensor-dht20-default-rtdb.firebaseio.com",
  projectId: "sensor-dht20",
  storageBucket: "sensor-dht20.appspot.com",
  messagingSenderId: "229098521370",
  appId: "1:229098521370:web:1c383374b0d6b8d713a2a3",
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);
