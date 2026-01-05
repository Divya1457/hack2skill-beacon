// 🔹 1. IMPORTS (TOP ONLY)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
  
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  onSnapshot,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// Your Config
const firebaseConfig = {
  apiKey: "AIzaSyDfO1ODSCZdlnrAiMMDniyGktlzwzDauVg",
  authDomain: "beacon-51711.firebaseapp.com",
  projectId: "beacon-51711",
  storageBucket: "beacon-51711.firebasestorage.app",
  messagingSenderId: "1060082393824",
  appId: "1:1060082393824:web:7a6b260100c157456ba685"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 🔹 Get room assigned to a company
async function getCompanyRoom(companyId) {
  const snap = await getDoc(doc(db, "companies", companyId));
  if (!snap.exists()) return "Not assigned";
  return snap.data().room || "Not assigned";
}

const statusText = document.getElementById("status");
// 🔔 Notification memory (prevents repeat popups)
const queueNotified = {}; 

// 1. AUTH STATE OBSERVER
onAuthStateChanged(auth, async (user) => {
  const authSection = document.getElementById("authSection");
  const profileSection = document.getElementById("profileSection");

  // ✅ admin.html does not have these → exit safely
  if (!authSection || !profileSection) return;

  if (user) {
    authSection.style.display = "none";
    profileSection.style.display = "block";
    document.getElementById("sidebar").style.display = "block";

    const snap = await getDoc(doc(db, "students", user.uid));

    if (snap.exists()) {
      const d = snap.data(); // ✅ declared first

      // If profile incomplete
      if (!d.branch || !d.cpi) {
        document.getElementById("companyList").innerHTML =
          "<p>Please complete your profile to view companies.</p>";
        document.getElementById("applicationsList").innerHTML = "";
        return;
      }

      // Autofill profile
      document.getElementById("name").value = d.name || "";
      document.getElementById("roll").value = d.roll || "";
      document.getElementById("branch").value = d.branch || "";
      document.getElementById("cpi").value = d.cpi || "";
      document.getElementById("skills").value = (d.skills || []).join(", ");
      document.getElementById("resume").value = d.resumeLink || "";

      // Load eligible companies
      const companies = await fetchActiveCompanies();
      const eligibleCompanies = getEligibleCompanies(d, companies);
      await renderCompanies(eligibleCompanies);

      // Load applications
      await renderMyApplications(user.uid);
    }
  } else {
    // User logged out
    document.getElementById("authSection").style.display = "block";
    document.getElementById("profileSection").style.display = "none";
    document.getElementById("sidebar").style.display = "none";

  }
});



// 2. SIGNUP LOGIC
const signupBtn = document.getElementById("signupBtn");
if (signupBtn) {
  signupBtn.onclick = async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);

      await setDoc(doc(db, "users", cred.user.uid), {
        email: email,
        role: "student"
      });

      await setDoc(doc(db, "students", cred.user.uid), {
        name: "",
        roll: "",
        branch: "",
        cpi: 0,
        email: email,
        skills: [],
        resumeLink: "",
        verified: false
      });

      statusText.innerText = "Account Created!";
    } catch (e) {
      statusText.innerText = "Signup Error: " + e.message;
    }
  };
}



// 3. LOGIN LOGIC
const loginBtn = document.getElementById("loginBtn");
if (loginBtn) {
  loginBtn.onclick = async () => {
    try {
      await signInWithEmailAndPassword(
        auth,
        document.getElementById("email").value,
        document.getElementById("password").value
      );
      statusText.innerText = "Logged in!";
    } catch (e) {
      statusText.innerText = "Login Error: " + e.message;
    }
  };
}


// 4. SAVE PROFILE LOGIC (The critical part)
const saveProfileBtn = document.getElementById("saveProfile");
if (saveProfileBtn) {
  saveProfileBtn.onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;

    statusText.innerText = "Saving...";

    try {
      await setDoc(doc(db, "students", user.uid), {
        name: document.getElementById("name").value,
        roll: document.getElementById("roll").value,
        branch: document.getElementById("branch").value,
        cpi: parseFloat(document.getElementById("cpi").value) || 0,
        skills: document.getElementById("skills").value
          .split(",")
          .map(s => s.trim())
          .filter(s => s !== ""),
        resumeLink: document.getElementById("resume").value
      }, { merge: true });

      statusText.innerText = "Profile updated successfully!";
    } catch (e) {
      console.error(e);
      statusText.innerText = "Update Failed.";
    }
  };
}


// 5. LOGOUT
const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) {
  logoutBtn.onclick = () => {
    for (const k in queueNotified) delete queueNotified[k];
    signOut(auth);
  };
}


// 6.2 FETCH ACTIVE COMPANIES FROM FIRESTORE
async function fetchActiveCompanies() {
  const q = query(
    collection(db, "companies"),
    where("active", "==", true)   // ✅ lowercase
  );

  const snapshot = await getDocs(q);
  const companies = [];

  snapshot.forEach(docSnap => {
    companies.push({
      id: docSnap.id,
      ...docSnap.data()
    });
  });

  return companies;
}


// 6.3 FILTER ELIGIBLE COMPANIES (SAFE)
function getEligibleCompanies(student, companies) {
  const studentBranch = student.branch.trim().toUpperCase();

  return companies.filter(company => {
    // ⛔ skip invalid company docs
    if (
      !company.eligiblebranches ||
      !Array.isArray(company.eligiblebranches) ||
      typeof company.mincpi !== "number"
    ) {
      return false;
    }

    return (
      company.eligiblebranches
        .map(b => b.trim().toUpperCase())
        .includes(studentBranch) &&
      student.cpi >= company.mincpi
    );
  });
}




// 6.5 DISPLAY COMPANIES (with Apply / Applied state)
async function renderCompanies(companies) {
  const container = document.getElementById("companyList");
  container.innerHTML = "";

  if (!companies || companies.length === 0) {

    container.innerHTML = "<p>No eligible companies available.</p>";
    return;
  }

  const user = auth.currentUser;

  for (const company of companies) {
    const div = document.createElement("div");

    // 🔹 check if already applied
    let applied = false;
    if (user) {
      applied = await hasAlreadyApplied(user.uid, company.id);

    }

    div.innerHTML = `
      <h3>${company.name}</h3>
      <p><b>Role:</b> ${company.role}</p>
      <p><b>Salary:</b> ${company.salary}</p>
      <p><b>Rounds:</b> ${company.rounds}</p>

      ${
        applied
          ? `<button disabled>Applied</button>`
          : `<button onclick="applyToCompany('${company.id}')">Apply</button>`
      }

      <hr/>
    `;

    container.appendChild(div);
  }
}


// 8.3.1 FETCH STUDENT QUEUE STATUS
async function fetchMyQueueStatus(userId, companyId) {
  const ref = doc(db, "queues", companyId, "students", userId);
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;
  return snap.data();
}
// 8.3 CHECK IF STUDENT IS IN QUEUE
async function getQueueStatus(companyId, userId) {
  const studentRef = doc(db, "queues", companyId, "students", userId);
  const snap = await getDoc(studentRef);

  if (!snap.exists()) {
    return { inQueue: false };
  }

  const data = snap.data();
  return {
    inQueue: true,
    position: data.position,
    status: data.status
  };
}



// 6.6 APPLY TO COMPANY
async function applyToCompany(companyId) {
  const user = auth.currentUser;
  if (!user) return;

  // Prevent duplicate applications
  const alreadyApplied = await hasAlreadyApplied(user.uid, companyId);
  if (alreadyApplied) {
    alert("You have already applied to this company.");
    return;
  }

  try {
    // 1️⃣ Save application
    await setDoc(doc(db, "applications", `${user.uid}_${companyId}`), {
      studentId: user.uid,
      companyId: companyId,
      status: "applied",
      appliedAt: new Date()
    });

    // 2️⃣ Add student to queue
    console.log("ADDING TO QUEUE:", companyId, user.uid);
    await addStudentToQueue(companyId, user.uid);
    console.log("ADDED TO QUEUE");

    alert("Applied successfully!");

    // 3️⃣ Refresh UI
    await renderMyApplications(user.uid);

    const snap = await getDoc(doc(db, "students", user.uid));
    const companies = await fetchActiveCompanies();
    renderCompanies(getEligibleCompanies(snap.data(), companies));

  } catch (e) {
    console.error(e);
    alert("Application failed");
  }
}
window.applyToCompany = applyToCompany;


// 7.1 CHECK IF ALREADY APPLIED
async function hasAlreadyApplied(userId, companyId) {
  const snap = await getDoc(doc(db, "applications", `${userId}_${companyId}`));
  return snap.exists();
}

// 7.2 FETCH STUDENT APPLICATIONS
async function fetchMyApplications(userId) {
  const q = query(
    collection(db, "applications"),
    where("studentId", "==", userId)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 7.3 RENDER STUDENT APPLICATIONS (FIXED)
async function renderMyApplications(userId) {
  const container = document.getElementById("applicationsList");
  container.innerHTML = "";

  const applications = await fetchMyApplications(userId);

  if (applications.length === 0) {
    container.innerHTML = "<p>No applications submitted yet.</p>";
    return;
  }

  for (const appData of applications) {
    const companySnap = await getDoc(doc(db, "companies", appData.companyId));
    if (!companySnap.exists()) continue;

    const company = companySnap.data();
    const room = company.room || "Not assigned";

    const card = document.createElement("div");
    card.className = "application-card";

    // ✅ NO infinite loading anymore
    card.innerHTML = `
      <h4>${company.name}</h4>
      <p><b>Role:</b> ${company.role}</p>
      <p><b>Room:</b> ${room}</p>
      <p><b>Application Status:</b> ${appData.status}</p>

      <div class="queue-box">
        <p><b>Queue Status:</b> Checking…</p>
        <p><b>Queue Position:</b> —</p>
      </div>

      <hr/>
    `;

    container.appendChild(card);

    // ✅ Attach queue listener AFTER DOM exists
    const queueBox = card.querySelector(".queue-box");
    listenToMyQueue(appData.companyId, userId, queueBox);
  }
}

// 8.2 ADD STUDENT TO QUEUE (WRITE POSITION ONCE)
async function addStudentToQueue(companyId, userId) {
  const counterRef = doc(db, "queues", companyId, "meta", "counter");
  const studentRef = doc(db, "queues", companyId, "students", userId);

  await runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);

    let nextPosition = 1;

    if (!counterSnap.exists()) {
      transaction.set(counterRef, { current: 1 });
      nextPosition = 1;
    } else {
      nextPosition = counterSnap.data().current + 1;
      transaction.update(counterRef, { current: nextPosition });
    }

    transaction.set(studentRef, {
      studentId: userId,
      position: nextPosition,   // 🔒 NEVER CHANGES
      status: "waiting",
      joinedAt: new Date()
    });
  });
}
// 8.4 ADVANCE QUEUE (DO NOT TOUCH POSITIONS)
async function advanceQueue(companyId) {
  const studentsRef = collection(db, "queues", companyId, "students");

  const snapshot = await getDocs(studentsRef);
  if (snapshot.empty) return;

  const waiting = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.status === "waiting")
    .sort((a, b) => a.position - b.position);

  if (waiting.length === 0) return;

  // Mark ONLY the first waiting student as done
  await setDoc(
    doc(db, "queues", companyId, "students", waiting[0].id),
    { status: "done" },
    { merge: true }
  );
}
window.advanceQueue = advanceQueue;
async function skipCurrentStudent(companyId) {
  const studentsRef = collection(db, "queues", companyId, "students");

  const snapshot = await getDocs(studentsRef);
  if (snapshot.empty) return;

  const waiting = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.status === "waiting")
    .sort((a, b) => a.position - b.position);

  if (waiting.length === 0) return;

  await setDoc(
    doc(db, "queues", companyId, "students", waiting[0].id),
    { status: "skipped" },
    { merge: true }
  );
}
window.skipCurrentStudent = skipCurrentStudent;

function listenToMyQueue(companyId, userId, queueBox) {
  const studentsRef = collection(db, "queues", companyId, "students");

  // 🔹 Fetch company name ONCE
  let companyNameCache = companyId;
  getDoc(doc(db, "companies", companyId)).then((snap) => {
    if (snap.exists()) {
      companyNameCache = snap.data().name || companyId;
    }
  });

  onSnapshot(studentsRef, (snapshot) => {
    // If queue collection does not exist or empty
    if (snapshot.empty) {
      queueBox.innerHTML = `
        <p><b>Queue Status:</b> Not started</p>
        <p><b>Queue Position:</b> —</p>
      `;
      return;
    }

    const all = snapshot.docs.map(d => d.data());
    const me = all.find(s => s.studentId === userId);

    // ✅ Student not in queue
    if (!me) {
      queueBox.innerHTML = `
        <p><b>Queue Status:</b> Not in queue</p>
        <p><b>Queue Position:</b> —</p>
      `;
      return;
    }

    // ✅ Interview finished or skipped
    if (me.status === "done" || me.status === "skipped") {
      queueBox.innerHTML = `
        <p><b>Queue Status:</b> ${me.status}</p>
        <p><b>Queue Position:</b> X</p>
      `;
      return;
    }

    // ✅ Waiting → compute live position
    const ahead = all.filter(
      s => s.status === "waiting" && s.position < me.position
    ).length;

    const displayPosition = ahead + 1;

    // 🔔 Notify with company name
    maybeNotify(companyId, companyNameCache, displayPosition);
    sendQueueEmail({
      studentEmail: auth.currentUser.email,
      studentName: document.getElementById("name")?.value || "Student",
      companyName: companyNameCache,
      position: displayPosition
    });

    queueBox.innerHTML = `
      <p><b>Queue Status:</b> ${me.status}</p>
      <p><b>Queue Position:</b> ${displayPosition}
        ${displayPosition === 1 ? " 🔔 Please report to the interview room" : ""}
      </p>
    `;
  });
}

function maybeNotify(companyId, companyName, position) {
  const notifyAt = [8, 5, 3, 1];

  if (!notifyAt.includes(position)) return;

  if (!queueNotified[companyId]) {
    queueNotified[companyId] = {};
  }

  // Prevent repeat notification
  if (queueNotified[companyId][position]) return;

  queueNotified[companyId][position] = true;

  const container = document.getElementById("queueNotifications");
  if (!container) return;

  const popup = document.createElement("div");
  popup.className = "queue-popup";

  popup.innerHTML = `
    <span class="close-btn">✕</span>
    <p><b>Queue Update – ${companyName}</b></p>
    <p>Your position is now <b>${position}</b></p>
    ${
      position === 1
        ? "<p>🚨 Please report to the interview room immediately</p>"
        : ""
    }
  `;

  popup.querySelector(".close-btn").onclick = () => popup.remove();

  container.appendChild(popup);
}

const emailSentMemory = {};

function sendQueueEmail({
  studentEmail,
  studentName,
  companyName,
  position
}) {
  const notifyAt = [8, 5, 3, 1]; // 1 = up next (0 ahead)

  if (!notifyAt.includes(position)) return;

  const key = `${studentEmail}_${companyName}_${position}`;
  if (emailSentMemory[key]) return;
  emailSentMemory[key] = true;

  let subject = "";
  let message = "";

  if (position === 8) {
    subject = `Interview Update – ${companyName}`;
    message = "8 candidates are ahead of you. Please stay prepared.";
  }

  if (position === 5) {
    subject = `Interview Update – ${companyName}`;
    message = "Only 5 candidates are ahead of you. Please stay nearby.";
  }

  if (position === 3) {
    subject = `Interview Update – ${companyName}`;
    message = "Only 3 candidates left before your interview. Be ready.";
  }

  if (position === 1) {
    subject = `🚨 You are UP NEXT – ${companyName}`;
    message =
      "You are next in the interview queue. Please report immediately to the interview location.";
  }

  emailjs.send(
    "service_6ug9rmy",
    "template_2o2yvks",
    {
      to_email: studentEmail,
      to_name: studentName,
      company_name: companyName,
      queue_position: position,
      subject: subject,
      message: message
    }
  )
  .then(() => console.log(`📧 Email sent → ${studentEmail} (${companyName})`))
  .catch(err => console.error("❌ Email error:", err));
}

document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.getElementById("sidebar");
  const toggleBtn = document.getElementById("sidebarToggle");

  if (!sidebar || !toggleBtn) return;

  toggleBtn.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    if (isOpen) toggleBtn.classList.add("hidden");
  });

  sidebar.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      sidebar.classList.remove("open");
      toggleBtn.classList.remove("hidden");
    });
  });
});
