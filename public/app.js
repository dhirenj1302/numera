const $ = (s, el=document) => el.querySelector(s);
const app = $("#app");
const NUMERA_VERSION = "v2.39";
const state = {
  files: [],
  sourceImages: [],
  draft: JSON.parse(localStorage.getItem("numera:draft")||"null"),
  editingHomeworkId: localStorage.getItem("numera:editingHomeworkId") || null,
  homework: null,
  studentName: "",
  studentUsername: localStorage.getItem("numera:studentUsername") || "",
  setterSession: JSON.parse(localStorage.getItem("numera:setterSession")||"null"),
  reviewerSession: JSON.parse(localStorage.getItem("numera:reviewerSession")||"null"),
  index: 0,
  attempts: [],
  selected: null,
  phase: "answer",
  practiceQuestion: null,
  pendingSubmission: null,
  multipartAnswers: {},
  interactiveAnswers: {},
  matchingSelections: {},
  voiceEnabled: localStorage.getItem("numera:voiceEnabled") === "true"
};

// Persist the review draft so a page refresh doesn't lose the teacher's reviewed
// questions. The draft can be large (it carries per-question image data URLs), so
// we guard against quota errors and simply skip persistence if it won't fit
// rather than breaking the app.
function saveDraft(){
  try{
    if(state.draft){
      localStorage.setItem("numera:draft", JSON.stringify(state.draft));
      if(state.editingHomeworkId) localStorage.setItem("numera:editingHomeworkId", state.editingHomeworkId);
      else localStorage.removeItem("numera:editingHomeworkId");
    }
  }catch(e){ /* quota exceeded (large images) — refresh-restore just won't be available */ }
}
function clearDraft(){
  state.draft=null;
  localStorage.removeItem("numera:draft");
  localStorage.removeItem("numera:editingHomeworkId");
}

const cropEditor = {
  questionIndex: null,
  box: {x: 0.08, y: 0.08, width: 0.84, height: 0.60},
  startBox: null,
  pointerStart: null,
  mode: null
};

function preferredVoice(){
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.find(v => /^en-GB/i.test(v.lang) && /female|serena|samantha|karen|moira|google uk english female/i.test(v.name))
    || voices.find(v => /^en-GB/i.test(v.lang))
    || voices.find(v => /^en/i.test(v.lang))
    || null;
}

function speak(text, force=false){
  if (!("speechSynthesis" in window) || (!state.voiceEnabled && !force)) return;
  window.speechSynthesis.cancel();
  // Clean the text for speech: remove HTML, and blanks written as runs of
  // underscores/dashes (a "fill in the missing number" gap) which a screen reader
  // otherwise announces as "underline underline underline". Read them as a short
  // pause instead of saying anything.
  const spoken = String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/_{2,}/g, " ")           // "____" blank -> pause
    .replace(/\b_\b/g, " ")           // a lone underscore
    .replace(/[–—]{2,}/g, " ")        // long dash runs used as blanks
    .replace(/\u2212/g, " minus ")    // true minus sign U+2212 -> spoken "minus"
    .replace(/(\d)\s*[-−]\s*(\d)/g, "$1 minus $2") // a hyphen/minus between numbers -> "minus"
    .replace(/[×✕✖]/g, " times ")     // multiplication sign -> "times"
    .replace(/÷/g, " divided by ")    // division sign
    .replace(/\s*,\s*,\s*/g, ", ")    // collapse a comma left orphaned by a removed blank
    .replace(/,\s*([,.?!])/g, "$1")   // remove a comma stranded before other punctuation
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.?!])/g, "$1")    // no space before punctuation
    .trim();
  if(!spoken) return;
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = "en-GB";
  utterance.rate = 0.92;
  utterance.pitch = 1.05;
  const voice = preferredVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

function voiceControl(label="Teacher voice"){
  const icon = state.voiceEnabled ? "🔊" : "🔈";
  const status = state.voiceEnabled ? "On" : "Off";
  return `<button class="btn voice-btn" onclick="toggleVoice()">${icon} ${label}: ${status}</button>`;
}

window.toggleVoice = () => {
  state.voiceEnabled = !state.voiceEnabled;
  localStorage.setItem("numera:voiceEnabled", String(state.voiceEnabled));
  if (!state.voiceEnabled && "speechSynthesis" in window) window.speechSynthesis.cancel();
  if (state.voiceEnabled) speak("Hello! I can read the questions and help you in a calm, friendly way.", true);
  if (state.homework && state.studentName && state.index < state.homework.questions.length) renderQuestion();
};

window.readCurrentQuestion = () => {
  const q = state.homework?.questions?.[state.index];
  if (q) speak(`Question ${state.index + 1}. ${q.prompt}`, true);
};

const api = async (url, options={}) => {
  // Client-side timeout so the UI can never hang forever if the backend is killed
  // mid-request (e.g. the reader Worker exceeding its time budget). Extraction is
  // slow, so allow generous time, but always resolve to an error eventually.
  const { timeoutMs = 60000, headers, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {"Content-Type":"application/json", ...(headers||{})},
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === "AbortError") throw new Error("This took too long and timed out. Please check your connection and try again.");
    throw e;
  }
  clearTimeout(timer);
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
};

const uid = () => Math.random().toString(36).slice(2,8).toUpperCase();

const shell = (content, back=false) => {
  // back can be:
  //   false        -> no back button
  //   true         -> default route-stack back (appBack)
  //   "someFn()"   -> a custom handler, e.g. returnToCurrentQuestion(), used by
  //                   in-place screens (correction, hint) that are NOT their own
  //                   route and must return to the current question, not home.
  const backHandler = back === true ? "appBack()" : (typeof back === "string" ? back : null);
  return `
<div class="app-shell">
  <header class="topbar">
    <div class="row">
      ${backHandler ? `<button class="btn ghost" onclick="${backHandler}" aria-label="Go back">←</button>` : ""}
      <a class="brand-link" href="#/" aria-label="Numera home"><div class="brand">numera<span>.</span></div><div class="tagline">Homework that teaches.</div></a>
    </div>
    <span class="pill green">Prototype <span style="opacity:.7;font-weight:600">${NUMERA_VERSION}</span></span>
  </header>
  <main>${content}</main>
  <div class="footer-note">Every mistake is a step forward.</div>
</div>`;
};


const NUMERA_STACK_KEY = "numera:routeStack";

function currentRoute(){
  return location.hash || "#/";
}

function readRouteStack(){
  try{
    const stack=JSON.parse(sessionStorage.getItem(NUMERA_STACK_KEY)||"[]");
    return Array.isArray(stack)?stack:[];
  }catch{return [];}
}

function writeRouteStack(stack){
  sessionStorage.setItem(NUMERA_STACK_KEY,JSON.stringify(stack.slice(-30)));
}

function rememberRoute(route){
  const stack=readRouteStack();
  if(stack[stack.length-1]!==route){
    stack.push(route);
    writeRouteStack(stack);
  }
}

window.appBack = () => {
  const stack=readRouteStack();
  const now=currentRoute();

  while(stack.length && stack[stack.length-1]===now) stack.pop();
  const previous=stack.pop();
  writeRouteStack(stack);

  if(previous){
    location.hash=previous;
    return;
  }

  // A homework link may have been opened directly from WhatsApp.
  // In that case, keep the user inside Numera rather than closing the app.
  if(now.startsWith("#/play") || now.startsWith("#/results")){
    location.hash="#/";
  }else if(now!=="#/"){
    location.hash="#/teacher";
  }else{
    location.hash="#/";
  }
};

function installBackGuard(){
  if(sessionStorage.getItem("numera:backGuardInstalled")==="1") return;
  sessionStorage.setItem("numera:backGuardInstalled","1");

  const initial=currentRoute();
  // Put a safe Numera page immediately behind a directly opened deep link.
  if(initial!=="#/"){
    history.replaceState({numeraFallback:true},"","#/");
    history.pushState({numeraRoute:true},"",initial);
  }else{
    history.replaceState({numeraRoute:true},"",initial);
  }
}

installBackGuard();
rememberRoute(currentRoute());

function router() {
  const hash = location.hash || "#/";
  const [path, query] = hash.slice(1).split("?");
  const params = new URLSearchParams(query || "");
  if (path === "/") return renderLanding();
  if (path === "/teacher-signin") return renderSetterAccess({mode:"signin"});
  if (path === "/teacher-access") return renderSetterAccess();
  if (path === "/teacher-account") return renderSetterAccess();
  if (path === "/teacher-dashboard") return renderSetterDashboard();
  if (path === "/students-manage") return renderStudentManager();
  if (path === "/review-access") return renderReviewAccess();
  if (path === "/review-hub") return renderReviewHub();
  if (path === "/student-history") return renderStudentHistory(params.get("username"));
  if (path === "/teacher") return renderTeacher();
  if (path === "/demo") return renderDemoAge();
  if (path === "/history") return renderHomeworkHistory();
  if (path === "/edit-homework") return loadHomeworkForEditing(params.get("id"));
  if (path === "/reuse-homework") return loadHomeworkForReuse(params.get("id"));
  if (path === "/create") return renderUpload();
  if (path === "/review") return renderReview();
  if (path === "/published") return renderPublished();
  if (path === "/play") return loadHomework(params.get("id"), params.get("preview")==="1"?"preview":"play");
  if (path === "/results") return loadHomework(params.get("id"), "results");
  if (path === "/owner") return renderOwnerDashboard();
  renderNotFound(path);
}
window.addEventListener("hashchange",()=>{
  rememberRoute(currentRoute());
  router();
});
window.addEventListener("popstate",()=>{
  const route=currentRoute();
  if(route==="#/" || !route){
    rememberRoute("#/");
    setTimeout(router,0);
  }
});

// OWNER dashboard: correction intelligence across all teachers. Gated by an
// owner key (kept only in this browser's localStorage after first entry). This
// is where the platform owner sees what the reader gets wrong most often and
// decides what warrants a systemic prompt fix. Read-only.
async function renderOwnerDashboard(){
  const savedKey=localStorage.getItem("numera:ownerKey")||"";
  if(!savedKey){
    app.innerHTML=shell(`
      <section class="mobile-page-head"><span class="step-chip">Owner</span><h1>Correction dashboard</h1><p class="muted">Enter the owner key to view correction patterns across all teachers.</p></section>
      <div class="card">
        <label>Owner key</label>
        <input id="ownerKeyInput" type="password" placeholder="Owner key" autocomplete="off">
        <button class="btn primary block" style="margin-top:12px" onclick="saveOwnerKey()">View dashboard</button>
      </div>`,true);
    return;
  }
  app.innerHTML=shell(`<section class="mobile-page-head"><span class="step-chip">Owner</span><h1>Correction dashboard</h1><p class="muted">Loading…</p></section>`,true);
  try{
    const r=await api(`/api/admin-corrections?key=${encodeURIComponent(savedKey)}`);
    const t=r.totals||{};
    const savedHrs=Math.round((Number(t.total_questions_reviewed||0)*2)/60);
    const fieldRows=(r.by_field||[]).map(f=>`<div class="impact-row"><span class="impact-num" style="font-size:22px">${f.n}</span><span class="impact-label">${esc(f.field)} corrections</span></div>`).join("");
    const themeRows=(r.themes||[]).map(x=>`<tr><td>${esc(x.question_topic||"—")}</td><td>${esc(x.field)}</td><td style="text-align:right;font-weight:700">${x.n}</td></tr>`).join("");
    const recentRows=(r.recent||[]).map(x=>`<tr><td>${esc(x.question_topic||"—")}</td><td>${esc(x.field)}</td><td>${esc((x.ai_value||"").slice(0,40))}</td><td>${esc((x.teacher_value||"").slice(0,40))}</td></tr>`).join("");
    app.innerHTML=shell(`
      <section class="mobile-page-head"><span class="step-chip">Owner</span><h1>Correction dashboard</h1><p class="muted">What the reader gets corrected on, across all teachers.</p></section>
      <div class="card impact-card">
        <div class="impact-row"><span class="impact-num">${t.total_corrections||0}</span><span class="impact-label">total corrections from ${t.teachers_correcting||0} teacher${t.teachers_correcting===1?"":"s"}</span></div>
        <div class="impact-row"><span class="impact-num">${t.total_questions_reviewed||0}</span><span class="impact-label">questions reviewed &middot; ~${savedHrs} hours of marking saved</span></div>
      </div>
      <div class="card"><h3 style="margin-top:0">Where the reader is weakest</h3>${fieldRows||"<p class='muted'>No corrections yet.</p>"}</div>
      <div class="card"><h3 style="margin-top:0">Most-corrected topics</h3>
        <p class="muted" style="font-size:13px">High counts here are candidates for a systemic prompt fix.</p>
        <table class="owner-table"><thead><tr><th>Topic</th><th>Field</th><th style="text-align:right">Count</th></tr></thead><tbody>${themeRows||"<tr><td colspan='3' class='muted'>None yet.</td></tr>"}</tbody></table>
      </div>
      <div class="card"><h3 style="margin-top:0">Recent corrections (before → after)</h3>
        <table class="owner-table"><thead><tr><th>Topic</th><th>Field</th><th>AI read</th><th>Teacher fixed</th></tr></thead><tbody>${recentRows||"<tr><td colspan='4' class='muted'>None yet.</td></tr>"}</tbody></table>
      </div>
      <button class="btn secondary block" onclick="clearOwnerKey()">Sign out of owner view</button>
    `,true);
  }catch(e){
    const unauth=/not authorised|401/i.test(String(e.message));
    app.innerHTML=shell(`
      <section class="mobile-page-head"><span class="step-chip error-chip">Owner</span><h1>Couldn’t load</h1><p class="muted">${esc(e.message)}</p></section>
      <button class="btn primary block" onclick="clearOwnerKey()">${unauth?"Re-enter owner key":"Try again"}</button>`,true);
  }
}
window.saveOwnerKey=()=>{const k=$("#ownerKeyInput")?.value.trim();if(!k)return;localStorage.setItem("numera:ownerKey",k);renderOwnerDashboard();};
window.clearOwnerKey=()=>{localStorage.removeItem("numera:ownerKey");renderOwnerDashboard();};

function renderNotFound(path){
  app.innerHTML=shell(`
    <section class="mobile-page-head">
      <span class="step-chip">Navigation</span>
      <h1>That page could not be opened</h1>
      <p class="muted">The link may be old or incomplete. Choose where you want to go.</p>
    </section>
    <div class="card navigation-recovery">
      <a class="btn green block" href="#/">Home</a>
      <a class="btn secondary block" href="#/teacher-signin">Teacher sign in</a>
      <a class="btn secondary block" href="#/review-access">Review results</a>
      <a class="btn secondary block" href="#/demo">Try student demo</a>
      <p class="small muted">Route: ${esc(path||"/")}</p>
    </div>
  `,true);
}

function renderLanding(){
  app.innerHTML=shell(`
    <div class="landing2">
      <section class="l-hero">
        <div class="l-eyebrow"><span class="d"></span> Built with teachers, for teachers</div>
        <h1>Homework that <em>marks itself</em> — and teaches while it does.</h1>
        <p class="l-sub">Snap a photo of any maths worksheet. Numera turns it into homework that marks every answer, explains each mistake, and shows you exactly what your class understands.</p>
        <div class="l-cta-row">
          <a class="l-btn l-btn-primary" href="#/teacher-account">Set your first homework</a>
          <a class="l-btn l-btn-ghost" href="#/demo">See a student demo</a>
        </div>
        <div class="l-trust">✎ No email needed to start &nbsp;·&nbsp; Free for your first class</div>
        <div class="l-device">
          <div class="l-screen">
            <div class="l-qcard"><div class="qt">Fractions</div><div class="qn">7/9 − 5/9 = ?</div><span class="l-ok">✓ Correct — first try</span></div>
            <div class="l-qcard"><div class="qt">Place value</div><div class="qn">Write 4602 in words</div><span class="l-hint">◐ Got it with a hint</span></div>
            <div class="l-qcard"><div class="qt">Times tables</div><div class="qn">6 × 5 = ?</div><span class="l-ok">✓ Correct — first try</span></div>
          </div>
        </div>
      </section>

      <section class="l-section">
        <div class="l-kicker">Why teachers love it</div>
        <h2>Less marking. More teaching.</h2>
        <p class="l-secsub">Numera does the part of homework that eats your evenings, so you can spend your time on the part only you can do.</p>
        <div class="l-cards">
          <div class="l-card"><div class="l-ic l-ic1">⏱️</div><h3>Marking done for you</h3><p>Every answer marked the moment a child submits it. No red pen, no pile on your desk on Monday.</p></div>
          <div class="l-card"><div class="l-ic l-ic2">💡</div><h3>Mistakes explained</h3><p>When a child gets stuck, Numera gives a gentle hint — not the answer — so they work it out and learn.</p></div>
          <div class="l-card"><div class="l-ic l-ic3">📊</div><h3>See who understands</h3><p>A clear picture of what each child has grasped and where they need help, built from their real work.</p></div>
        </div>
      </section>

      <section class="l-section">
        <div class="l-how">
          <div class="l-kicker">Up and running in minutes</div>
          <h2>Your worksheet. Their homework. Your evening back.</h2>
          <div class="l-steps">
            <div class="l-step"><div class="sn">1</div><h4>Snap it</h4><p>Photograph any worksheet. Numera reads the questions.</p></div>
            <div class="l-step"><div class="sn">2</div><h4>Check &amp; send</h4><p>Glance over what it read, tweak anything, share one link.</p></div>
            <div class="l-step"><div class="sn">3</div><h4>See the results</h4><p>Children get instant feedback; you see how the class did.</p></div>
          </div>
        </div>
      </section>

      <section class="l-final">
        <h2>Ready to stop marking?</h2>
        <p>Set your first homework in the next five minutes. No email, no card, no catch.</p>
        <a class="l-btn l-btn-primary" href="#/teacher-account">Set your first homework</a>
      </section>

      <section class="l-section" style="padding-top:20px">
        <p class="l-secsub" style="margin-bottom:0;font-size:14.5px">Reviewing work you've already set? <a href="#/review-access" style="color:var(--l-violet);font-weight:800;text-decoration:none">Open the review area →</a></p>
      </section>
    </div>
  `);
}

function renderDemoAge(){
  const ages=[4,5,6,7,8,9,10,11];
  app.innerHTML=shell(`
    <section class="mobile-page-head demo-age-head">
      <span class="step-chip">Student demo</span>
      <h1>How old is the child?</h1>
      <p class="muted">Numera will create a short maths demo at an appropriate level.</p>
    </section>
    <div class="card demo-age-card">
      <div class="age-choice-grid">
        ${ages.map(age=>`<button class="age-choice" onclick="startDemo(${age})"><strong>${age}</strong><span>years old</span></button>`).join("")}
      </div>
      <p class="small muted demo-age-note">The demo contains five questions and shows how Numera teaches, gives progressive hints and helps improve a score.</p>
    </div>
  `,true);
}


window.startDemo = async age => {
  const selectedAge=Number(age);
  if(!Number.isInteger(selectedAge) || selectedAge<4 || selectedAge>11){
    location.hash="#/demo";
    return;
  }
  try {
    app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Preparing an age-${selectedAge} demo…</h2><p class="muted">Numera is choosing suitable questions.</p></div>`,true);
    const demo = await api("/api/demo", {
      method:"POST",
      body:JSON.stringify({age:selectedAge})
    });
    location.hash = `#/play?id=${demo.id}`;
  } catch(e) {
    alert(e.message);
    location.hash="#/demo";
  }
};


function pinInput(id,label="Four-digit PIN"){
  return `<div class="field"><label>${label}</label><input id="${id}" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="••••"></div>`;
}
function validPin(pin){return /^\d{4}$/.test(String(pin||""));}

function renderSetterAccess(options={}){
  const existing=state.setterSession;
  const signInOnly=options.mode==="signin";

  app.innerHTML=shell(`
    <section class="mobile-page-head">
      <span class="step-chip">Teacher account</span>
      <h1>${existing?`Welcome back, ${esc(existing.display_name)}`:signInOnly?"Teacher sign in":"Create or manage homework"}</h1>
      <p class="muted">${existing
        ?"Open your dashboard to set and review work."
        :"Use your teacher username and four-digit PIN. No email address is required for this prototype."}</p>
    </section>

    ${existing?`
      <div class="card">
        <button class="btn green block" onclick="location.hash='#/teacher-dashboard'">Open teacher dashboard</button>
        <button class="btn ghost block" onclick="logoutSetter()">Use another account</button>
      </div>
    `:`
      <div class="access-grid ${signInOnly?"signin-only":""}">
        <form class="card" onsubmit="loginSetter(event)">
          <h2>Teacher sign in</h2>
          <div class="field"><label>Username</label><input id="setterUsername" autocapitalize="none" autocomplete="username" placeholder="e.g. Teacher123"></div>
          ${pinInput("setterPin")}
          <button class="btn primary block">Sign in</button>
          ${signInOnly?`<a class="btn ghost block" href="#/teacher-account">Create a teacher account</a>`:""}
        </form>

        ${signInOnly?"":`
          <form class="card" onsubmit="createSetter(event)">
            <h2>Create a free teacher account</h2>
            <div class="field"><label>Username</label><input id="newSetterUsername" autocapitalize="none" autocomplete="username" placeholder="e.g. Teacher123"></div>
            <div class="field"><label>Name</label><input id="newSetterName" placeholder="e.g. Thomas"></div>
            ${pinInput("newSetterPin")}
            <button class="btn green block">Create account</button>
          </form>
        `}
      </div>
    `}
  `,true);
}

window.createSetter=async e=>{
  e.preventDefault();
  const username=$("#newSetterUsername").value.trim().toLowerCase(),display_name=$("#newSetterName").value.trim(),pin=$("#newSetterPin").value;
  if(!display_name||!validPin(pin))return alert("Enter a name and four-digit PIN.");
  try{
    const session=await api("/api/accounts",{method:"POST",body:JSON.stringify({action:"create_setter",username,display_name,pin})});
    state.setterSession=session;localStorage.setItem("numera:setterSession",JSON.stringify(session));location.hash="#/teacher-dashboard";
  }catch(err){alert(err.message);}
};
window.loginSetter=async e=>{
  e.preventDefault();
  try{
    const session=await api("/api/accounts",{method:"POST",body:JSON.stringify({action:"login_setter",username:$("#setterUsername").value.trim().toLowerCase(),pin:$("#setterPin").value})});
    state.setterSession=session;localStorage.setItem("numera:setterSession",JSON.stringify(session));
    if(state.returnToReviewAfterSignIn && state.draft){
      state.returnToReviewAfterSignIn=false;
      renderReview(); // back to the safe reviewed questions, ready to publish again
    }else{
      location.hash="#/teacher-dashboard";
    }
  }catch(err){alert(err.message);}
};
window.logoutSetter=()=>{state.setterSession=null;localStorage.removeItem("numera:setterSession");location.hash="#/teacher-signin";};

function renderSetterDashboard(){
  const s=state.setterSession;
  if(!s)return location.hash="#/teacher-signin";
  app.innerHTML=shell(`
    <section class="mobile-page-head"><span class="step-chip">Teacher dashboard</span><h1>Hello ${esc(s.display_name)}</h1><p class="muted">Create students, set work and review everyone attached to your account.</p></section>
    <div class="grid">
      <button class="action-card" onclick="location.hash='#/students-manage'"><span class="icon">👥</span><span><strong>Students</strong><br><span class="small muted">Create and manage valid student usernames</span></span></button>
      <button class="action-card" onclick="location.hash='#/teacher'"><span class="icon">＋</span><span><strong>Set homework</strong><br><span class="small muted">Photograph or upload worksheet pages</span></span></button>
      <button class="action-card" onclick="location.hash='#/review-hub'"><span class="icon">📊</span><span><strong>Review work</strong><br><span class="small muted">By student, homework or class ranking</span></span></button>
    </div>
    <button class="btn ghost block" onclick="logoutSetter()">Sign out</button>
  `,true);
}

async function renderStudentManager(){
  const s=state.setterSession;if(!s)return location.hash="#/teacher-signin";
  app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Loading students…</h2></div>`,true);
  try{
    const data=await api(`/api/accounts?setter_username=${encodeURIComponent(s.username)}&token=${encodeURIComponent(s.token)}`);
    app.innerHTML=shell(`
      <section class="mobile-page-head"><span class="step-chip">Teacher students</span><h1>Student usernames</h1><p class="muted">Students must use one of these profiles to complete work assigned by this account.</p></section>
      <form class="card" onsubmit="addSetterStudent(event)">
        <h3>Add a student</h3>
        <div class="field-row-mobile"><div class="field"><label>Username</label><input id="managedStudentUsername" placeholder="e.g. User123"></div><div class="field"><label>Name</label><input id="managedStudentName" placeholder="e.g. Thomas"></div></div>
        ${pinInput("managedStudentPin","Student four-digit PIN")}
        <button class="btn green block">Create student</button>
      </form>
      <div class="history-list">${data.students.length?data.students.map(st=>`<article class="history-card"><div><h3>${esc(st.display_name)}</h3><p class="muted">@${esc(st.username)} · ${st.submission_count||0} completed homework${st.submission_count===1?"":"s"}</p></div><a class="btn secondary" href="#/student-history?username=${encodeURIComponent(st.username)}">View history</a></article>`).join(""):`<div class="empty card">No students yet.</div>`}</div>
    `,true);
  }catch(err){alert(err.message);location.hash="#/teacher-dashboard";}
}
window.addSetterStudent=async e=>{
  e.preventDefault();const s=state.setterSession,pin=$("#managedStudentPin").value;
  if(!validPin(pin))return alert("Choose a four-digit student PIN.");
  try{
    await api("/api/accounts",{method:"POST",body:JSON.stringify({action:"add_student",setter_username:s.username,token:s.token,student_username:$("#managedStudentUsername").value.trim().toLowerCase(),display_name:$("#managedStudentName").value.trim(),pin})});
    renderStudentManager();
  }catch(err){alert(err.message);}
};

function renderReviewAccess(){
  app.innerHTML=shell(`
    <section class="mobile-page-head">
      <span class="step-chip">Review results</span>
      <h1>Whose work are you reviewing?</h1>
      <p class="muted">Teachers can review every student attached to their account. Parents can open one child's history.</p>
    </section>

    <div class="review-role-grid">
      <article class="card review-role-card">
        <div class="review-role-icon">👨‍🏫</div>
        <h2>Teacher</h2>
        <p class="muted">Sign in to review students, homework completion, results and class progress.</p>
        <a class="btn primary block" href="#/teacher-signin">Teacher sign in</a>
      </article>

      <form class="card review-role-card" onsubmit="reviewStudentLogin(event)">
        <div class="review-role-icon">👨‍👩‍👧</div>
        <h2>Parent or individual student</h2>
        <p class="muted">Enter the child's student username and PIN to open their full history.</p>
        <div class="field"><label>Student username</label><input id="reviewStudentUsername" autocapitalize="none" autocomplete="username"></div>
        ${pinInput("reviewStudentPin","Student PIN")}
        <button class="btn green block">Open full history</button>
      </form>
    </div>
  `,true);
}

window.reviewStudentLogin=async e=>{
  e.preventDefault();
  try{
    const session=await api("/api/accounts",{method:"POST",body:JSON.stringify({action:"login_student",username:$("#reviewStudentUsername").value.trim().toLowerCase(),pin:$("#reviewStudentPin").value})});
    state.reviewerSession=session;localStorage.setItem("numera:reviewerSession",JSON.stringify(session));location.hash=`#/student-history?username=${encodeURIComponent(session.username)}`;
  }catch(err){alert(err.message);}
};

async function renderStudentHistory(username){
  const teacher=state.setterSession,reviewer=state.reviewerSession;
  const allowed=(teacher&&teacher.token)||(reviewer&&reviewer.username===username);
  if(!allowed)return location.hash="#/review-access";
  app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Loading history…</h2></div>`,true);
  try{
    const auth=teacher?`setter_username=${encodeURIComponent(teacher.username)}&token=${encodeURIComponent(teacher.token)}`:`student_token=${encodeURIComponent(reviewer.token)}`;
    const data=await api(`/api/review?student_username=${encodeURIComponent(username)}&${auth}`);
    app.innerHTML=shell(`
      <section class="mobile-page-head"><span class="step-chip">Student history</span><h1>${esc(data.student.display_name)}</h1><p class="muted">@${esc(data.student.username)} · ${data.summary.homework_count} completed</p></section>
      <div class="parent-summary-grid"><div class="mini-score"><span>Homeworks</span><strong>${data.summary.homework_count}</strong></div><div class="mini-score"><span>Average original</span><strong>${data.summary.average_original}%</strong></div><div class="mini-score mastery"><span>Average mastery</span><strong>${data.summary.average_mastery}%</strong></div></div>
      ${studentReportMarkup(data)}
      <h2 class="section-label">Completed homework</h2>
      <div class="history-list">${data.results.map(r=>`<article class="history-card"><div><h3>${esc(r.homework_title)}</h3><p class="muted">${esc(r.topic)} · ${r.original_percent}% original · ${r.mastery_percent}% mastery</p></div><a class="btn secondary" href="#/results?id=${encodeURIComponent(r.homework_id)}">Homework results</a></article>`).join("")||`<div class="empty card">No completed work yet.</div>`}</div>
    `,true);
  }catch(err){alert(err.message);location.hash="#/review-access";}
}

// Age-typical misconceptions, keyed to topic keywords. These are GENERAL and
// clearly labelled as "common at this age" — never presented as a diagnosis of
// this particular child. Once real per-child misconception tagging is live
// (see report.observed_misconceptions), that real data is shown ABOVE this,
// and this section stays only as supporting context.
const AGE_TYPICAL_MISCONCEPTIONS={
  fraction:[
    {tag:"bigger denominator = bigger",note:"Many children think 1/4 is larger than 1/2 because 4 is larger than 2. Watch for reasoning about the bottom number as if it were a whole number."},
    {tag:"adding denominators",note:"A very common slip is 1/4 + 1/4 = 2/8 — adding the bottoms as well as the tops."}
  ],
  decimal:[
    {tag:"longer = larger",note:"Children often think 0.45 is bigger than 0.5 because it has more digits."},
    {tag:"decimal point misalignment",note:"When adding decimals, watch for columns not lined up by place value."}
  ],
  "place value":[
    {tag:"digit vs value",note:"Confusing the digit with its value — e.g. the 3 in 36 being treated as 'three' rather than 'thirty'."}
  ],
  multiplication:[
    {tag:"place-value in columns",note:"In column multiplication, forgetting the place-value zero when multiplying by the tens digit."}
  ],
  division:[
    {tag:"remainder handling",note:"Uncertainty about what to do with a remainder — dropping it, or not relating it back to the question."}
  ],
  time:[
    {tag:"analogue–digital gaps",note:"Reading 'quarter to' / 'quarter past' and matching them to digital times is a frequent stumbling point."},
    {tag:"minutes past 60",note:"Adding durations that cross an hour boundary (e.g. 9:25 + 17 min) often trips children up."}
  ],
  coordinate:[
    {tag:"axis order (x,y)",note:"Plotting (2,3) as '3 along, 2 up' — reversing the order of the coordinates."},
    {tag:"counting lines not spaces",note:"Counting grid lines rather than the steps between them."}
  ],
  fractions:[]
};

function ageTypicalFor(topics){
  const seen=new Set(); const out=[];
  for(const t of topics){
    const key=(t.topic||"").toLowerCase();
    for(const bank in AGE_TYPICAL_MISCONCEPTIONS){
      if(key.includes(bank)){
        for(const m of AGE_TYPICAL_MISCONCEPTIONS[bank]){
          if(!seen.has(m.tag)){seen.add(m.tag);out.push({...m,topic:t.topic});}
        }
      }
    }
  }
  return out.slice(0,4);
}

function studentReportMarkup(data){
  const r=data.report;
  if(!r||(data.summary.homework_count===0)){
    return `<div class="report-card"><div class="report-head"><h2>Performance report</h2></div><div class="report-body"><p class="muted">Once ${esc(data.student.display_name)} completes some homework, a short performance report will appear here — highlighting strengths, areas to work on, and common things to look out for at this age.</p></div></div>`;
  }

  // --- Narrative built ONLY from real data ---
  const name=esc((data.student.display_name||"").split(" ")[0]||"This pupil");
  const bits=[];
  const am=data.summary.average_mastery, ao=data.summary.average_original;
  bits.push(`${name} has completed <strong>${data.summary.homework_count}</strong> homework${data.summary.homework_count===1?"":"s"}, averaging <strong>${am}%</strong> once given the chance to try again after feedback (${ao}% on first attempt).`);
  if(am-ao>=8){bits.push(`The jump from ${ao}% to ${am}% is a good sign: ${name} tends to <strong>correct mistakes when given feedback and another go</strong>, which is exactly the behaviour Numera rewards.`);}
  if(r.hint_reliance_pct!==null){
    if(r.hint_reliance_pct>=50){bits.push(`Hints are used on around <strong>${r.hint_reliance_pct}%</strong> of questions — leaning on support quite often, which points to working near the edge of current understanding.`);}
    else if(r.hint_reliance_pct>0){bits.push(`Hints are used on around <strong>${r.hint_reliance_pct}%</strong> of questions — a healthy amount of independent working.`);}
  }
  if(r.recovered_after_retry>0){bits.push(`On <strong>${r.recovered_after_retry}</strong> occasion${r.recovered_after_retry===1?"":"s"}, ${name} got a question wrong first but reached mastery after retrying — resilience worth praising.`);}

  // Brief, SPECIFIC "where the mistakes are" callout — one or two areas, as
  // specific as the real data honestly supports. If misconception tagging is
  // populated, name the actual misconception; otherwise name the weakest topic(s)
  // with their scores. Never a vague or invented diagnosis.
  let focusLine="";
  if(r.has_misconception_tagging && r.observed_misconceptions.length){
    const top=r.observed_misconceptions.slice(0,2).map(m=>`${esc(m.misconception_tag)}${m.concept_key?` (in ${esc(m.concept_key)})`:""}`).join(" and ");
    focusLine=`<div class="report-focus"><span class="report-focus-tag">Where mistakes cluster</span> ${name}'s errors most often show up as <strong>${top}</strong>. That's the most useful thing to work on next.</div>`;
  }else if(r.weakest_topics && r.weakest_topics.length){
    const w=r.weakest_topics.filter(t=>t.avg_mastery<75).slice(0,2);
    if(w.length){
      const named=w.map(t=>`<strong>${esc(t.topic)}</strong> (${t.avg_mastery}%)`).join(" and ");
      focusLine=`<div class="report-focus"><span class="report-focus-tag">Where to focus</span> ${name}'s lowest area${w.length>1?"s are":" is"} ${named}. Short, targeted practice here would help most.</div>`;
    }
  }

  const strong=r.strongest_topics&&r.strongest_topics.length?`<div class="report-row good"><span class="report-k">Strongest so far</span><span>${r.strongest_topics.map(t=>`${esc(t.topic)} (${t.avg_mastery}%)`).join(", ")}</span></div>`:"";
  const weak=r.weakest_topics&&r.weakest_topics.length
    ?`<div class="report-row watch"><span class="report-k">Worth practising</span><span>${r.weakest_topics.map(t=>`${esc(t.topic)} (${t.avg_mastery}%)`).join(", ")}</span></div>`
    :`<div class="report-row good"><span class="report-k">Worth practising</span><span>Nothing stands out yet — full marks so far. 🎉</span></div>`;

  // --- Real per-child misconceptions (only if tagging has populated them) ---
  let observedBlock="";
  if(r.has_misconception_tagging && r.observed_misconceptions.length){
    observedBlock=`<div class="report-sub"><h3>Specific patterns seen in ${name}'s answers</h3>${r.observed_misconceptions.slice(0,4).map(m=>`<div class="mis-observed"><strong>${esc(m.misconception_tag)}</strong> — seen ${m.occurrences} time${m.occurrences===1?"":"s"}${m.concept_key?` in ${esc(m.concept_key)}`:""}.</div>`).join("")}</div>`;
  }

  // --- Age-typical watch-points, keyed to the topics actually attempted ---
  const typical=ageTypicalFor(r.weakest_topics.length?r.weakest_topics:r.strongest_topics);
  let typicalBlock="";
  if(typical.length){
    typicalBlock=`<div class="report-sub"><h3>Common at this age <span class="report-tag-note">general guidance, not specific to ${name}</span></h3>${typical.map(m=>`<div class="mis-typical"><strong>${esc(m.tag)}</strong> <span class="muted">(${esc(m.topic)})</span><br>${esc(m.note)}</div>`).join("")}</div>`;
  }

  // --- Honest status line about the deeper capability that's coming ---
  const capNote = r.has_misconception_tagging
    ? ""
    : `<p class="report-cap-note">As ${name} completes more work, Numera will begin identifying the <em>specific</em> misconceptions behind individual mistakes — not just the topic — and show them here.</p>`;

  return `
    <div class="report-card">
      <div class="report-head"><h2>Performance report</h2><span class="report-updated">to date</span></div>
      <div class="report-body">
        <p class="report-narrative">${bits.join(" ")}</p>
        ${focusLine}
        ${strong}${weak}
        ${observedBlock}
        ${typicalBlock}
        ${capNote}
      </div>
    </div>`;
}

async function renderReviewHub(){
  const s=state.setterSession;if(!s)return location.hash="#/teacher-signin";
  app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Building class review…</h2></div>`,true);
  try{
    const data=await api(`/api/review?setter_username=${encodeURIComponent(s.username)}&token=${encodeURIComponent(s.token)}`);
    app.innerHTML=shell(`
      <section class="mobile-page-head"><span class="step-chip">Teacher review</span><h1>Class overview</h1><p class="muted">View completion by student, by homework and as a class ranking.</p></section>
      <div class="review-tabs"><button class="btn secondary" onclick="showReviewPanel('students')">By student</button><button class="btn secondary" onclick="showReviewPanel('homeworks')">By homework</button><button class="btn secondary" onclick="showReviewPanel('ranking')">Ranking</button></div>
      <div id="reviewStudents" class="review-panel">${data.students.map(st=>`<article class="history-card"><div><h3>${esc(st.display_name)}</h3><p class="muted">${st.completed} completed · ${st.average_mastery}% average mastery</p></div><a class="btn secondary" href="#/student-history?username=${encodeURIComponent(st.username)}">View</a></article>`).join("")||`<div class="empty card">No students yet.</div>`}</div>
      <div id="reviewHomeworks" class="review-panel hidden">${data.homeworks.map(h=>`<article class="history-card"><div><h3>${esc(h.title)}</h3><p class="muted">${h.completed}/${data.students.length} completed · ${h.average_mastery}% average mastery</p></div><a class="btn secondary" href="#/results?id=${encodeURIComponent(h.id)}">Results</a></article>`).join("")||`<div class="empty card">No homework yet.</div>`}</div>
      <div id="reviewRanking" class="review-panel hidden"><div class="ranking-list">${data.ranking.map((st,i)=>`<div class="ranking-row"><span>${i+1}</span><strong>${esc(st.display_name)}</strong><b>${st.average_mastery}%</b></div>`).join("")||`<div class="empty card">No results to rank.</div>`}</div><p class="small muted">Ranking is shown only as an optional class view. Intervention and improvement should remain the main teaching signals.</p></div>
    `,true);
  }catch(err){alert(err.message);}
}
window.showReviewPanel=name=>{
  ["Students","Homeworks","Ranking"].forEach(n=>$("#review"+n)?.classList.toggle("hidden",n.toLowerCase()!==name));
};

function renderTeacher(){
  if(!state.setterSession)return location.hash="#/teacher-signin";
  app.innerHTML = shell(`
    <h1>Good evening 👋</h1>
    <p class="muted">Create the next maths homework for your students.</p>
    <div class="grid" style="margin-top:22px">
      <button class="action-card" onclick="location.hash='#/create'">
        <span class="icon">＋</span><span><strong>New homework</strong><br><span class="muted small">Photograph or upload worksheet pages</span></span>
      </button>
      <button class="action-card" onclick="openLastResults()">
        <span class="icon">📊</span><span><strong>Latest results</strong><br><span class="muted small">Completion and score upgrades</span></span>
      </button>
      <button class="action-card" onclick="location.hash='#/history'">
        <span class="icon">🗂️</span><span><strong>Past homeworks</strong><br><span class="muted small">Open previous homework and class results</span></span>
      </button>
    </div>
    <div class="notice" style="margin-top:24px"><strong>Prototype privacy:</strong> use only Aaryan’s first name and avoid uploading pages containing pupil information.</div>
  `, true);
}
window.openLastResults = () => {
  const id = localStorage.getItem("numera:lastHomework");
  if (!id) return alert("Publish a homework first.");
  location.hash = `#/results?id=${id}`;
};


async function renderHomeworkHistory(){
  app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Loading past homeworks…</h2></div>`,true);
  try{
    const items=await api(`/api/homeworks?list=1&setter_username=${encodeURIComponent(state.setterSession?.username||"")}&t=${Date.now()}`);
    app.innerHTML=shell(`<section class="mobile-page-head"><span class="step-chip">Teacher library</span><h1>Past homeworks</h1><p class="muted">Open a homework to see everyone who completed it.</p></section><div class="history-list">${items.length?items.map(h=>`<article class="history-card"><div><span class="pill">${esc(h.year_group||"Year 4")}</span><h3>${esc(h.title)}</h3><p class="muted">${esc(h.topic||"Mixed maths")} · ${h.question_count} questions · ${h.submission_count} completed</p><p class="small muted">Created ${new Date(h.created_at+"Z").toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}</p></div><div class="history-actions">
  <a class="btn primary" href="#/edit-homework?id=${h.id}">✏ Edit homework</a>
  <a class="btn secondary" href="#/reuse-homework?id=${h.id}">♻ Set for another class</a>
  <a class="btn secondary" href="#/results?id=${h.id}">📊 Results</a>
  <a class="btn secondary" href="#/play?id=${h.id}&preview=1">👁 Student preview</a>
</div></article>`).join(""):`<div class="empty card">No published homeworks yet.</div>`}</div><a class="btn green block" href="#/create">＋ Create new homework</a>`,true);
  }catch(err){app.innerHTML=shell(`<div class="card"><h2>Could not load past homeworks</h2><p>${esc(err.message)}</p></div>`,true);}
}


async function loadHomeworkForEditing(id){
  const session=state.setterSession;
  if(!session) return location.hash="#/teacher-signin";
  if(!id) return location.hash="#/history";

  app.innerHTML=shell(`
    <div class="mission">
      <div class="spinner"></div>
      <h2>Opening homework editor…</h2>
      <p class="muted">Loading every question and teaching setting.</p>
    </div>
  `,true);

  try{
    const homework=await api(
      `/api/homeworks?id=${encodeURIComponent(id)}&setter_username=${encodeURIComponent(session.username)}&setter_token=${encodeURIComponent(session.token)}`
    );
    state.editingHomeworkId=homework.id;state.reusedFromTitle="";
    state.draft={
      title:homework.title,
      topic:homework.topic,
      year_group:homework.year_group,
      questions:normaliseHomeworkQuestions(homework).questions,
      warning:"",
      page_count:Number(homework.settings?.source_pages)||0
    };
    state.sourceImages=[];
    renderReview();
  }catch(error){
    app.innerHTML=shell(`
      <div class="card">
        <h2>Homework could not be opened</h2>
        <p>${esc(error.message)}</p>
        <a class="btn secondary block" href="#/history">Return to homework library</a>
      </div>
    `,true);
  }
}

// Reuse: load an existing homework's questions into a BRAND-NEW draft so the
// teacher can set the same work to another class. Deliberately does NOT set
// editingHomeworkId — so publishing creates a new homework with its own id and
// its own results, leaving the original (and its submissions) untouched. The
// title is pre-suffixed so the two copies are easy to tell apart in the library.
async function loadHomeworkForReuse(id){
  const session=state.setterSession;
  if(!session) return location.hash="#/teacher-signin";
  if(!id) return location.hash="#/history";

  app.innerHTML=shell(`
    <div class="mission">
      <div class="spinner"></div>
      <h2>Setting up a fresh copy…</h2>
      <p class="muted">Loading the questions so you can set this work for another class.</p>
    </div>
  `,true);

  try{
    const homework=await api(
      `/api/homeworks?id=${encodeURIComponent(id)}&setter_username=${encodeURIComponent(session.username)}&setter_token=${encodeURIComponent(session.token)}`
    );
    // New homework, not an edit of the old one.
    state.editingHomeworkId=null;
    state.reusedFromTitle=homework.title||"";
    state.draft={
      title:suggestReuseTitle(homework.title),
      topic:homework.topic,
      year_group:homework.year_group,
      questions:normaliseHomeworkQuestions(homework).questions,
      warning:"",
      page_count:Number(homework.settings?.source_pages)||0
    };
    state.sourceImages=[];
    renderReview();
  }catch(error){
    app.innerHTML=shell(`
      <div class="card">
        <h2>Homework could not be copied</h2>
        <p>${esc(error.message)}</p>
        <a class="btn secondary block" href="#/history">Return to homework library</a>
      </div>
    `,true);
  }
}

// Suggest a distinct title for the reused copy. If the title already ends with a
// "(copy)" or "(copy N)" suffix, bump the number so repeated reuse stays tidy.
function suggestReuseTitle(title){
  const base=String(title||"Year 4 Maths").trim();
  const m=base.match(/^(.*?)\s*\(copy(?:\s*(\d+))?\)\s*$/i);
  if(m){
    const n=m[2]?Number(m[2])+1:2;
    return `${m[1].trim()} (copy ${n})`;
  }
  return `${base} (copy)`;
}

window.renderUpload = () => renderUpload();
function renderUpload(){
  state.editingHomeworkId=null;state.reusedFromTitle="";
  state.files = [];
  state.sourceImages = [];
  app.innerHTML = shell(`
    <section class="mobile-page-head">
      <span class="step-chip">Step 1 of 3</span>
      <h1>Photograph the homework</h1>
      <p class="muted">Place the page flat, fill the camera frame and avoid shadows. You can add up to six pages.</p>
    </section>

    <div class="capture-actions">
      <label class="capture-card primary-capture" for="cameraPages">
        <span class="capture-icon">📷</span>
        <span><strong>Take a photo</strong><small>Best on a phone</small></span>
        <input id="cameraPages" type="file" accept="image/*" capture="environment">
      </label>
      <label class="capture-card" for="galleryPages">
        <span class="capture-icon">🖼️</span>
        <span><strong>Choose photos</strong><small>Add several pages</small></span>
        <input id="galleryPages" type="file" accept="image/*" multiple>
      </label>
    </div>

    <div id="photoHelp" class="photo-help">
      <div>✓ One full page per photo</div>
      <div>✓ Text upright and in focus</div>
      <div>✓ No names or pupil details</div>
    </div>

    <div id="selectedPages" class="selected-pages empty-selection">
      <div class="empty-camera">📄</div>
      <strong>No pages added yet</strong>
      <span class="muted small">Your page previews will appear here.</span>
    </div>

    <div class="mobile-sticky-action">
      <button id="extractBtn" class="btn primary block" disabled>Read questions with AI</button>
      <span id="uploadSummary" class="small muted">Add at least one clear photo</span>
    </div>
  `, true);
  $("#cameraPages").addEventListener("change", e => handleFiles(e, true));
  $("#galleryPages").addEventListener("change", e => handleFiles(e, true));
  $("#extractBtn").addEventListener("click", extractHomework);
}

async function handleFiles(e, append=false){
  const incoming = [...e.target.files].filter(f => f.type.startsWith("image/") || /\.(heic|heif|jpg|jpeg|png|webp)$/i.test(f.name));
  state.files = (append ? [...state.files, ...incoming] : incoming).slice(0,6);
  renderSelectedPages();
  e.target.value = "";
}

function renderSelectedPages(){
  const wrap = $("#selectedPages");
  if (!state.files.length){
    wrap.className = "selected-pages empty-selection";
    wrap.innerHTML = `<div class="empty-camera">📄</div><strong>No pages added yet</strong><span class="muted small">Your page previews will appear here.</span>`;
    $("#extractBtn").disabled = true;
    $("#uploadSummary").textContent = "Add at least one clear photo";
    return;
  }
  wrap.className = "selected-pages";
  wrap.innerHTML = state.files.map((f,i) => {
    const url = URL.createObjectURL(f);
    return `<div class="page-thumb"><img src="${url}" alt="Worksheet page ${i+1}"><span>Page ${i+1}</span><button type="button" aria-label="Remove page ${i+1}" onclick="removePage(${i})">×</button></div>`;
  }).join("") + (state.files.length < 6 ? `<label class="page-thumb add-page" for="galleryPages"><span>＋</span><strong>Add page</strong></label>` : "");
  $("#extractBtn").disabled = false;
  $("#uploadSummary").textContent = `${state.files.length} page${state.files.length===1?"":"s"} ready`;
}

window.removePage = i => { state.files.splice(i,1); renderSelectedPages(); };

async function imageToJpegDataURL(file){
  const source = await new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(new Error("One image could not be opened."));
    reader.readAsDataURL(file);
  });
  return downscaleDataUrl(source, file.name);
}
// Downscale/normalise an image that is ALREADY a data URL (e.g. an image already
// attached to a question), without needing a File object.
async function downscaleDataUrl(source, label="image"){
  const img = await new Promise((resolve,reject)=>{
    const image = new Image(); image.onload=()=>resolve(image); image.onerror=()=>reject(new Error(`Could not read ${label}. Use a JPG, PNG or a fresh camera photo.`)); image.src=source;
  });
  const maxSide=1800;
  const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",0.86);
}

async function visualFromDataURL(dataUrl,bbox,forceFullPage=false){
  const img=await new Promise((resolve,reject)=>{
    const image=new Image(); image.onload=()=>resolve(image); image.onerror=reject; image.src=dataUrl;
  });
  const validBox=Array.isArray(bbox) && bbox.length===4 && !bbox.every(v=>Number(v)===0);
  let x=0,y=0,w=1000,h=1000;
  if(validBox && !forceFullPage){
    [x,y,w,h]=bbox.map(Number);
    x=Math.max(0,Math.min(1000,x)); y=Math.max(0,Math.min(1000,y));
    w=Math.max(1,Math.min(1000-x,w)); h=Math.max(1,Math.min(1000-y,h));
    // Generous padding is important for pictogram keys, graph labels and shape dimensions.
    const pad=70;
    x=Math.max(0,x-pad); y=Math.max(0,y-pad);
    w=Math.min(1000-x,w+pad*2); h=Math.min(1000-y,h+pad*2);
  }
  const sx=Math.round(img.naturalWidth*x/1000), sy=Math.round(img.naturalHeight*y/1000);
  const sw=Math.max(1,Math.round(img.naturalWidth*w/1000)), sh=Math.max(1,Math.round(img.naturalHeight*h/1000));
  const maxSide=980, scale=Math.min(1,maxSide/Math.max(sw,sh));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(sw*scale)); canvas.height=Math.max(1,Math.round(sh*scale));
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",0.82);
}


async function exactVisualFromDataURL(dataUrl,bbox){
  const img=await new Promise((resolve,reject)=>{
    const image=new Image(); image.onload=()=>resolve(image); image.onerror=reject; image.src=dataUrl;
  });
  let [x,y,w,h]=(Array.isArray(bbox)&&bbox.length===4?bbox:[0,0,1000,1000]).map(Number);
  x=Math.max(0,Math.min(1000,x)); y=Math.max(0,Math.min(1000,y));
  w=Math.max(20,Math.min(1000-x,w)); h=Math.max(20,Math.min(1000-y,h));
  const sx=Math.round(img.naturalWidth*x/1000), sy=Math.round(img.naturalHeight*y/1000);
  const sw=Math.max(1,Math.round(img.naturalWidth*w/1000)), sh=Math.max(1,Math.round(img.naturalHeight*h/1000));
  const maxSide=1200, scale=Math.min(1,maxSide/Math.max(sw,sh));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(sw*scale)); canvas.height=Math.max(1,Math.round(sh*scale));
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",0.86);
}

function normalisedBoxFromAI(bbox){
  if(!Array.isArray(bbox) || bbox.length!==4 || bbox.every(v=>Number(v)===0)){
    return {x:0.05,y:0.05,width:0.90,height:0.75};
  }
  let [x,y,w,h]=bbox.map(v=>Number(v)/1000);
  x=Math.max(0,Math.min(.95,x)); y=Math.max(0,Math.min(.95,y));
  w=Math.max(.08,Math.min(1-x,w)); h=Math.max(.08,Math.min(1-y,h));
  return {x,y,width:w,height:h};
}

function clampCropBox(box){
  const min=.06;
  box.width=Math.max(min,Math.min(1,box.width));
  box.height=Math.max(min,Math.min(1,box.height));
  box.x=Math.max(0,Math.min(1-box.width,box.x));
  box.y=Math.max(0,Math.min(1-box.height,box.y));
  return box;
}

function renderCropSelection(){
  const selection=document.querySelector(".crop-selection");
  if(!selection) return;
  const b=clampCropBox({...cropEditor.box});
  cropEditor.box=b;
  selection.style.left=`${b.x*100}%`;
  selection.style.top=`${b.y*100}%`;
  selection.style.width=`${b.width*100}%`;
  selection.style.height=`${b.height*100}%`;
}

window.openCropEditor = i => {
  syncEditors();
  const q=state.draft.questions[i];
  const source=state.sourceImages[Number(q.page_index)];
  if(!source) return alert("The original worksheet page is no longer available. Rescan the page to adjust its image.");
  q.ai_visual_bbox ||= Array.isArray(q.visual_bbox) ? [...q.visual_bbox] : [0,0,1000,1000];
  cropEditor.questionIndex=i;
  cropEditor.box=q.visual_user_box
    ? {...q.visual_user_box}
    : normalisedBoxFromAI(q.visual_bbox);
  const overlay=document.createElement("div");
  overlay.className="crop-editor-overlay";
  overlay.innerHTML=`
    <div class="crop-editor-shell">
      <header class="crop-editor-header">
        <button class="btn ghost" type="button" onclick="closeCropEditor()">✕</button>
        <div><strong>Adjust worksheet image</strong><small>Question ${i+1} · ${esc(q.source_label||`Page ${Number(q.page_index)+1}`)}</small></div>
        <button class="btn primary crop-save-top" type="button" onclick="saveCropEditor()">Save</button>
      </header>
      <div class="crop-instructions">Drag the selected area. Use the corner handle to resize it.</div>
      <div class="crop-stage">
        <div class="crop-image-wrap">
          <img src="${source}" alt="Original worksheet page">
          <div class="crop-dim crop-dim-all"></div>
          <div class="crop-selection" role="application" aria-label="Selected image area">
            <span class="crop-handle crop-handle-se" aria-hidden="true"></span>
          </div>
        </div>
      </div>
      <details class="crop-preview-panel">
        <summary><strong>What the student will see</strong></summary>
        <div id="cropPreview" class="crop-preview-placeholder">Save the crop to update the preview</div>
      </details>
      <footer class="crop-editor-actions">
        <button class="btn primary block" type="button" onclick="saveCropEditor()">Save image</button>
        <details class="crop-more-actions">
          <summary class="btn secondary block">More options</summary>
          <div class="crop-more-grid">
            <button class="btn secondary" type="button" onclick="resetCropToAI()">Reset AI crop</button>
            <button class="btn secondary" type="button" onclick="useFullPageCrop()">Use full page</button>
            <button class="btn danger" type="button" onclick="removeQuestionImage()">Remove image</button>
          </div>
        </details>
      </footer>
    </div>`;
  document.body.appendChild(overlay);
  document.body.classList.add("crop-editor-open");
  const selection=overlay.querySelector(".crop-selection");
  selection.addEventListener("pointerdown",startCropPointer);
  renderCropSelection();
};

window.closeCropEditor = () => {
  document.querySelector(".crop-editor-overlay")?.remove();
  document.body.classList.remove("crop-editor-open");
  cropEditor.mode=null;
};

function startCropPointer(e){
  e.preventDefault();
  const isHandle=e.target.classList.contains("crop-handle");
  cropEditor.mode=isHandle?"resize":"move";
  cropEditor.pointerStart={x:e.clientX,y:e.clientY};
  cropEditor.startBox={...cropEditor.box};
  e.currentTarget.setPointerCapture?.(e.pointerId);
  window.addEventListener("pointermove",moveCropPointer);
  window.addEventListener("pointerup",endCropPointer,{once:true});
}

function moveCropPointer(e){
  const wrap=document.querySelector(".crop-image-wrap");
  if(!wrap || !cropEditor.pointerStart || !cropEditor.startBox) return;
  const rect=wrap.getBoundingClientRect();
  const dx=(e.clientX-cropEditor.pointerStart.x)/rect.width;
  const dy=(e.clientY-cropEditor.pointerStart.y)/rect.height;
  const b={...cropEditor.startBox};
  if(cropEditor.mode==="move"){
    b.x+=dx; b.y+=dy;
  }else{
    b.width+=dx; b.height+=dy;
  }
  cropEditor.box=clampCropBox(b);
  renderCropSelection();
}

function endCropPointer(){
  window.removeEventListener("pointermove",moveCropPointer);
  cropEditor.pointerStart=null;
  cropEditor.startBox=null;
  cropEditor.mode=null;
}

window.resetCropToAI = () => {
  const q=state.draft.questions[cropEditor.questionIndex];
  cropEditor.box=normalisedBoxFromAI(q.ai_visual_bbox||q.visual_bbox);
  renderCropSelection();
};

window.useFullPageCrop = () => {
  cropEditor.box={x:0,y:0,width:1,height:1};
  renderCropSelection();
};

window.removeQuestionImage = () => {
  const i=cropEditor.questionIndex;
  const q=state.draft.questions[i];
  q.visual_data_url="";
  q.needs_visual=false;
  q.visual_user_box=null;
  closeCropEditor();
  renderReview();
  setTimeout(()=>document.querySelector(`[data-i="${i}"]`)?.setAttribute("open",""),0);
};

window.saveCropEditor = async () => {
  const i=cropEditor.questionIndex;
  const q=state.draft.questions[i];
  const source=state.sourceImages[Number(q.page_index)];
  if(!source) return alert("The source page is unavailable.");
  const b=clampCropBox({...cropEditor.box});
  const bbox=[
    Math.round(b.x*1000),
    Math.round(b.y*1000),
    Math.round(b.width*1000),
    Math.round(b.height*1000)
  ];
  try{
    const saveButtons=document.querySelectorAll(".crop-editor-overlay .btn.primary");
    saveButtons.forEach(btn=>{btn.disabled=true;btn.textContent="Saving…";});
    q.visual_bbox=bbox;
    q.visual_user_box=b;
    q.visual_user_adjusted=true;
    q.needs_visual=true;
    q.visual_data_url=await exactVisualFromDataURL(source,bbox);
    closeCropEditor();
    renderReview();
    setTimeout(()=>document.querySelector(`[data-i="${i}"]`)?.setAttribute("open",""),0);
  }catch(e){
    alert(e.message||"The image crop could not be saved.");
    document.querySelectorAll(".crop-editor-overlay .btn.primary").forEach(btn=>{btn.disabled=false;btn.textContent="Save";});
  }
};

function questionClearlyNeedsVisual(q){
  const text=`${q.prompt||""} ${q.topic||""}`.toLowerCase();
  return Boolean(q.needs_visual) || /pictogram|diagram|grid|graph|chart|shape|clock|number line|table|picture|image|fraction model|symmetr|angle|coordinate/.test(text);
}

async function attachQuestionVisuals(draft){
  for(const q of draft.questions||[]){
    const pageIndex=Number(q.page_index);
    const source=state.sourceImages[pageIndex];
    q.needs_visual=questionClearlyNeedsVisual(q);
    if(q.needs_visual && source){
      try{
        q.visual_data_url=await visualFromDataURL(source,q.visual_bbox,false);
        // A missing or implausibly tiny crop is worse than showing the full worksheet page.
        if(!q.visual_data_url || q.visual_data_url.length<2000) q.visual_data_url=await visualFromDataURL(source,[0,0,0,0],true);
      }catch{
        try{ q.visual_data_url=await visualFromDataURL(source,[0,0,0,0],true); }
        catch{ q.visual_data_url=""; }
      }
    } else {
      q.visual_data_url="";
    }
  }
  return draft;
}

async function extractHomework(){
  if (!state.files.length) return;
  app.innerHTML = shell(`
    <div class="processing-screen">
      <div class="scan-animation"><span>📄</span><i></i></div>
      <span class="step-chip">Step 2 of 3</span>
      <h1>Reading the worksheet</h1>
      <p class="muted">Numera is finding each question, checking the maths and preparing child-friendly help.</p>
      <div class="processing-list">
        <div class="active">1 <span>Preparing phone photos</span></div>
        <div>2 <span>Reading printed questions</span></div>
        <div>3 <span>Creating hints and explanations</span></div>
      </div>
      <p class="small muted">This normally takes 15–45 seconds. Keep this page open.</p>
    </div>
  `);
  try {
    const images=[];
    for (let i=0;i<state.files.length;i++){
      const status=document.querySelectorAll(".processing-list div");
      if(status[0]) status[0].innerHTML=`✓ <span>Prepared page ${i+1} of ${state.files.length}</span>`;
      images.push(await imageToJpegDataURL(state.files[i]));
    }
    state.sourceImages=images;
    const status=document.querySelectorAll(".processing-list div");
    status[0]?.classList.remove("active"); status[1]?.classList.add("active");
    // Each page is read sequentially on the server, so allow more time for more
    // pages. ~55s per page + headroom, capped so it can't hang absurdly long.
    const extractTimeout=Math.min(240000, 40000 + images.length*55000);
    state.draft = await api("/api/extract", {method:"POST", body:JSON.stringify({images, setter_username:state.setterSession?.username||"", token:state.setterSession?.token||""}), timeoutMs:extractTimeout});
    if (!state.draft.questions?.length) throw new Error("No readable questions were found. Retake the photo closer to the page.");
    status[1]?.classList.remove("active"); status[2]?.classList.add("active");
    state.draft=await attachQuestionVisuals(state.draft);
    // Snapshot what the AI produced, so at publish we can detect what the teacher
    // actually corrected (the correction-feedback loop). Only set once, from the
    // fresh AI output — never overwritten by later edits.
    (state.draft.questions||[]).forEach(q=>{
      q._ai_original={ answer:String(q.answer??""), prompt:String(q.prompt??""), type:String(q.type??"") };
    });
    saveDraft();
    renderReview();
  } catch(e){
    app.innerHTML = shell(`
      <div class="mobile-page-head"><span class="step-chip error-chip">Could not read worksheet</span><h1>Let’s try that photo again</h1></div>
      <div class="card extraction-error"><div class="mascot">📸</div><p>${esc(e.message)}</p><div class="photo-help"><div>• Photograph one full page at a time</div><div>• Move closer so the print is sharp</div><div>• Avoid glare and dark shadows</div><div>• Use JPG, PNG or the phone camera</div></div></div>
      <button class="btn primary block" onclick="renderUpload()">Retake or choose photos</button>
    `, true);
  }
}


function multipartMarkerCount(text=""){
  const markers=String(text).match(/(?:^|\s|\n)\(?[a-f]\)[\s.:]/gi)
    || String(text).match(/\([a-f]\)/gi)
    || [];
  return new Set(markers.map(x=>x.toLowerCase().replace(/[^a-f]/g,""))).size;
}

function normaliseMultipartQuestion(q){
  q.parts=Array.isArray(q.parts)?q.parts:[];
  // A unit conversion like "98mm = _ cm _ mm" is sometimes mislabelled as
  // multipart, but it's one instruction with unit boxes, not separate parts.
  // Signature: 2+ parts, every part a plain-number answer with a unit, and no
  // distinct part wording (prompt empty, a bare "Part x", or just the unit). If
  // so, convert to a sequence with per-box units so the child gets clean number
  // boxes. Only triggers on that exact shape, so real multipart is untouched.
  if(q.type==="multipart" && !q.type_user_set && q.parts.length>1){
    const looksLikeConversion=q.parts.every(p=>{
      const ans=String(p.answer??"").trim();
      const isPlainNumber=/^-?\d+(\.\d+)?$/.test(ans);
      const prompt=String(p.prompt??"").trim().toLowerCase();
      const unit=String(p.answer_unit??"").trim().toLowerCase();
      const noDistinctPrompt = prompt==="" || /^part\s*[a-f]$/.test(prompt) || prompt===unit;
      return isPlainNumber && noDistinctPrompt && !!unit;
    });
    if(looksLikeConversion){
      q.type="sequence";
      q.answer=q.parts.map(p=>String(p.answer).trim()).join(",");
      q.answer_unit=q.parts.map(p=>String(p.answer_unit).trim()).join(",");
      q.sequence_count=q.parts.length;
      q.parts=[];
      return q;
    }
  }
  if(q.parts.length>1){
    q.type="multipart";
    q.parts=q.parts.map((p,i)=>({
      label:p.label||String.fromCharCode(97+i),
      prompt:p.prompt||`Part ${String.fromCharCode(97+i)}`,
      answer:String(p.answer??""),
      answer_unit:p.answer_unit||"",
      type:p.type||"number"
    }));
    return q;
  }

  const markerCount=multipartMarkerCount(q.prompt);
  if(markerCount>1){
    q.type="multipart";
    q.multipart_incomplete=true;
    while(q.parts.length<markerCount){
      const i=q.parts.length;
      q.parts.push({
        label:String.fromCharCode(97+i),
        prompt:`Part ${String.fromCharCode(97+i)} — check wording`,
        answer:i===0?String(q.answer??""):"",
        answer_unit:q.answer_unit||"",
        type:isTimeQuestion(q)?"time":"number"
      });
    }
  }
  return q;
}

function normaliseHomeworkQuestions(homework){
  if(homework?.questions){
    homework.questions=homework.questions.map(normaliseMultipartQuestion);
  }
  return homework;
}

window.renderReview = () => renderReview();
// After a session-expiry publish failure, send the teacher to sign in, then
// bring them straight back to their reviewed questions (safe in state.draft).
window.goSignInThenReview = () => {
  state.returnToReviewAfterSignIn = true;
  location.hash = "#/teacher-signin";
};
function renderReview(){
  if (!state.draft) return location.hash="#/create";
  state.draft.questions=(state.draft.questions||[]).map(normaliseMultipartQuestion);
  const qs = state.draft.questions.map((q,i)=>questionEditor(q,i)).join("");
  app.innerHTML = shell(`
    <section class="mobile-page-head">
      <span class="step-chip">${state.editingHomeworkId?"Editing published homework":"Step 3 of 3"}</span>
      <h1>${state.editingHomeworkId?"Edit homework questions":"Check the questions"}</h1>
      <p class="muted">${state.editingHomeworkId
        ? `Open each question one by one, make any changes, then save the homework.`
        : `Numera found ${state.draft.questions.length} question${state.draft.questions.length===1?"":"s"}. Open each card to check its wording and answer.`}</p>
    </section>
    ${state.draft.warning ? `<div class="notice">${esc(state.draft.warning)}</div>` : ""}
    ${state.reusedFromTitle ? `<div class="notice reuse-banner"><strong>Fresh copy for a new class.</strong> This is a new homework based on "${esc(state.reusedFromTitle)}". Rename it below (and tweak anything you like), then publish — the original and its results stay untouched.</div>` : ""}
    <div class="review-summary-card">
      <div class="field"><label>Homework title</label><input id="title" value="${esc(state.draft.title || "Year 4 Maths")}"></div>
      <div class="field"><label>Main topic</label><input id="topic" value="${esc(state.draft.topic || "Mixed maths")}"></div>
    </div>
    <div class="review-instruction"><span>AI draft</span><strong>Tap a question to edit it</strong></div>
    <div id="questionEditors" class="question-editor-list">${qs}</div>
    <button class="btn secondary block" onclick="addQuestion()">＋ Add another question</button>
    <div class="mobile-sticky-action review-publish">
      <button class="btn green block" onclick="publishHomework()">${state.editingHomeworkId?"Save changes":"Publish homework"}</button>
      <span class="small muted">${state.editingHomeworkId?"Changes update this homework without changing its student link":"You can change anything before publishing"}</span>
    </div>
  `, true);
  // Initial render of any shade-question previews so the teacher sees the grid
  // and the divisibility check immediately, not only after editing a field.
  setTimeout(()=>{ (state.draft.questions||[]).forEach((q,i)=>{ if(q.type==="shade") refreshShadePreview(i); }); },0);
}
function questionEditor(q,i){
  return `<details class="question-accordion" data-i="${i}" ${i===0?"open":""}>
    <summary><span class="question-number">${i+1}</span><span class="summary-copy"><strong>${esc(q.prompt||"Untitled question")}</strong><small>${esc(q.topic||"Maths")} · ${q.type==="point"?"Point: "+esc(String(q.point_answer||q.answer||"Not set")):q.type==="matching"?"Interactive matching":`Answer: ${esc(String(q.answer||"Not set"))}`}</small></span><span class="chevron">⌄</span></summary>
    <div class="question-form">
      <div class="question-source-row"><span class="pill">${esc(q.source_label||`Page ${(q.page_index??0)+1}`)}</span>${q.needs_visual?`<span class="pill orange">Visual question</span>`:""}</div>
      ${q.visual_data_url ? `<figure class="question-visual"><img src="${q.visual_data_url}" alt="Source visual for question ${i+1}"><figcaption>${q.visual_user_adjusted?"Teacher-adjusted image":"AI-selected image from the worksheet"}</figcaption></figure>` : `<div class="visual-missing-note">${q.needs_visual?"This question may need an image. Select the relevant area from the worksheet.":"No worksheet image attached."}</div>`}
      ${q.multipart_incomplete?`<div class="notice multipart-warning"><strong>Check all parts:</strong> Numera detected more than one printed part but could not confidently read every separate answer. Complete or correct the part fields below before publishing.</div>`:""}
      <div class="question-image-actions">
        <button type="button" class="btn secondary" onclick="openCropEditor(${i})">✂️ ${q.visual_data_url?"Adjust image":"Choose image area"}</button>
        <button type="button" class="btn secondary" onclick="document.getElementById('imgUpload${i}').click()">🖼️ Upload image</button>
        <input type="file" id="imgUpload${i}" accept="image/*" style="display:none" onchange="uploadQuestionImage(${i}, this)">
        ${q.visual_data_url?`<button type="button" class="btn ghost" onclick="removeQuestionImageDirect(${i})">Remove image</button>`:""}
      </div>
      <div class="field"><label>Question</label><textarea data-k="prompt" rows="3" onblur="maybeAutoDrawing(${i})">${esc(q.prompt)}</textarea></div>
      <div class="field-row-mobile">
        <div class="field"><label>Answer type</label><select data-k="type" onchange="this.dataset.userChanged='1'"><option value="number" ${q.type==="number"?"selected":""}>Type an answer</option><option value="time" ${q.type==="time"?"selected":""}>Time (hour and minutes)</option><option value="multiple_choice" ${q.type==="multiple_choice"?"selected":""}>Multiple choice</option><option value="drawing" ${q.type==="drawing"?"selected":""}>Draw line(s) on image</option><option value="point" ${q.type==="point"?"selected":""}>Select a point on a grid</option><option value="coordinate" ${q.type==="coordinate"?"selected":""}>Enter a coordinate pair</option><option value="matching" ${q.type==="matching"?"selected":""}>Connect matching items</option><option value="sequence" ${q.type==="sequence"?"selected":""}>Number sequence (several numbers)</option><option value="shade" ${q.type==="shade"?"selected":""}>Shade a fraction of a grid</option><option value="multipart" ${q.type==="multipart"?"selected":""}>Multiple parts (a, b…)</option></select></div>
        <div class="field"><label>Correct answer</label><input data-k="answer" value="${esc(String(q.answer))}"></div>
      </div>
      <div class="field"><label>Answer unit <span class="label-note">shown beside the input</span></label><input data-k="answer_unit" value="${esc(q.answer_unit||"")}" placeholder="e.g. ml, cm, children"></div>
      ${q.type==="sequence"?`<div class="field"><label>How many number boxes <span class="label-note">leave blank to match the answer (e.g. "20,22,24" = 3)</span></label><input data-k="sequence_count" inputmode="numeric" value="${esc(q.sequence_count||"")}" placeholder="${sequenceCount(q)}"></div><div class="notice sequence-note">The child gets one number box per value and fills them in order — no comma needed on the phone keypad. Enter the correct answer above as "20,22,24".</div>`:""}
      ${q.type==="multipart"?`<div class="multipart-editor"><div class="row between"><strong>Answer parts</strong><button type="button" class="btn secondary" onclick="addQuestionPart(${i})">＋ Add part</button></div>${(q.parts||[]).map((p,pi)=>`<div class="part-editor" data-part-i="${pi}"><div class="row between"><span class="part-label">${esc(p.label||String.fromCharCode(97+pi))}</span><button type="button" class="btn ghost" onclick="deleteQuestionPart(${i},${pi})">Remove</button></div><div class="field"><label>Part prompt</label><input data-part-k="prompt" value="${esc(p.prompt||"")}"></div><div class="field-row-mobile"><div class="field"><label>Answer</label><input data-part-k="answer" value="${esc(p.answer||"")}"></div><div class="field"><label>Unit</label><input data-part-k="answer_unit" value="${esc(p.answer_unit||"")}"></div></div><div class="field"><label>Input type</label><select data-part-k="type"><option value="number" ${p.type==="number"?"selected":""}>Number</option><option value="time" ${p.type==="time"?"selected":""}>Time</option><option value="multiple_choice" ${p.type==="multiple_choice"?"selected":""}>Multiple choice</option><option value="sequence" ${p.type==="sequence"?"selected":""}>Number sequence</option></select></div>${p.type==="sequence"?`<div class="field"><label>How many number boxes <span class="label-note">leave blank to match the answer</span></label><input data-part-k="sequence_count" inputmode="numeric" value="${esc(p.sequence_count||"")}" placeholder="${sequenceCount(p)}"></div>`:""}</div>`).join("")}</div>`:""}

      ${q.type==="coordinate"?`<div class="interaction-editor"><strong>Coordinate-answer setup</strong><div class="field"><label>Correct coordinate</label><input data-k="coordinate_answer" value="${esc(Array.isArray(q.coordinate_answer)?JSON.stringify(q.coordinate_answer):String(q.coordinate_answer||q.answer||"[0,0]"))}" placeholder="[3, 2]"></div><p class="small muted">Students will see separate x and y boxes.</p></div>`:""}
      ${q.type==="point"?`<div class="interaction-editor">
        <strong>Coordinate-grid setup</strong>
        <div class="field-row-mobile">
          <div class="field"><label>Correct point</label><input data-k="point_answer" value="${esc(Array.isArray(q.point_answer)?JSON.stringify(q.point_answer):String(q.point_answer||q.answer||"[0,0]"))}" placeholder="[3, 2]"></div>
          <div class="field"><label>Grid bounds</label><input data-k="grid_bounds" value="${esc(Array.isArray(q.grid_bounds)?JSON.stringify(q.grid_bounds):String(q.grid_bounds||"[-5,5,-5,5]"))}" placeholder="[-5,5,-5,5]"></div>
        </div>
        <div class="field"><label>Grid step</label><input data-k="grid_step" type="number" step="0.25" value="${esc(String(q.grid_step||1))}"></div>
      </div>`:""}
      ${q.type==="shade"?`<div class="interaction-editor">
        <strong>Shade-a-fraction setup</strong>
        <p class="label-note" style="margin:2px 0 10px">Confirm the grid Numera read from the worksheet, and the fraction to shade. The photo reading can be wrong — please check it matches the printed shape.</p>
        <div class="row wrap">
          <div class="field"><label>Rows</label><input data-k="grid_rows" type="number" min="1" max="12" value="${esc(String(q.grid_rows||3))}" oninput="refreshShadePreview(${i})"></div>
          <div class="field"><label>Columns</label><input data-k="grid_cols" type="number" min="1" max="12" value="${esc(String(q.grid_cols||3))}" oninput="refreshShadePreview(${i})"></div>
          <div class="field"><label>Fraction to shade</label><input data-k="shade_fraction" value="${esc(String(q.shade_fraction||q.answer||"1/3"))}" placeholder="1/3" oninput="refreshShadePreview(${i})"></div>
        </div>
        <div id="shadePreview${i}" class="shade-preview"></div>
      </div>`:""}

      <div class="field"><label>Answer choices <span class="label-note">multiple choice only</span></label><input data-k="options" value="${esc((q.options||[]).join(", "))}" placeholder="12, 14, 16, 18"></div>
      ${q.type==="multiple_choice"?`<div class="suggest-options-row"><button type="button" class="btn secondary" onclick="suggestOptions(${i})">✨ Suggest answers</button><span class="suggest-hint muted">Generates the correct answer plus common-mistake distractors</span></div><div class="suggest-result" id="suggestResult${i}"></div>`:""}
      ${(q.requires_teacher_check || ["drawing","point","coordinate","matching","shade"].includes(q.type)) ? `<div class="teacher-check-card">
        <strong>Teacher verification required</strong>
        <p>${q.type==="drawing" ? "This answer will be drawn on the worksheet image and saved for adult review." : q.type==="point" ? "Check the coordinate bounds and correct point before publishing." : q.type==="matching" ? "Check every left item, right item and correct pair before publishing." : q.type==="shade" ? "Confirm the grid size and fraction above match the printed shape before publishing — the photo reading of grids can be wrong." : "Numera counted information from a visual. Check the image, calculation and final answer before publishing."}</p>
        ${q.answer_working ? `<div class="visual-working"><span>AI calculation</span>${esc(q.answer_working)}</div>` : ""}
        <label class="confirm-check"><input type="checkbox" data-k="teacher_confirmed" ${q.teacher_confirmed?"checked":""}> I have checked this question and answer</label>
      </div>` : ""}
      <div class="hint-editor">
        <div class="hint-editor-heading"><strong>Progressive hint ladder</strong><span>Each level offers more support. Asking for help does not count as a wrong answer.</span></div>
        ${questionHintTiers(q).map((hint,hi)=>`<div class="field hint-editor-field"><label>Hint ${hi+1}: ${esc(hintTierName(hi+1))}</label><textarea data-hint-i="${hi}" rows="${hi===3?3:2}">${esc(hint)}</textarea></div>`).join("")}
      </div>
      <div class="field"><label>Feedback after an incorrect submitted answer</label><textarea data-k="explanation" rows="3">${esc(q.explanation||"")}</textarea></div>
      <details class="advanced-fields"><summary>More teaching settings</summary><div class="field"><label>Topic</label><input data-k="topic" value="${esc(q.topic||state.draft.topic||"Mixed maths")}"></div><div class="field"><label>Similar practice question</label><input data-k="practice_prompt" value="${esc(q.practice_prompt||"")}"></div><div class="field"><label>Practice answer</label><input data-k="practice_answer" value="${esc(String(q.practice_answer??""))}"></div></details>
      <button type="button" class="btn danger block" onclick="deleteQuestion(${i})">Remove this question</button>
    </div>
  </details>`;
}
window.removeQuestionImageDirect = i => {
  syncEditors();
  const q=state.draft.questions[i];
  q.visual_data_url="";
  q.needs_visual=false;
  q.visual_user_box=null;
  q.visual_user_adjusted=false;
  renderReview();
  setTimeout(()=>document.querySelector(`[data-i="${i}"]`)?.setAttribute("open",""),0);
};

// Let the teacher attach an image by uploading a file (camera or gallery on a
// phone). This is the way to add an image to a MANUALLY added question, which
// has no source worksheet page to crop from. The image is stored as a data URL,
// the same format used everywhere else in the app.
window.uploadQuestionImage = (i, input) => {
  const file=input?.files?.[0];
  if(!file) return;
  if(!file.type.startsWith("image/")){ alert("Please choose an image file."); input.value=""; return; }
  if(file.size>8*1024*1024){ alert("That image is quite large (over 8MB). Please choose a smaller photo."); input.value=""; return; }
  syncEditors();
  const reader=new FileReader();
  reader.onload=async ()=>{
    const dataUrl=String(reader.result||"");
    const q=state.draft.questions[i];
    q.visual_data_url=dataUrl;
    q.needs_visual=true;
    q.visual_user_adjusted=true;
    q.source_label=q.source_label||"Uploaded image";
    // Attach the image immediately, then read it with AI to fill the question.
    renderReview();
    setTimeout(()=>document.querySelector(`[data-i="${i}"]`)?.setAttribute("open",""),0);
    await readQuestionImageWithAI(i, dataUrl);
  };
  reader.onerror=()=>alert("Sorry, that image could not be read. Please try another.");
  reader.readAsDataURL(file);
};

// Send a single uploaded image through the AI reader and populate THIS question
// (and append any extra questions the image contained). Runs the same extraction
// the initial upload uses, so an added question gets the same teaching content.
async function readQuestionImageWithAI(i, dataUrl){
  const card=()=>document.querySelector(`[data-i="${i}"]`);
  const btn=document.querySelector(`[onclick="suggestOptions(${i})"]`); // any control to reflect busy state
  // Show a lightweight reading indicator on the card.
  let banner=card()?.querySelector(".ai-read-banner");
  if(card() && !banner){
    banner=document.createElement("div");
    banner.className="ai-read-banner";
    banner.innerHTML=`<span class="spinner-inline"></span> Reading the image with AI…`;
    card().querySelector(".question-image-actions")?.after(banner);
  }
  try{
    const shrunk=await downscaleDataUrl(dataUrl, "the uploaded image"); // downscale/normalise like the main upload
    const result=await api("/api/extract",{method:"POST",body:JSON.stringify({images:[shrunk]}),timeoutMs:95000});
    const read=(result.questions||[])[0];
    if(!read){ throw new Error("No question could be read from that image."); }

    // Populate THIS question from the first read question, preserving the image.
    const q=state.draft.questions[i];
    const keepImage=q.visual_data_url;
    Object.assign(q, read, {
      visual_data_url: keepImage,
      needs_visual: true,
      visual_user_adjusted: true,
      source_label: "Uploaded image",
      page_index: q.page_index ?? 0,
      page_number: q.page_number ?? 1,
      type_user_set: false
    });

    // If the image held MORE than one question, append the rest as new questions.
    const extra=(result.questions||[]).slice(1);
    for(const ex of extra){
      state.draft.questions.push({
        ...ex,
        visual_data_url: keepImage,
        needs_visual: true,
        source_label: "Uploaded image",
        page_index: 0, page_number: 1
      });
    }

    state.draft.questions=state.draft.questions.map(normaliseMultipartQuestion);
    saveDraft();
    renderReview();
    setTimeout(()=>document.querySelector(`[data-i="${i}"]`)?.setAttribute("open",""),0);
  }catch(e){
    // Reading failed — keep the image attached as a static picture and let the
    // teacher fill the fields manually. Never lose their work.
    if(banner) banner.innerHTML=`<span class="ai-read-error">Couldn't read that image automatically — you can type the question in, or try a clearer photo.</span>`;
  }
}

window.addQuestionPart=i=>{syncEditors();const q=state.draft.questions[i];q.type="multipart";q.parts||=[];const n=q.parts.length;q.parts.push({label:String.fromCharCode(97+n),prompt:"",answer:"",answer_unit:"",type:"number"});renderReview();setTimeout(()=>document.querySelector(`[data-i="${i}"]`)?.setAttribute("open",""),0);};
window.deleteQuestionPart=(i,pi)=>{syncEditors();const q=state.draft.questions[i];q.parts.splice(pi,1);q.parts.forEach((p,n)=>p.label=String.fromCharCode(97+n));renderReview();setTimeout(()=>document.querySelector(`[data-i="${i}"]`)?.setAttribute("open",""),0);};

function syncEditors(){
  // Keep the title/topic inputs in state too. They live outside the question
  // cards, so without this a re-render (adding a part, deleting a question,
  // adjusting a crop) would reset the title input back to the old draft value
  // and silently discard what the teacher typed.
  const titleEl=document.getElementById("title");
  if(titleEl) state.draft.title=titleEl.value;
  const topicEl=document.getElementById("topic");
  if(topicEl) state.draft.topic=topicEl.value;
  document.querySelectorAll("[data-i]").forEach(card=>{
    const i=+card.dataset.i, q=state.draft.questions[i];
    card.querySelectorAll("[data-k]").forEach(el=>{
      const k=el.dataset.k;
      q[k] = k==="options"
        ? el.value.split(",").map(x=>x.trim()).filter(Boolean)
        : el.type==="checkbox"
          ? el.checked
          : el.value;
    });
    const editedHints=[...card.querySelectorAll("[data-hint-i]")].sort((a,b)=>Number(a.dataset.hintI)-Number(b.dataset.hintI)).map(el=>el.value.trim());
    if(editedHints.length){q.hints=editedHints;q.hint=editedHints[0]||"";}
    if(q.type==="multipart"){q.parts||=[];card.querySelectorAll("[data-part-i]").forEach(pe=>{const pi=Number(pe.dataset.partI);q.parts[pi]||={label:String.fromCharCode(97+pi),prompt:"",answer:"",answer_unit:"",type:"number"};pe.querySelectorAll("[data-part-k]").forEach(el=>q.parts[pi][el.dataset.partK]=el.value);});}

    // Auto-detect a "draw" question: if the wording asks the child to draw and
    // the teacher hasn't deliberately chosen a type, default to the drawing
    // type. Always overridable — once the teacher picks a type from the dropdown
    // themselves (type_user_set), we never override it again.
    const typeEl=card.querySelector('[data-k="type"]');
    if(typeEl && typeEl.dataset.userChanged==="1") q.type_user_set=true;
    if(!q.type_user_set && /\bdraw\b/i.test(String(q.prompt||"")) && q.type==="number"){
      q.type="drawing";
    }
    // Auto-detect a number-sequence question: wording that asks for several
    // numbers in a series/pattern, OR an answer that is a comma-list of numbers.
    // Same override rules as "draw" — never fights a type the teacher chose.
    else if(!q.type_user_set && q.type==="number"){
      // Fraction answer: a single "n/d" (e.g. "2/9"). The keypad has no "/", and
      // the fraction type gives separate numerator/denominator boxes. Check this
      // first, before the number-sequence check.
      const isFraction=/^\s*-?\d+\s*\/\s*\d+\s*$/.test(String(q.answer||""));
      if(isFraction){ q.type="fraction"; }
      else {
      const seqWording=/\b(next\s+numbers?|missing\s+numbers?|continue\s+the\s+(pattern|sequence)|number\s+(sequence|pattern|snake)|count(ing)?\s+(in|up|back|on)\b|fill\s+in\s+the\s+(sequence|pattern|numbers))\b/i.test(String(q.prompt||""));
      const answerIsList=/^\s*-?\d+(\s*,\s*-?\d+){1,}\s*$/.test(String(q.answer||""));
      if(seqWording || answerIsList){ q.type="sequence"; }
      // Word answer: the correct answer contains alphabetic words a child cannot
      // type on a numeric keypad (e.g. "four thousand six hundred and two",
      // "hexagon"). Default to multiple choice. A units label like "cm" in
      // answer_unit doesn't count — only letters IN the answer itself.
      else if(/[a-z]{3,}/i.test(String(q.answer||"")) && !/^\s*(teacher review)?\s*$/i.test(String(q.answer||""))){
        q.type="multiple_choice";
        if(!(q.options||[]).filter(o=>String(o).trim()).length){
          q.options=[String(q.answer).trim()]; // seed with the correct answer; teacher/AI add distractors
        }
      }
      }
    }
  });
  saveDraft();
}
// On-demand: ask the backend to suggest multiple-choice options for question i —
// the correct answer plus diagnostic distractors (each tied to a common mistake).
window.suggestOptions = async i => {
  syncEditors();
  const q=state.draft.questions[i];
  const out=document.getElementById(`suggestResult${i}`);
  const prompt=String(q.prompt||"").trim();
  if(!prompt){ if(out) out.innerHTML=`<div class="suggest-error">Add the question wording first.</div>`; return; }

  const btn=document.querySelector(`[onclick="suggestOptions(${i})"]`);
  if(btn){ btn.disabled=true; btn.textContent="Thinking…"; }
  if(out) out.innerHTML=`<div class="suggest-loading">Generating answer choices…</div>`;

  try{
    const data=await api("/api/suggest-options",{
      method:"POST",
      body:JSON.stringify({prompt, answer:q.answer})
    });
    q.options=data.options||[];
    if(data.correct_answer) q.answer=data.correct_answer;
    const field=document.querySelector(`[data-i="${i}"] [data-k="options"]`);
    if(field) field.value=(q.options||[]).join(", ");
    const answerField=document.querySelector(`[data-i="${i}"] [data-k="answer"]`);
    if(answerField && data.correct_answer) answerField.value=data.correct_answer;

    const rows=(data.distractors||[]).map(d=>`<li><strong>${esc(String(d.value))}</strong> — <span class="muted">${esc(String(d.misconception||"common mistake"))}</span></li>`).join("");
    if(out) out.innerHTML=`
      <div class="suggest-done">
        <div class="suggest-correct">Correct answer: <strong>${esc(data.correct_answer||q.answer||"")}</strong></div>
        ${rows?`<div class="suggest-distractor-label">Distractors (each from a common mistake):</div><ul class="suggest-distractors">${rows}</ul>`:""}
        <p class="small muted">Added to the answer choices above. Edit or remove any before publishing.</p>
      </div>`;
  }catch(err){
    if(out) out.innerHTML=`<div class="suggest-error">${esc(err.message)}</div>`;
  }finally{
    if(btn){ btn.disabled=false; btn.textContent="✨ Suggest answers"; }
  }
};

// Called when the teacher finishes editing a question's wording. syncEditors()
// runs the "draw" auto-detect; if it changed the type, re-render so the type
// dropdown and drawing-specific fields update to match.
window.maybeAutoDrawing = i => {
  const before=state.draft.questions[i]?.type;
  syncEditors();
  const after=state.draft.questions[i]?.type;
  if(before!==after){
    renderReview();
    setTimeout(()=>document.querySelector(`[data-i="${i}"]`)?.setAttribute("open",""),0);
  }
};

window.deleteQuestion = i => { syncEditors(); state.draft.questions.splice(i,1); renderReview(); };
window.addQuestion = () => {
  syncEditors();
  state.draft.questions.push({type:"number",prompt:"",answer:"",options:[],hint:"",hints:["","","",""],explanation:"",topic:state.draft.topic,practice_prompt:"",practice_answer:"",needs_visual:false,visual_bbox:[0,0,0,0],visual_data_url:"",page_index:0,page_number:1,source_label:"Manual question",ai_visual_bbox:[0,0,1000,1000],visual_user_box:null,visual_user_adjusted:false,requires_teacher_check:false,answer_working:"",teacher_confirmed:false,answer_unit:"",parts:[],point_answer:[0,0],coordinate_answer:[0,0],grid_bounds:[-5,5,-5,5],grid_step:1,matching_left:[],matching_right:[],matching_pairs:[]});
  renderReview();
};

// Detect what the teacher actually changed from the AI's output, and record it
// (best-effort). This is the correction-feedback loop's capture step. Only counts
// REAL differences — nothing inflated.
async function recordCorrections(homeworkId){
  try{
    if(!state.setterSession?.username || !state.setterSession?.token) return;
    const qs=state.draft?.questions||[];
    const corrections=[];
    for(const q of qs){
      const orig=q._ai_original;
      if(!orig) continue;
      const topic=String(q.topic||q.concept_key||"").trim();
      if(String(q.answer??"")!==orig.answer && (orig.answer||q.answer)){
        corrections.push({field:"answer",ai_value:orig.answer,teacher_value:String(q.answer??""),question_topic:topic,concept_key:q.concept_key||""});
      }
      if(String(q.type??"")!==orig.type && orig.type){
        corrections.push({field:"type",ai_value:orig.type,teacher_value:String(q.type??""),question_topic:topic,concept_key:q.concept_key||""});
      }
      if(String(q.prompt??"").trim()!==orig.prompt.trim() && orig.prompt){
        corrections.push({field:"prompt",ai_value:orig.prompt,teacher_value:String(q.prompt??""),question_topic:topic,concept_key:q.concept_key||""});
      }
    }
    await api("/api/corrections",{method:"POST",body:JSON.stringify({
      action:"record",
      setter_username:state.setterSession.username,
      token:state.setterSession.token,
      homework_id:homeworkId,
      corrections,
      questions_reviewed:qs.length
    })});
  }catch(e){ /* best-effort — never block publishing on the feedback loop */ }
}

window.publishHomework = async () => {
  syncEditors();
  const title=(state.draft.title||$("#title")?.value||"").trim() || "Year 4 Maths";
  const topic=(state.draft.topic||$("#topic")?.value||"").trim() || "Mixed maths";
  if (!state.draft.questions.length) return alert("Add at least one question.");
  // Multiple-choice needs a usable set of options, and the correct answer must
  // be one of them — otherwise the child sees an empty choice list (the exact
  // bug this fixes) or a set with no right answer. Check this first so the
  // teacher gets a precise, question-specific message.
  const badMc=state.draft.questions.findIndex(q=>{
    if(q.type!=="multiple_choice") return false;
    const opts=(q.options||[]).map(o=>String(o).trim()).filter(Boolean);
    if(opts.length<2) return true;
    return !opts.some(o=>o===String(q.answer??"").trim());
  });
  if(badMc>=0){
    const q=state.draft.questions[badMc];
    const opts=(q.options||[]).map(o=>String(o).trim()).filter(Boolean);
    alert(
      opts.length<2
        ? `Question ${badMc+1} is set to multiple choice but has fewer than two answer choices. Add the choices (e.g. "12, 14, 16, 18") or change the answer type.`
        : `Question ${badMc+1} is multiple choice but the correct answer isn't one of the choices. Add the correct answer to the list of choices.`
    );
    document.querySelector(`[data-i="${badMc}"]`)?.setAttribute("open","");
    return;
  }
  if(state.draft.questions.some(q=>{
    if(!String(q.prompt||"").trim()) return true;
    if(q.type==="drawing") return false;
    if(q.type==="point") return parseNumberList(q.point_answer,parseNumberList(q.answer,[])).length!==2;
    if(q.type==="coordinate") return parseNumberList(q.coordinate_answer,parseNumberList(q.answer,[])).length!==2;
    if(q.type==="matching") return !parseStringList(q.matching_left).length || parseStringList(q.matching_left).length!==parseStringList(q.matching_right).length || parseStringList(q.matching_pairs).length!==parseStringList(q.matching_left).length;
    if(q.type==="multipart"){
      return !(q.parts?.length>1) || q.parts.some(p=>
        !String(p.prompt||"").trim() ||
        !String(p.answer??"").trim() ||
        /check wording/i.test(String(p.prompt||""))
      );
    }
    return String(q.answer??"").trim()==="";
  })) return alert("Every part of a multi-part question must have its own wording and correct answer before publishing.");
  const unchecked=state.draft.questions.findIndex(q=>(q.requires_teacher_check || ["drawing","point","coordinate","matching"].includes(q.type)) && !q.teacher_confirmed);
  if(unchecked>=0){
    alert(`Please open Question ${unchecked+1} and confirm that you have checked its visual and answer.`);
    document.querySelector(`[data-i="${unchecked}"]`)?.setAttribute("open","");
    return;
  }

  const button=document.querySelector(".review-publish .btn");
  if(button){button.disabled=true;button.textContent=state.editingHomeworkId?"Saving…":"Publishing…";}
  try {
    const payload={
      setter_username:state.setterSession?.username||null,
      setter_token:state.setterSession?.token||null,
      title, topic, year_group:"Year 4",
      questions:state.draft.questions,
      settings:{hints:true, mastery:true, challenge:true, source_pages:state.draft.page_count||state.sourceImages.length}
    };
    const payloadBytes=new Blob([JSON.stringify(payload)]).size;
    if(payloadBytes>4_500_000) throw new Error("This homework is too large to publish because it contains several detailed images. Remove unnecessary visual questions or publish fewer pages at once.");
    let result;
    if(state.editingHomeworkId){
      result=await api("/api/homeworks",{
        method:"PUT",
        body:JSON.stringify({...payload,id:state.editingHomeworkId})
      });
      state.homework={...result,title,topic,questions:state.draft.questions};
      const savedId=state.editingHomeworkId;
      state.editingHomeworkId=null;
      clearDraft();
      alert("Homework changes saved.");
      location.hash=`#/edit-homework?id=${savedId}`;
    }else{
      result=await api("/api/homeworks",{method:"POST",body:JSON.stringify(payload)});
      state.homework={...result,title,topic,questions:state.draft.questions};
      state.reusedFromTitle="";
      localStorage.setItem("numera:lastHomework",result.id);
      recordCorrections(result.id); // best-effort; feeds the correction loop
      clearDraft();
      location.hash="#/published";
    }
  } catch(e){
    const msg=String(e.message||"");
    const isSession=/session expired|sign in/i.test(msg);
    const helpBlock = isSession
      ? `<div class="photo-help"><div>• Your sign-in has expired — sign in again</div><div>• Your reviewed questions are safe and will still be here</div><div>• Then tap Publish again</div></div>`
      : `<div class="photo-help"><div>• Check your connection and try again</div><div>• If a question has a large image, try again in a moment</div></div>`;
    const signInBtn = isSession
      ? `<button class="btn green block" onclick="goSignInThenReview()">Sign in again</button>`
      : "";
    app.innerHTML=shell(`
      <section class="mobile-page-head"><span class="step-chip error-chip">${state.editingHomeworkId?"Save failed":"Publish failed"}</span><h1>${state.editingHomeworkId?"The changes were not saved":"The homework was not saved"}</h1><p class="muted">Your reviewed questions are still in this browser.</p></section>
      <div class="card extraction-error"><div class="mascot">🛠️</div><p><strong>${esc(e.message)}</strong></p>${helpBlock}</div>
      ${signInBtn}
      <button class="btn primary block" onclick="renderReview()">Return to questions</button>
    `,true);
  } finally {
    if(button){button.disabled=false;button.textContent=state.editingHomeworkId?"Save changes":"Publish homework";}
  }
};

function renderPublished(){
  const h=state.homework;
  if(!h) return location.hash="#/teacher";
  // Include a readable slug of the homework title in the link so a teacher can
  // see at a glance which homework a link points to (routing still uses id).
  const titleSlug=String(h.title||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40);
  const nameParam=titleSlug?`&name=${titleSlug}`:"";
  const student=`${location.origin}${location.pathname}#/play?id=${h.id}${nameParam}`;
  const results=`${location.origin}${location.pathname}#/results?id=${h.id}${nameParam}`;
  app.innerHTML=shell(`
    <div class="mission">
      <div class="confetti">🎉 ✨ 🎉</div>
      <h1>Homework is ready!</h1>
      <p class="muted">${esc(h.title)}</p>
    </div>
    <div id="impactLoop"></div>
    <div class="card">
      <label>Student / parent link</label>
      <div class="row" style="margin-top:8px"><input id="studentLink" readonly value="${student}"><button class="btn secondary" onclick="copyField('studentLink')">Copy</button></div>
      <button class="btn green block" style="margin-top:14px" onclick="shareHomeworkWhatsApp('${student.replaceAll("'","")}')">Share with parents on WhatsApp</button>
      <button class="btn secondary block" style="margin-top:10px" onclick="shareLink('${student.replaceAll("'","")}')">More sharing options</button>
    </div>
    <div class="card">
      <label>Teacher results link</label>
      <div class="row" style="margin-top:8px"><input id="resultsLink" readonly value="${results}"><button class="btn secondary" onclick="copyField('resultsLink')">Copy</button></div>
      <a class="btn primary block" style="margin-top:14px;text-decoration:none" href="#/results?id=${h.id}">Open dashboard</a>
    </div>
  `,true);
  showImpactLoop();
}

// The visible "loop" — the Stories-style "seen by" moment. After the teacher
// publishes, show their real accumulated impact: questions they've reviewed
// (time saved) and corrections they've made (which make Numera read their
// worksheets better). Only shows real numbers; silent if unavailable.
async function showImpactLoop(){
  const el=$("#impactLoop");
  if(!el || !state.setterSession?.username || !state.setterSession?.token) return;
  try{
    const r=await api(`/api/corrections?setter_username=${encodeURIComponent(state.setterSession.username)}&token=${encodeURIComponent(state.setterSession.token)}`);
    const reviewed=Number(r.questions_reviewed||0);
    const corrections=Number(r.corrections_made||0);
    if(reviewed<=0 && corrections<=0) return; // nothing honest to show yet
    // ~2 minutes saved per question a teacher would otherwise mark by hand.
    const minutesSaved=Math.round(reviewed*2);
    const timePhrase = minutesSaved>=60
      ? `about ${Math.round(minutesSaved/60)} hour${Math.round(minutesSaved/60)===1?"":"s"}`
      : `about ${minutesSaved} minutes`;
    const theme=(r.themes||[]).find(t=>t.question_topic);
    const themeLine = corrections>0
      ? `Your ${corrections} correction${corrections===1?"":"s"} ${corrections===1?"is":"are"} teaching Numera to read your worksheets more accurately${theme?` — especially ${esc(theme.question_topic)} questions`:""}.`
      : "";
    el.innerHTML=`
      <div class="card impact-card">
        <div class="impact-row"><span class="impact-num">${reviewed}</span><span class="impact-label">questions reviewed &middot; ${timePhrase} of marking saved</span></div>
        ${corrections>0?`<div class="impact-row"><span class="impact-num">${corrections}</span><span class="impact-label">corrections that improve Numera for your class</span></div>`:""}
        ${themeLine?`<p class="impact-note">${themeLine}</p>`:""}
      </div>`;
  }catch(e){ /* silent — the loop is a bonus, never an error surface */ }
}
window.copyField=async id=>{await navigator.clipboard.writeText($("#"+id).value); alert("Copied.");};
window.shareLink=async url=>{
  if(navigator.share) await navigator.share({title:"Numera homework",text:"Here is today’s Numera maths homework.",url});
  else {await navigator.clipboard.writeText(url); alert("Link copied.");}
};
window.shareHomeworkWhatsApp=url=>{const u=`https://wa.me/?text=${encodeURIComponent(`Here is today’s Numera maths homework:\n${url}`)}`;const opened=window.open(u,"_blank","noopener,noreferrer");if(!opened){navigator.clipboard?.writeText(url);alert("The link was copied. Paste it into WhatsApp.");}};

async function loadHomework(id, mode){
  if(!id) return renderLanding();
  app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Loading…</h2></div>`);
  try{
    state.homework=normaliseHomeworkQuestions(await api(`/api/homeworks?id=${encodeURIComponent(id)}`));
    if(mode==="results") renderResults();
    else if(mode==="preview"){
      state.studentName="Teacher preview";
      state.studentUsername="teacher-preview";
      state.index=0;
      state.attempts=[];
      renderMission();
    }else renderJoin();
  }catch(e){app.innerHTML=shell(`<div class="card"><h2>Homework unavailable</h2><p>${esc(e.message)}</p></div>`,true);}
}

function renderJoin(){
  app.innerHTML=shell(`
    <div class="mission"><div class="mascot">🟢</div><h1>Welcome!</h1><p class="muted">${esc(state.homework.title)}</p></div>
    <div class="card">
      <div class="field"><label>Child’s Numera username</label><input id="studentUsername" autocapitalize="none" autocomplete="username" value="${esc(state.studentUsername||"")}" placeholder="e.g. User123"><span class="field-help">Use the same username for every homework so progress can be joined together.</span></div>
      <div class="field"><label>Child’s first name</label><input id="studentName" autocomplete="given-name" placeholder="e.g. Thomas"></div>
      <div class="field"><label>Four-digit PIN</label><input id="studentPin" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <button class="btn green block" onclick="joinHomework()">Continue</button>
    </div>
    <p class="small muted" style="text-align:center">Use letters, numbers and hyphens only. Avoid a full legal name.</p>
  `);
}
window.joinHomework=async()=>{
  const name=$("#studentName").value.trim();
  const username=$("#studentUsername").value.trim().toLowerCase();
  const pin=$("#studentPin").value;
  if(!name) return alert("Please enter a first name.");
  if(!validPin(pin))return alert("Enter the four-digit student PIN.");
  if(!/^[a-z0-9][a-z0-9-]{2,23}$/.test(username)) return alert("Choose a username 3–24 characters long using letters, numbers or hyphens.");
  try{
    const student=await api("/api/students",{method:"POST",body:JSON.stringify({username,display_name:name,pin,homework_id:state.homework.id})});
    state.studentName=student.display_name;
    state.studentUsername=student.username;
    state.studentToken=student.token||"";
    localStorage.setItem("numera:studentUsername",student.username);
    state.index=0; state.attempts=[]; renderMission();
  }catch(e){alert(e.message);}
};

function renderMission(){
  const count=state.homework.questions.length;
  app.innerHTML=shell(`
    <div class="mission">
      <div class="mascot">🚀</div>
      <h1>Hello ${esc(state.studentName)}!</h1>
      <div class="card">
        <div class="pill">TODAY’S MISSION</div>
        <h2>${esc(state.homework.topic)}</h2>
        <p>${count} questions · hints and score upgrades included</p>
        <div style="font-size:34px">⭐ ⭐ ⭐</div>
      </div>
      ${voiceControl()}
      <button class="btn green block" onclick="beginQuiz()">Start mission</button>
    </div>
  `);
}
window.beginQuiz=()=>{state.phase="answer";state.selected=null;renderQuestion();};

function isTimeQuestion(q){
  return q?.type==="time" || /^\d{1,2}:\d{2}$/.test(String(q?.answer||"").trim());
}
// Does this time answer specify AM or PM? If so the child needs a toggle, since
// a number pad can't type "AM"/"PM". We only show the toggle for these questions
// so ordinary 24-hour / no-meridiem time questions stay uncluttered.
function timeNeedsMeridiem(item){
  return /\b([ap])\.?m\.?\b/i.test(String(item?.answer||"")) || item?.time_meridiem===true;
}
function answerMeridiem(item){
  const m=String(item?.answer||"").match(/\b([ap])\.?m\.?\b/i);
  return m ? (m[1].toLowerCase()==="p" ? "PM" : "AM") : "";
}
function timeAnswerMarkup(prefix="", item=null){
  const wantMeridiem = item && timeNeedsMeridiem(item);
  const toggle = wantMeridiem ? `
    <div class="meridiem-toggle" role="group" aria-label="Choose AM or PM">
      <button type="button" id="${prefix}amBtn" class="meridiem-btn" aria-pressed="false" onclick="setMeridiem('${prefix}','AM')">AM</button>
      <button type="button" id="${prefix}pmBtn" class="meridiem-btn" aria-pressed="false" onclick="setMeridiem('${prefix}','PM')">PM</button>
    </div>` : "";
  return `<div class="time-answer" role="group" aria-label="Enter the time">
    <div class="field"><label for="${prefix}hourInput">Hour</label><input id="${prefix}hourInput" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="3" autocomplete="off"></div>
    <span class="time-colon" aria-hidden="true">:</span>
    <div class="field"><label for="${prefix}minuteInput">Minutes</label><input id="${prefix}minuteInput" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="07" autocomplete="off"></div>
    ${toggle}
  </div>`;
}
// Track the chosen meridiem per input group without needing a re-render.
window.setMeridiem=(prefix,val)=>{
  const am=document.getElementById(prefix+"amBtn"), pm=document.getElementById(prefix+"pmBtn");
  if(!am||!pm) return;
  const isAm=val==="AM";
  am.classList.toggle("selected",isAm); pm.classList.toggle("selected",!isAm);
  am.setAttribute("aria-pressed",String(isAm)); pm.setAttribute("aria-pressed",String(!isAm));
  am.dataset.chosen=isAm?"1":""; pm.dataset.chosen=!isAm?"1":"";
};
function readTimeAnswer(prefix="", wantMeridiem=false){
  const hour=$("#"+prefix+"hourInput")?.value.trim()||"";
  const minute=$("#"+prefix+"minuteInput")?.value.trim()||"";
  if(!hour && !minute) return "";
  if(!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;
  const h=Number(hour), m=Number(minute);
  if(h>23 || m>59) return null;
  const base=`${h}:${String(m).padStart(2,"0")}`;
  if(wantMeridiem){
    const am=document.getElementById(prefix+"amBtn"), pm=document.getElementById(prefix+"pmBtn");
    const chosen = am?.dataset.chosen ? "AM" : (pm?.dataset.chosen ? "PM" : "");
    if(!chosen) return null; // must pick AM or PM before submitting
    return `${base} ${chosen}`;
  }
  return base;
}


const drawingState = {strokes:[],active:null};


function fractionAnswerMarkup(prefix=""){
  return `<div class="fraction-answer">
    <div class="field"><label>Numerator</label><input id="${prefix}Numerator" inputmode="numeric" pattern="[0-9-]*"></div>
    <span class="fraction-bar" aria-hidden="true"></span>
    <div class="field"><label>Denominator</label><input id="${prefix}Denominator" inputmode="numeric" pattern="[0-9]*"></div>
  </div>`;
}
function readFractionAnswer(prefix=""){
  const n=($("#"+prefix+"Numerator")?.value||"").trim(),d=($("#"+prefix+"Denominator")?.value||"").trim();
  if(!n||!d||Number(d)===0)return null;
  return `${Number(n)}/${Number(d)}`;
}
function fractionVisualMarkup(q){
  const denominator=Math.max(2,Math.min(12,Number(q.denominator||String(q.answer||"").split("/")[1])||4));
  const selected=Number(state.interactiveAnswers[state.index]||0);
  return `<div class="fraction-visual"><div class="drawing-instruction">Tap pieces to shade the fraction.</div><div class="fraction-pieces">${Array.from({length:denominator},(_,i)=>`<button class="fraction-piece ${i<selected?"selected":""}" onclick="setFractionPieces(${i+1})"></button>`).join("")}</div><p><strong>${selected}/${denominator}</strong> shaded</p></div>`;
}
window.setFractionPieces=n=>{state.interactiveAnswers[state.index]=n;renderQuestion();};

function answerWithUnitMarkup(id,unit){return `<div class="answer-with-unit"><button type="button" class="sign-toggle" onclick="toggleAnswerSign('${id}')" aria-label="Make the answer negative or positive" title="Make negative / positive">±</button><input id="${id}" inputmode="decimal" autocomplete="off" placeholder="Type your answer">${unit?`<span class="answer-unit">${esc(unit)}</span>`:""}</div>`;}

// Toggle a leading minus on a numeric answer. Phone number pads have no minus
// key, so this button is how a child enters a negative answer (e.g. -1 for
// (21÷7)−(12÷3)). Only affects the sign; the typed digits are untouched.
window.toggleAnswerSign=id=>{
  const el=document.getElementById(id);
  if(!el) return;
  const v=String(el.value||"").trim();
  el.value = v.startsWith("-") ? v.slice(1) : (v===""?"-":"-"+v);
  el.focus();
  // Keep any oninput-driven state (e.g. MC fallback selection) in sync.
  el.dispatchEvent(new Event("input",{bubbles:true}));
};
function multipartMarkup(q){return `<div class="multipart-answer">${(q.parts||[]).map((p,i)=>`<section class="student-part"><div class="student-part-heading"><span>${esc(p.label||String.fromCharCode(97+i))}</span>${esc(p.prompt||"")}</div>${p.type==="time"?`<div class="time-answer"><div class="time-field"><label>Hour</label><input id="partHour${i}" inputmode="numeric" maxlength="2"></div><span class="time-colon">:</span><div class="time-field"><label>Minutes</label><input id="partMinute${i}" inputmode="numeric" maxlength="2" placeholder="00"></div>${timeNeedsMeridiem(p)?`<div class="meridiem-toggle" role="group" aria-label="Choose AM or PM"><button type="button" id="partAm${i}" class="meridiem-btn" onclick="setMeridiemPart(${i},'AM')">AM</button><button type="button" id="partPm${i}" class="meridiem-btn" onclick="setMeridiemPart(${i},'PM')">PM</button></div>`:""}${p.answer_unit?`<span class="answer-unit">${esc(p.answer_unit)}</span>`:""}</div>`:p.type==="sequence"?sequenceMarkup(`partSeq${i}`,p):answerWithUnitMarkup(`partAnswer${i}`,p.answer_unit||"")}</section>`).join("")}</div>`;}

// Sequence input: one small number box per expected value, so a child can enter
// a list like 20, 22, 24 on a plain numeric keypad — no comma needed (phone
// number pads have no comma key). The box count comes from the answer, or from
// an explicit sequence_count the teacher set.
function sequenceCount(item){
  if(Number(item?.sequence_count)>0) return Number(item.sequence_count);
  const parts=String(item?.answer??"").split(/[,\s]+/).map(s=>s.trim()).filter(Boolean);
  return Math.max(1,parts.length);
}
function sequenceMarkup(idBase,item){
  const count=sequenceCount(item);
  // answer_unit may be a single unit ("cm") shown once at the end, OR a comma
  // list ("cm,mm") giving each box its own unit — used for unit-conversion
  // questions like "98mm = _ cm _ mm". Per-box units read far more clearly.
  const unitList=String(item.answer_unit||"").split(",").map(u=>u.trim()).filter(Boolean);
  const perBoxUnits = unitList.length>1;
  const boxes=Array.from({length:count},(_,k)=>{
    const box=`<input id="${idBase}_${k}" class="sequence-box" inputmode="decimal" autocomplete="off" aria-label="Number ${k+1} of ${count}${perBoxUnits&&unitList[k]?` (${unitList[k]})`:""}">`;
    if(perBoxUnits){
      return `<span class="sequence-unit-group">${box}${unitList[k]?`<span class="sequence-unit">${esc(unitList[k])}</span>`:""}</span>`;
    }
    return box;
  }).join(perBoxUnits ? "" : '<span class="sequence-sep">,</span>');
  const trailingUnit = (!perBoxUnits && item.answer_unit) ? `<span class="answer-unit">${esc(item.answer_unit)}</span>` : "";
  return `<div class="sequence-answer"><div class="sequence-hint">Fill each box in order.</div><div class="sequence-boxes">${boxes}</div>${trailingUnit}</div>`;
}
// Collect the boxes into a normalised comma string ("20,22,24"). Returns null if
// any box is empty so the child is prompted to complete it. Order is preserved,
// which matters for number sequences.
function readSequenceAnswer(idBase,count){
  const vals=[];
  for(let k=0;k<count;k++){
    const v=($(`#${idBase}_${k}`)?.value||"").trim();
    if(v==="") return null;
    vals.push(v);
  }
  return vals.join(",");
}
window.setMeridiemPart=(i,val)=>{
  const am=document.getElementById("partAm"+i), pm=document.getElementById("partPm"+i);
  if(!am||!pm) return;
  const isAm=val==="AM";
  am.classList.toggle("selected",isAm); pm.classList.toggle("selected",!isAm);
  am.dataset.chosen=isAm?"1":""; pm.dataset.chosen=!isAm?"1":"";
};
function readMultipartAnswer(q){const v=[];for(let i=0;i<(q.parts||[]).length;i++){const p=q.parts[i];if(p.type==="time"){const hr=$(`#partHour${i}`)?.value.trim()||"",mn=$(`#partMinute${i}`)?.value.trim()||"";if(!hr||!mn||Number(mn)>59)return null;let t=`${Number(hr)}:${mn.padStart(2,"0")}`;if(timeNeedsMeridiem(p)){const am=document.getElementById("partAm"+i),pm=document.getElementById("partPm"+i);const chosen=am?.dataset.chosen?"AM":(pm?.dataset.chosen?"PM":"");if(!chosen)return null;t=`${t} ${chosen}`;}v.push(t);}else if(p.type==="sequence"){const s=readSequenceAnswer(`partSeq${i}`,sequenceCount(p));if(s===null)return null;v.push(s);}else{const x=$(`#partAnswer${i}`)?.value.trim()||"";if(!x)return null;v.push(x);}}return v;}
function multipartIsCorrect(g,q){return Array.isArray(g)&&g.length===(q.parts||[]).length&&q.parts.every((p,i)=>p.type==="sequence"?sequenceIsCorrect(g[i],p.answer):isCorrect(g[i],p.answer));}


function parseNumberList(value,fallback=[]){
  if(Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  try{
    const parsed=JSON.parse(String(value||""));
    return Array.isArray(parsed)?parsed.map(Number).filter(Number.isFinite):fallback;
  }catch{return fallback;}
}
function parseStringList(value){
  if(Array.isArray(value)) return value.map(String);
  return String(value||"").split(/\s*\|\s*|\s*,\s*/).map(x=>x.trim()).filter(Boolean);
}
function coordinateAnswerConfig(q){
  const expected=parseNumberList(q.coordinate_answer,parseNumberList(q.answer,[0,0]));
  return {answer:[expected[0]??0,expected[1]??0]};
}
function coordinateAnswerMarkup(q){
  const existing=state.interactiveAnswers[state.index];
  const xValue=Array.isArray(existing)&&existing[0]!=null?existing[0]:"";
  const yValue=Array.isArray(existing)&&existing[1]!=null?existing[1]:"";
  return `<div class="coordinate-answer-card"><div class="coordinate-answer-title">Enter the coordinates</div><div class="coordinate-pair-input"><span class="coordinate-bracket">(</span><div class="coordinate-field"><label for="coordinateX">x</label><input id="coordinateX" inputmode="decimal" value="${esc(String(xValue))}" placeholder="x" oninput="saveCoordinateInput()"></div><span class="coordinate-comma">,</span><div class="coordinate-field"><label for="coordinateY">y</label><input id="coordinateY" inputmode="decimal" value="${esc(String(yValue))}" placeholder="y" oninput="saveCoordinateInput()"></div><span class="coordinate-bracket">)</span></div><p class="small muted coordinate-help">Enter x first, then y.</p></div>`;
}
window.saveCoordinateInput=()=>{
  const x=$("#coordinateX")?.value.trim(),y=$("#coordinateY")?.value.trim();
  state.interactiveAnswers[state.index]=[x===""?null:Number(x),y===""?null:Number(y)];
};
function coordinateTypedAnswer(){
  saveCoordinateInput(); const v=state.interactiveAnswers[state.index];
  return Array.isArray(v)&&Number.isFinite(v[0])&&Number.isFinite(v[1])?JSON.stringify(v):null;
}
function pointConfig(q){
  const answer=parseNumberList(q.point_answer,parseNumberList(q.answer,[0,0]));
  const ax=answer[0]??0, ay=answer[1]??0;

  // The AI often omits grid_bounds or returns the -5..5 placeholder, which is
  // wrong for the many primary worksheets that use a 0..5 (first-quadrant) grid.
  // Only trust supplied bounds when they actually contain the answer point and
  // form a valid, non-placeholder range; otherwise derive bounds from the data.
  const supplied=parseNumberList(q.grid_bounds,[]);
  const isPlaceholder=supplied.length===4 &&
    supplied[0]===-5 && supplied[1]===5 && supplied[2]===-5 && supplied[3]===5;
  const contains=b=>b.length===4 &&
    b[0]<b[1] && b[2]<b[3] &&
    ax>=b[0] && ax<=b[1] && ay>=b[2] && ay<=b[3];

  let xmin,xmax,ymin,ymax;
  if(supplied.length===4 && !isPlaceholder && contains(supplied)){
    [xmin,xmax,ymin,ymax]=supplied;
  }else{
    // Derive a clean grid that contains both the origin and the answer point.
    // If nothing is negative, keep it first-quadrant (0-based), matching the
    // common primary-school layout. Pad the max by 1 so the point isn't jammed
    // into the corner, and round up to a tidy bound (min span of 5).
    const padTo=v=>Math.max(5,Math.ceil((v+1)/1)*1);
    xmin=Math.min(0,ax); ymin=Math.min(0,ay);
    xmax=xmin<0 ? padTo(Math.max(Math.abs(ax),5)) : padTo(ax);
    ymax=ymin<0 ? padTo(Math.max(Math.abs(ay),5)) : padTo(ay);
    if(xmin<0) xmin=-xmax;
    if(ymin<0) ymin=-ymax;
  }

  return {
    xmin,xmax,ymin,ymax,
    step:Math.max(.25,Number(q.grid_step)||1),
    answer:[ax,ay]
  };
}
function coordinateToSvg(x,y,c,size=320,pad=28){
  const width=size-pad*2,height=size-pad*2;
  return {
    sx:pad+((x-c.xmin)/(c.xmax-c.xmin))*width,
    sy:pad+((c.ymax-y)/(c.ymax-c.ymin))*height
  };
}
function svgToCoordinate(clientX,clientY,svg,c,size=320,pad=28){
  const rect=svg.getBoundingClientRect();
  const px=(clientX-rect.left)/rect.width*size;
  const py=(clientY-rect.top)/rect.height*size;
  const rawX=c.xmin+((px-pad)/(size-pad*2))*(c.xmax-c.xmin);
  const rawY=c.ymax-((py-pad)/(size-pad*2))*(c.ymax-c.ymin);
  const snap=v=>Math.round(v/c.step)*c.step;
  return [
    Math.max(c.xmin,Math.min(c.xmax,snap(rawX))),
    Math.max(c.ymin,Math.min(c.ymax,snap(rawY)))
  ];
}
function pointGridMarkup(q){
  const c=pointConfig(q),size=320,pad=28;
  let lines="",labels="",dots="";
  const origin=coordinateToSvg(0,0,c,size,pad);
  for(let x=Math.ceil(c.xmin/c.step)*c.step;x<=c.xmax+1e-9;x+=c.step){
    const p=coordinateToSvg(x,0,c,size,pad),major=Math.abs(x)<1e-9;
    lines+=`<line x1="${p.sx}" y1="${pad}" x2="${p.sx}" y2="${size-pad}" class="${major?"axis":"grid-line"}"/>`;
    if(!major&&Number.isInteger(x))labels+=`<text x="${p.sx}" y="${origin.sy+17}" text-anchor="middle">${x}</text>`;
  }
  for(let y=Math.ceil(c.ymin/c.step)*c.step;y<=c.ymax+1e-9;y+=c.step){
    const p=coordinateToSvg(0,y,c,size,pad),major=Math.abs(y)<1e-9;
    lines+=`<line x1="${pad}" y1="${p.sy}" x2="${size-pad}" y2="${p.sy}" class="${major?"axis":"grid-line"}"/>`;
    if(!major&&Number.isInteger(y))labels+=`<text x="${origin.sx-10}" y="${p.sy+4}" text-anchor="end">${y}</text>`;
  }
  for(let x=Math.ceil(c.xmin/c.step)*c.step;x<=c.xmax+1e-9;x+=c.step){for(let y=Math.ceil(c.ymin/c.step)*c.step;y<=c.ymax+1e-9;y+=c.step){const p=coordinateToSvg(x,y,c,size,pad);dots+=`<circle cx="${p.sx}" cy="${p.sy}" r="3.5" class="grid-point-dot"/>`;}}
  const selected=state.interactiveAnswers[state.index];
  const marker=Array.isArray(selected)?coordinateToSvg(selected[0],selected[1],c,size,pad):null;
  return `<div class="point-interaction"><div class="drawing-instruction">Tap the correct point on the grid.</div><svg id="pointGrid" class="coordinate-grid" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet" onclick="selectGridPoint(event)">${lines}${labels}${dots}${marker?`<circle cx="${marker.sx}" cy="${marker.sy}" r="15" class="selected-point-halo"/><circle cx="${marker.sx}" cy="${marker.sy}" r="8" class="selected-point-green"/>`:""}</svg><div class="selected-coordinate">${marker?`Selected: <strong>(${selected[0]}, ${selected[1]})</strong>`:"No point selected yet"}</div></div>`;
}
window.selectGridPoint=event=>{
  const q=state.homework.questions[state.index],svg=event.currentTarget,c=pointConfig(q);
  state.interactiveAnswers[state.index]=svgToCoordinate(event.clientX,event.clientY,svg,c);
  renderQuestion();
};

function matchingConfig(q){
  return {
    left:parseStringList(q.matching_left),
    right:parseStringList(q.matching_right),
    pairs:parseStringList(q.matching_pairs)
  };
}
function matchingMarkup(q){
  const c=matchingConfig(q);
  const answers=state.interactiveAnswers[state.index]||{};
  const selected=state.matchingSelections[state.index];
  return `<div class="matching-interaction">
    <div class="drawing-instruction">Tap an item on the left, then tap its match on the right.</div>
    <div class="matching-board" id="matchingBoard">
      <svg class="matching-lines" aria-hidden="true"></svg>
      <div class="matching-column">${c.left.map((item,i)=>`<button type="button" class="match-item left ${selected===i?"selected":""} ${answers[i]!=null?"matched":""}" data-side="left" data-index="${i}" onclick="chooseMatchLeft(${i})">${esc(item)}</button>`).join("")}</div>
      <div class="matching-column">${c.right.map((item,i)=>`<button type="button" class="match-item right ${Object.values(answers).includes(i)?"matched":""}" data-side="right" data-index="${i}" onclick="chooseMatchRight(${i})">${esc(item)}</button>`).join("")}</div>
    </div>
    <div class="matching-actions"><button type="button" class="btn secondary" onclick="clearMatches()">Clear matches</button><span>${Object.keys(answers).length} of ${c.left.length} connected</span></div>
  </div>`;
}
window.chooseMatchLeft=i=>{state.matchingSelections[state.index]=i;renderQuestion();setTimeout(drawMatchingLines,30);};
window.chooseMatchRight=i=>{
  const left=state.matchingSelections[state.index];
  if(left==null) return alert("Choose an item on the left first.");
  state.interactiveAnswers[state.index] ||= {};
  Object.keys(state.interactiveAnswers[state.index]).forEach(k=>{
    if(state.interactiveAnswers[state.index][k]===i) delete state.interactiveAnswers[state.index][k];
  });
  state.interactiveAnswers[state.index][left]=i;
  state.matchingSelections[state.index]=null;
  renderQuestion();setTimeout(drawMatchingLines,30);
};
window.clearMatches=()=>{state.interactiveAnswers[state.index]={};state.matchingSelections[state.index]=null;renderQuestion();};
function drawMatchingLines(){
  const board=document.querySelector("#matchingBoard"),svg=board?.querySelector(".matching-lines");
  if(!board||!svg) return;
  const rect=board.getBoundingClientRect();
  svg.setAttribute("viewBox",`0 0 ${rect.width} ${rect.height}`);
  const answers=state.interactiveAnswers[state.index]||{};
  svg.innerHTML=Object.entries(answers).map(([li,ri])=>{
    const l=board.querySelector(`[data-side="left"][data-index="${li}"]`)?.getBoundingClientRect();
    const r=board.querySelector(`[data-side="right"][data-index="${ri}"]`)?.getBoundingClientRect();
    if(!l||!r)return "";
    return `<line x1="${l.right-rect.left}" y1="${l.top+l.height/2-rect.top}" x2="${r.left-rect.left}" y2="${r.top+r.height/2-rect.top}"/>`;
  }).join("");
}
function matchingAnswer(q){
  const c=matchingConfig(q),answers=state.interactiveAnswers[state.index]||{};
  if(Object.keys(answers).length!==c.left.length) return null;
  return c.left.map((_,i)=>`${i}:${answers[i]}`).join("|");
}
function expectedMatchingAnswer(q){
  const c=matchingConfig(q);
  const rightIndex=new Map(c.right.map((v,i)=>[String(v),i]));
  const leftIndex=new Map(c.left.map((v,i)=>[String(v),i]));
  const result={};
  c.pairs.forEach(pair=>{
    const [a,b]=String(pair).split(/\s*(?:->|=|:)\s*/);
    const li=leftIndex.has(a)?leftIndex.get(a):Number(a);
    const ri=rightIndex.has(b)?rightIndex.get(b):Number(b);
    if(Number.isInteger(li)&&Number.isInteger(ri)) result[li]=ri;
  });
  return c.left.map((_,i)=>`${i}:${result[i]}`).join("|");
}


function dragMarkup(q){
  const count=Math.max(1,Math.min(20,Number(q.drag_item_count)||8));
  const placed=Number(state.interactiveAnswers[state.index]||0);
  return `<div class="drag-interaction"><div class="drag-bank">${Array.from({length:count},(_,i)=>`<button class="drag-object ${i<placed?"placed":""}" draggable="true" ondragstart="dragObjectStart(event)" onclick="toggleDragObject(${i})">●</button>`).join("")}</div><div class="drop-zone" ondragover="event.preventDefault()" ondrop="dropObject(event)"><strong>Drop objects here</strong><span>${placed} placed</span></div></div>`;
}
window.dragObjectStart=e=>e.dataTransfer.setData("text/plain","1");
window.dropObject=e=>{e.preventDefault();state.interactiveAnswers[state.index]=Math.min(Number(state.interactiveAnswers[state.index]||0)+1,Number(state.homework.questions[state.index].drag_item_count)||8);renderQuestion();};
window.toggleDragObject=i=>{const current=Number(state.interactiveAnswers[state.index]||0);state.interactiveAnswers[state.index]=i<current?i:Math.max(current,i+1);renderQuestion();};
function dragAnswer(){return Number(state.interactiveAnswers[state.index]||0);}

const clockState={dragging:null};
function clockMarkup(q){
  const value=state.interactiveAnswers[state.index]||q.clock_start||"12:00";
  const [h,m]=String(value).split(":").map(Number);
  const minuteAngle=(m||0)*6,hourAngle=((h%12)+(m||0)/60)*30;
  return `<div class="clock-interaction"><svg id="clockFace" class="clock-face" width="300" height="300" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid meet" onpointermove="moveClockHand(event)" onpointerup="endClockHand()" onpointercancel="endClockHand()"><circle cx="150" cy="150" r="125"/><g class="clock-numbers">${Array.from({length:12},(_,i)=>{const n=i+1,a=n*Math.PI/6,x=150+102*Math.sin(a),y=150-102*Math.cos(a);return `<text x="${x}" y="${y+5}" text-anchor="middle">${n}</text>`}).join("")}</g><line class="hour-hand" x1="150" y1="150" x2="${150+65*Math.sin(hourAngle*Math.PI/180)}" y2="${150-65*Math.cos(hourAngle*Math.PI/180)}" onpointerdown="startClockHand(event,'hour')"/><line class="minute-hand" x1="150" y1="150" x2="${150+94*Math.sin(minuteAngle*Math.PI/180)}" y2="${150-94*Math.cos(minuteAngle*Math.PI/180)}" onpointerdown="startClockHand(event,'minute')"/><circle class="clock-pin" cx="150" cy="150" r="8"/></svg><p class="selected-coordinate">Selected time: <strong>${String(h||12).padStart(2,"0")}:${String(m||0).padStart(2,"0")}</strong></p></div>`;
}
window.startClockHand=(e,hand)=>{e.preventDefault();clockState.dragging=hand;e.currentTarget.setPointerCapture?.(e.pointerId);};
window.moveClockHand=e=>{
  if(!clockState.dragging)return;const svg=e.currentTarget,r=svg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*300-150,y=(e.clientY-r.top)/r.height*300-150;
  let deg=(Math.atan2(x,-y)*180/Math.PI+360)%360;
  const current=String(state.interactiveAnswers[state.index]||"12:00").split(":").map(Number);
  let h=current[0]||12,m=current[1]||0;
  if(clockState.dragging==="minute")m=(Math.round(deg/30)*5)%60;else h=(Math.round(deg/30)%12)||12;
  state.interactiveAnswers[state.index]=`${h}:${String(m).padStart(2,"0")}`;renderQuestion();clockState.dragging=clockState.dragging;
};
window.endClockHand=()=>clockState.dragging=null;
function clockAnswer(){return state.interactiveAnswers[state.index]||null;}

function angleMarkup(q){
  const target=Number(q.answer)||60,selected=Number(state.interactiveAnswers[state.index]??q.angle_start??45);
  const rad=selected*Math.PI/180,x=80+120*Math.cos(rad),y=160-120*Math.sin(rad);
  return `<div class="angle-interaction"><svg class="angle-tool" width="240" height="190" viewBox="0 0 240 190" preserveAspectRatio="xMidYMid meet"><path d="M20 160 A140 140 0 0 1 220 160" class="protractor"/><line x1="80" y1="160" x2="210" y2="160" class="angle-base"/><line x1="80" y1="160" x2="${x}" y2="${y}" class="angle-ray"/><circle cx="${x}" cy="${y}" r="13" class="angle-handle"/></svg><label>Move the ray: <strong>${selected}°</strong></label><input class="angle-slider" type="range" min="0" max="180" step="1" value="${selected}" oninput="setAngleValue(this.value)"></div>`;
}
window.setAngleValue=v=>{state.interactiveAnswers[state.index]=Number(v);renderQuestion();};


function drawingMarkup(q){
  return `<div class="drawing-answer">
    <div class="drawing-instruction">Draw your answer directly on the image. You can draw more than one line.</div>
    <div class="drawing-canvas-wrap">
      <img id="drawingBaseImage" src="${q.visual_data_url||""}" alt="Diagram for drawing question">
      <canvas id="drawingCanvas" aria-label="Drawing answer area"></canvas>
    </div>
    <div class="drawing-tools">
      <button class="btn secondary" type="button" onclick="undoDrawingLine()">↶ Undo</button>
      <button class="btn ghost" type="button" onclick="clearDrawingLines()">Clear</button>
    </div>
    <div class="small muted">This drawing will be saved for a teacher or parent to review.</div>
  </div>`;
}

function initialiseDrawingCanvas(){
  const img=$("#drawingBaseImage"), canvas=$("#drawingCanvas");
  if(!img || !canvas) return;
  const size=()=>{
    const rect=img.getBoundingClientRect();
    const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.round(rect.width*dpr));
    canvas.height=Math.max(1,Math.round(rect.height*dpr));
    canvas.style.width=`${rect.width}px`;
    canvas.style.height=`${rect.height}px`;
    drawStoredLines();
  };
  if(img.complete) size(); else img.onload=size;
  canvas.addEventListener("pointerdown",e=>{
    e.preventDefault();
    const p=drawingPoint(e,canvas);
    drawingState.active={start:p,end:p};
    canvas.setPointerCapture?.(e.pointerId);
    drawStoredLines();
  });
  canvas.addEventListener("pointermove",e=>{
    if(!drawingState.active) return;
    drawingState.active.end=drawingPoint(e,canvas);
    drawStoredLines();
  });
  canvas.addEventListener("pointerup",e=>{
    if(!drawingState.active) return;
    const line=drawingState.active;
    drawingState.active=null;
    const distance=Math.hypot(line.end.x-line.start.x,line.end.y-line.start.y);
    if(distance>.025) drawingState.strokes.push(line);
    drawStoredLines();
  });
}

function drawingPoint(e,canvas){
  const rect=canvas.getBoundingClientRect();
  return {
    x:Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),
    y:Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height))
  };
}

function drawStoredLines(){
  const canvas=$("#drawingCanvas");
  if(!canvas) return;
  const ctx=canvas.getContext("2d");
  const dpr=canvas.width/Math.max(1,canvas.getBoundingClientRect().width);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.lineCap="round";
  ctx.lineJoin="round";
  ctx.strokeStyle="#6543d9";
  ctx.lineWidth=5*dpr;
  const lines=[...drawingState.strokes,...(drawingState.active?[drawingState.active]:[])];
  for(const line of lines){
    ctx.beginPath();
    ctx.moveTo(line.start.x*canvas.width,line.start.y*canvas.height);
    ctx.lineTo(line.end.x*canvas.width,line.end.y*canvas.height);
    ctx.stroke();
  }
}

window.undoDrawingLine=()=>{drawingState.strokes.pop();drawStoredLines();};
window.clearDrawingLines=()=>{drawingState.strokes=[];drawingState.active=null;drawStoredLines();};

function drawingAnswer(){
  if(!drawingState.strokes.length) return "";
  const canvas=$("#drawingCanvas");
  const strokesOnly=canvas?.toDataURL("image/png")||"";

  // The child draws on a transparent canvas laid over the worksheet image, so
  // the canvas alone is just floating strokes with no context — the AI marker
  // can't see the eggs, numbers or nests underneath. Composite the worksheet and
  // the strokes into ONE image so the marker sees exactly what the child sees.
  let composite=strokesOnly;
  try{
    const base=$("#drawingBaseImage");
    if(base && base.naturalWidth){
      const c=document.createElement("canvas");
      c.width=base.naturalWidth; c.height=base.naturalHeight;
      const ctx=c.getContext("2d");
      ctx.drawImage(base,0,0,c.width,c.height);
      if(canvas) ctx.drawImage(canvas,0,0,c.width,c.height);
      composite=c.toDataURL("image/png");
    }
  }catch{ /* fall back to strokes-only if the base image is cross-origin/tainted */ }

  return JSON.stringify({
    strokes:drawingState.strokes,
    preview:strokesOnly,      // kept for the teacher review overlay
    composite                 // worksheet + strokes, for AI marking
  });
}


function questionHintTiers(q){
  const supplied=Array.isArray(q.hints)?q.hints.map(x=>String(x||"").trim()).filter(Boolean):[];
  const first=String(q.hint||supplied[0]||"Look carefully at what the question is asking.").trim();
  const explanation=String(q.explanation||"Break the problem into smaller steps and use the information given.").trim();
  return [
    first,
    supplied[1]||"Which maths idea or operation would help you solve this?",
    supplied[2]||"Split the problem into smaller steps and solve one step at a time.",
    supplied[3]||explanation
  ];
}
function hintTierName(level){
  return ["","Small clue","Strategy clue","Step-by-step support","Show the method"][level]||"Hint";
}
function ensureAttemptRecord(){
  if(state.attempts[state.index]) return state.attempts[state.index];
  const record={question_index:state.index,first_answer:null,first_correct:null,retries:0,mastered:false,hint_used:false,highest_hint_level:0,hint_count:0,hint_events:[],question_started_at:Date.now()};
  state.attempts[state.index]=record;
  return record;
}

function renderQuestion(){
  const q=state.homework.questions[state.index], n=state.homework.questions.length;
  const currentRecord=state.attempts[state.index];
  if(currentRecord && !currentRecord.question_started_at) currentRecord.question_started_at=Date.now();
  const pct=(state.index/n)*100;
  const body=q.type==="multiple_choice"
    ? ((q.options||[]).filter(o=>String(o).trim()).length>=2
        ? `<div class="options">${(q.options||[]).map(o=>`<button class="option ${state.selected===String(o)?"selected":""}" onclick="selectOption('${js(String(o))}',{spoken:true})">${esc(String(o))}</button>`).join("")}</div>`
        : `<div class="mc-fallback-note">Type your answer below.</div><input id="answerInput" class="answer-input" inputmode="numeric" autocomplete="off" placeholder="Your answer" value="${esc(state.selected||"")}" oninput="selectOption(this.value)">`)
    : q.type==="drawing"
      ? drawingMarkup(q)
      : q.type==="point"
        ? pointGridMarkup(q)
        : q.type==="coordinate"
          ? coordinateAnswerMarkup(q)
          : q.type==="matching"
          ? matchingMarkup(q)
          : q.type==="fraction"
            ? fractionAnswerMarkup("")
            : q.type==="fraction_visual"
              ? fractionVisualMarkup(q)
              : q.type==="shade"
                ? shadeMarkup(q)
              : q.type==="clock"
                ? clockMarkup(q)
                : q.type==="drag"
                  ? dragMarkup(q)
                  : q.type==="angle"
                    ? angleMarkup(q)
                    : q.type==="sequence"
                      ? sequenceMarkup("seqInput",q)
                    : q.type==="multipart"
        ? multipartMarkup(q)
        : isTimeQuestion(q)
          ? timeAnswerMarkup("",q)
          : answerWithUnitMarkup("answerInput",q.answer_unit||"");
  app.innerHTML=shell(`
    <div class="row between"><strong>Question ${state.index+1} of ${n}</strong><span class="pill">${esc(q.topic||state.homework.topic)}</span></div>
    <div class="progress" style="margin:12px 0"><div style="width:${pct}%"></div></div>
    <div class="row wrap voice-row">
      ${voiceControl()}
      <button class="btn voice-btn" onclick="readCurrentQuestion()">▶ Read question</button>
    </div>
    <div class="card">
      ${q.visual_data_url && q.type!=="drawing" ? `<figure class="student-question-visual"><img src="${q.visual_data_url}" alt="Diagram for this question"></figure>` : ""}
      <div class="question-text">${formatMath(q.prompt)}</div>
      ${body}
      <button class="btn primary block" style="margin-top:18px" onclick="checkAnswer()">Check answer</button>
    </div>
    <button class="btn ghost block hint-entry-btn" onclick="showHint()">💡 Need a small clue?</button>
  `);
  if(q.type==="matching") setTimeout(drawMatchingLines,60);
  if(q.type==="drawing"){
    drawingState.strokes=[];
    drawingState.active=null;
    setTimeout(initialiseDrawingCanvas,80);
  }
  if (state.voiceEnabled) setTimeout(() => speak(`Question ${state.index + 1}. ${q.prompt}`), 120);
}
window.selectOption=(v,opts={})=>{
  state.selected=v;
  // For a multiple-choice CHOICE (a button tap), don't re-render the whole
  // question — that would re-read the question aloud. Instead update just the
  // option highlighting and read the SELECTED OPTION aloud, so the child hears
  // what they picked. For the typed-answer fallback we neither re-render nor
  // speak (that would talk on every keystroke).
  if(opts.spoken){
    document.querySelectorAll(".options .option").forEach(btn=>{
      btn.classList.toggle("selected", btn.textContent===String(v));
    });
    if(state.voiceEnabled) speak(String(v), true);
    return;
  }
};
function getStudentAnswer(q){
  if(q.type==="multiple_choice") return state.selected;
  if(q.type==="shade"){
    const sel=(state.shadeSelection instanceof Set)?[...state.shadeSelection]:[];
    return sel.length?JSON.stringify(sel):null;
  }
  if(q.type==="drawing") return drawingAnswer();
  if(q.type==="point"){
    const v=state.interactiveAnswers[state.index];
    return Array.isArray(v)?JSON.stringify(v):null;
  }
  if(q.type==="coordinate") return coordinateTypedAnswer();
  if(q.type==="matching") return matchingAnswer(q);
  if(q.type==="fraction") return readFractionAnswer("");
  if(q.type==="fraction_visual"){
    const d=Math.max(2,Number(q.denominator||String(q.answer||"").split("/")[1])||4);
    const n=Number(state.interactiveAnswers[state.index]||0);
    return n?`${n}/${d}`:null;
  }
  if(q.type==="clock") return clockAnswer();
  if(q.type==="drag") return dragAnswer(q);
  if(q.type==="angle") return String(state.interactiveAnswers[state.index]??"");
  if(q.type==="sequence") return readSequenceAnswer("seqInput",sequenceCount(q));
  if(q.type==="multipart") return readMultipartAnswer(q);
  if(isTimeQuestion(q)) return readTimeAnswer("", timeNeedsMeridiem(q));
  const typed=($("#answerInput")?.value||"").trim();
  // A lone "-" or "-." (child tapped ± before typing digits) is not an answer.
  return /^-\.?$/.test(typed) ? "" : typed;
}
function normalise(v){
  let raw=String(v).trim().toLowerCase().replace(/\s+/g,"").replace(/,/g,"");
  // A stored answer may carry a true minus sign "−" (U+2212) from extraction,
  // while a child types a hyphen "-" on the keypad. Treat them as equal. Also
  // fold other dash-like characters to a plain hyphen.
  raw=raw.replace(/[\u2212\u2012\u2013\u2014]/g,"-");
  // Time with optional am/pm: canonicalise to "h:mm" or "h:mmam"/"h:mmpm".
  const tm=raw.match(/^(\d{1,2}):(\d{1,2})(a\.?m\.?|p\.?m\.?)?$/);
  if(tm){
    const base=`${Number(tm[1])}:${String(Number(tm[2])).padStart(2,"0")}`;
    if(tm[3]){ return base + (tm[3][0]==="p" ? "pm" : "am"); }
    return base;
  }
  // Money: a phone keypad can't type £/$ or a trailing "p"/"pence", so a child
  // types the plain number. Strip a leading currency symbol and a trailing pence
  // marker when the rest is numeric, and drop a trailing ".00", so "£2.37",
  // "2.37", "108p" and "108" compare on their numeric value. This lets a child's
  // digit-only answer match a stored answer that carries the symbol.
  const money=raw.match(/^[£$]?(\d+(?:\.\d+)?)(p|pence)?$/);
  if(money){
    let n=money[1];
    if(n.includes(".")) n=n.replace(/0+$/,"").replace(/\.$/,""); // 2.50 -> 2.5, 2.00 -> 2
    return n;
  }
  return raw;
}
function isCorrect(given,answer){
  // Word-answer leniency: if either side contains alphabetic words, compare with
  // tolerance for "and", commas, hyphens, spacing and case — and also accept the
  // numeric equivalent (so a child may answer "4602" for "four thousand six
  // hundred and two", or vice versa).
  const g=String(given), a=String(answer);
  if(/[a-z]/i.test(g) || /[a-z]/i.test(a)){
    if(looseWords(g)===looseWords(a)) return true;
    // Cross-check numeric equivalence in both directions.
    const gNum=wordsToNumber(g), aNum=wordsToNumber(a);
    if(gNum!=null && aNum!=null && gNum===aNum) return true;
    if(gNum!=null && /^-?\d+$/.test(a.trim()) && gNum===Number(a.trim())) return true;
    if(aNum!=null && /^-?\d+$/.test(g.trim()) && aNum===Number(g.trim())) return true;
    return false;
  }
  return normalise(given)===normalise(answer);
}
// Normalise a worded answer: lowercase, drop "and", strip punctuation/hyphens,
// collapse spaces. So "Four thousand, six hundred and two" and
// "four thousand six hundred two" compare equal.
function looseWords(s){
  return String(s).toLowerCase()
    .replace(/[,\-]/g," ")
    .replace(/\band\b/g," ")
    .replace(/[^a-z0-9 ]/g,"")
    .replace(/\s+/g," ").trim();
}
// Convert a spelled-out whole number (up to millions) to a Number, or null if it
// isn't a clean number phrase. Good enough for primary-school magnitudes.
function wordsToNumber(s){
  const clean=looseWords(s);
  if(!clean || /[a-z]/.test(clean)===false) return null; // no words -> not our job
  const units={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19};
  const tens={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
  const scales={hundred:100,thousand:1000,million:1000000};
  const tokens=clean.split(" ");
  let total=0, current=0, sawWord=false;
  for(const t of tokens){
    if(t in units){ current+=units[t]; sawWord=true; }
    else if(t in tens){ current+=tens[t]; sawWord=true; }
    else if(t==="hundred"){ current=(current||1)*100; sawWord=true; }
    else if(t==="thousand"){ total+=(current||1)*1000; current=0; sawWord=true; }
    else if(t==="million"){ total+=(current||1)*1000000; current=0; sawWord=true; }
    else if(/^\d+$/.test(t)){ current+=Number(t); }
    else { return null; } // unknown word -> not a clean number phrase
  }
  return sawWord ? total+current : null;
}
// Compare two sequences element by element, in order. Each element is compared
// numerically where possible (so "20" == "20.0" == " 20 "), otherwise as text.
// This is correct for number sequences where "20,2,24" must NOT equal "20,22,4".
function sequenceIsCorrect(given,answer){
  const g=String(given??"").split(",").map(s=>s.trim()).filter(s=>s!=="");
  const a=String(answer??"").split(/[,\s]+/).map(s=>s.trim()).filter(s=>s!=="");
  if(g.length!==a.length || a.length===0) return false;
  return g.every((val,i)=>{
    const gn=Number(val), an=Number(a[i]);
    return (Number.isFinite(gn)&&Number.isFinite(an)) ? gn===an : normalise(val)===normalise(a[i]);
  });
}
function interactiveIsCorrect(q,given){
  if(q.type==="point"){
    const actual=parseNumberList(given,[]);
    const expected=pointConfig(q).answer;
    return actual.length===2 && Math.abs(actual[0]-expected[0])<1e-9 && Math.abs(actual[1]-expected[1])<1e-9;
  }
  if(q.type==="coordinate"){const actual=parseNumberList(given,[]),expected=coordinateAnswerConfig(q).answer;return actual.length===2&&Math.abs(actual[0]-expected[0])<1e-9&&Math.abs(actual[1]-expected[1])<1e-9;}
  if(q.type==="matching") return String(given)===expectedMatchingAnswer(q);
  if(q.type==="clock") return normalise(given)===normalise(q.answer);
  if(q.type==="drag") return Number(given)===Number(q.answer);
  if(q.type==="angle") return Math.abs(Number(given)-Number(q.answer))<=Number(q.angle_tolerance||2);
  if(q.type==="fraction_visual") return normalise(given)===normalise(q.answer);
  if(q.type==="shade") return shadeIsCorrect(given,q);
  if(q.type==="sequence") return sequenceIsCorrect(given,q.answer);
  return isCorrect(given,q.answer);
}
// Shade a fraction of a grid. `given` is a JSON array of shaded cell indices.
// Correct when the number of shaded cells equals exactly fraction × total cells
// (and that is a whole number). "Shade one-third" of a 9-cell grid => exactly 3
// cells. We check the COUNT, not which specific cells, since any 1/3 of the area
// is a valid answer at this level.
function shadeConfig(q){
  const rows=Math.max(1,Number(q.grid_rows)||0);
  const cols=Math.max(1,Number(q.grid_cols)||0);
  const total=rows*cols;
  const m=String(q.shade_fraction||q.answer||"").match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  const num=m?Number(m[1]):0, den=m?Number(m[2]):0;
  const target=(den>0)? (total*num)/den : NaN;
  return {rows,cols,total,num,den,target,exact:Number.isInteger(target)};
}
function shadeIsCorrect(given,q){
  const cfg=shadeConfig(q);
  if(!cfg.exact || cfg.total<=0) return false;
  let shaded;
  try{ shaded=JSON.parse(given); }catch{ return false; }
  if(!Array.isArray(shaded)) return false;
  // Count distinct valid cells shaded.
  const distinct=new Set(shaded.filter(i=>Number.isInteger(i)&&i>=0&&i<cfg.total));
  return distinct.size===cfg.target;
}
// Render the tappable grid for a "shade a fraction" question. Cells toggle
// shaded/unshaded on tap. The selected cells live in state.shadeSelection.
function shadeMarkup(q){
  const cfg=shadeConfig(q);
  state.shadeSelection=new Set();
  const cells=Array.from({length:cfg.total},(_,i)=>
    `<button type="button" class="shade-cell" data-i="${i}" onclick="toggleShadeCell(${i})" aria-label="Cell ${i+1}"></button>`
  ).join("");
  const fracLabel=cfg.den?`${cfg.num}/${cfg.den}`:String(q.shade_fraction||"");
  return `<div class="shade-answer">
    <div class="shade-hint">Tap squares to shade ${esc(fracLabel)} of the shape.</div>
    <div class="shade-grid" style="grid-template-columns:repeat(${cfg.cols},1fr);max-width:${Math.min(320,cfg.cols*70)}px">${cells}</div>
    <div class="shade-count"><span id="shadeCount">0</span> shaded</div>
  </div>`;
}
window.toggleShadeCell=(i)=>{
  if(!(state.shadeSelection instanceof Set)) state.shadeSelection=new Set();
  const btn=document.querySelector(`.shade-cell[data-i="${i}"]`);
  if(state.shadeSelection.has(i)){ state.shadeSelection.delete(i); btn&&btn.classList.remove("on"); }
  else { state.shadeSelection.add(i); btn&&btn.classList.add("on"); }
  const c=document.getElementById("shadeCount"); if(c) c.textContent=state.shadeSelection.size;
};
// Teacher-side live preview of the shade grid. Renders the grid at the current
// rows/cols and, crucially, warns if the fraction does not divide the grid
// evenly — because in that case there is NO correct number of cells to shade and
// the question is unanswerable. This is the safeguard: the teacher sees and fixes
// a mis-read grid before publishing.
window.refreshShadePreview=(i)=>{
  const box=document.getElementById(`shadePreview${i}`);
  if(!box) return;
  const ed=box.closest(".question-accordion")||document;
  const val=k=>{const el=ed.querySelector(`[data-k="${k}"]`);return el?el.value:"";};
  const rows=Math.max(1,Math.min(12,Number(val("grid_rows"))||0));
  const cols=Math.max(1,Math.min(12,Number(val("grid_cols"))||0));
  const total=rows*cols;
  const m=String(val("shade_fraction")||"").match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  const num=m?Number(m[1]):0, den=m?Number(m[2]):0;
  const target=den>0?(total*num)/den:NaN;
  const exact=Number.isInteger(target);
  const cells=Array.from({length:total},()=>`<span class="shade-prev-cell"></span>`).join("");
  let warn="";
  if(!m){ warn=`<div class="shade-warn">Enter the fraction as a simple form like "1/3".</div>`; }
  else if(!exact){ warn=`<div class="shade-warn">⚠ ${num}/${den} does not divide a ${rows}×${cols} (${total}-cell) grid evenly, so there is no exact answer. Adjust the grid or fraction so the child can shade a whole number of cells (e.g. ${num}/${den} needs the total to be a multiple of ${den}).</div>`; }
  else { warn=`<div class="shade-ok">✓ The child must shade ${target} of ${total} squares to make ${num}/${den}.</div>`; }
  box.innerHTML=`<div class="shade-grid shade-grid-prev" style="grid-template-columns:repeat(${cols},1fr);max-width:${Math.min(260,cols*40)}px">${cells}</div>${warn}`;
};
window.checkAnswer=async()=>{
  const q=state.homework.questions[state.index], given=getStudentAnswer(q);
  if(given===null) return alert(q.type==="shade"?"Tap at least one square to shade first.":q.type==="matching"?"Connect every item before checking.":q.type==="point"?"Tap a point on the grid first.":q.type==="coordinate"?"Enter both the x-coordinate and y-coordinate.":q.type==="multipart"?"Complete every answer part. For time answers, minutes must be between 00 and 59.":"Enter a valid hour and minutes. Minutes must be between 00 and 59.");
  if(given==="") return alert(q.type==="drawing" ? "Draw at least one line before submitting." : "Enter or choose an answer.");
  if(q.type==="drawing"){
    const parsed=JSON.parse(given);
    app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Checking the drawing…</h2><p class="muted">Numera is comparing the drawing with the task.</p></div>`,true);
    try{
      const mark=await api("/api/mark-drawing",{method:"POST",body:JSON.stringify({prompt:q.prompt,rubric:q.drawing_rubric||q.answer_working||q.answer||"",source_image:q.visual_data_url||"",drawing_image:parsed.composite||parsed.preview})});
      const auto=mark.confidence>=0.72;
      const record={question_index:state.index,first_answer:given,first_correct:auto?mark.correct:false,retries:0,mastered:auto?mark.correct:false,hint_used:false,highest_hint_level:0,hint_count:0,hint_events:[],requires_teacher_review:!auto,drawing_preview:parsed.preview,drawing_feedback:mark.feedback,drawing_confidence:mark.confidence};
      state.attempts[state.index]=record;
      app.innerHTML=shell(`<div class="mission"><div class="mascot">${auto?(mark.correct?"🌟":"🌱"):"✏️"}</div><h1>${auto?(mark.correct?"Drawing looks correct":"Have another look"):"Drawing saved for review"}</h1><div class="feedback ${mark.correct?"good":"learn"}">${esc(mark.feedback||"The drawing has been recorded.")}</div><button class="btn green block" onclick="${auto&&!mark.correct?"retryOriginal()":"nextQuestion()"}">${auto&&!mark.correct?"Try drawing again":"Next question"}</button></div>`,"returnToCurrentQuestion()");
    }catch(err){
      state.attempts[state.index]={question_index:state.index,first_answer:given,first_correct:false,retries:0,mastered:false,hint_used:false,highest_hint_level:0,hint_count:0,hint_events:[],requires_teacher_review:true,drawing_preview:parsed.preview};
      app.innerHTML=shell(`<div class="mission"><div class="mascot">✏️</div><h1>Drawing saved</h1><div class="feedback learn">Automatic marking was not confident, so a teacher or parent can review it.</div><button class="btn green block" onclick="nextQuestion()">Next question</button></div>`,"returnToCurrentQuestion()");
    }
    return;
  }
  const record=state.attempts[state.index] || {question_index:state.index,first_answer:null,first_correct:null,retries:0,mastered:false,hint_used:false,highest_hint_level:0,hint_count:0,hint_events:[],question_started_at:Date.now()};
  if(record.first_answer===null || record.first_answer===""){
    record.first_answer=given;
    record.first_correct=q.type==="multipart"?multipartIsCorrect(given,q):["point","coordinate","matching","clock","drag","angle","fraction_visual"].includes(q.type)?interactiveIsCorrect(q,given):isCorrect(given,q.answer);
    state.attempts[state.index]=record;
  } else record.retries++;
  if(q.type==="multipart"?multipartIsCorrect(given,q):["point","coordinate","matching","clock","drag","angle","fraction_visual"].includes(q.type)?interactiveIsCorrect(q,given):isCorrect(given,q.answer)){
    record.mastered=true;
    renderCorrect(record.first_correct);
  } else renderIncorrect();
};
window.returnToCurrentQuestion = () => {
  renderQuestion();
};

window.showHint=(requestedLevel=null)=>{
  const q=state.homework.questions[state.index];
  const tiers=questionHintTiers(q);
  const record=ensureAttemptRecord();
  const previous=Math.max(0,Number(record.highest_hint_level)||0);
  const level=Math.max(1,Math.min(4,requestedLevel||previous+1));
  const now=Date.now();

  record.hint_used=true;
  record.highest_hint_level=Math.max(previous,level);
  record.hint_count=(Number(record.hint_count)||0)+1;
  if(!record.first_hint_at){
    record.first_hint_at=now;
    record.seconds_before_first_hint=Math.max(0,Math.round((now-(record.question_started_at||now))/1000));
  }
  record.hint_events ||= [];
  record.hint_events.push({level,opened_at:new Date(now).toISOString(),seconds_from_question_start:Math.max(0,Math.round((now-(record.question_started_at||now))/1000))});
  state.attempts[state.index]=record;

  const hint=tiers[level-1];
  const more=level<4;
  const nextLabel=level===1?"Still stuck? Show a strategy clue":level===2?"Let’s break it into steps":"Show me the method";

  app.innerHTML=shell(`
    <div class="card hint-ladder-card">
      <div class="mascot" style="text-align:center">💡</div>
      <span class="hint-tier-badge">Hint ${level} of 4 · ${hintTierName(level)}</span>
      <h2>${level===1?"Here’s a small clue":hintTierName(level)}</h2>
      <div class="feedback hint hint-tier-content">${formatMath(hint)}</div>
      ${voiceControl()}
      <button class="btn green block" style="margin-top:12px" onclick="returnToCurrentQuestion()">← Back to the question</button>
      ${more?`<div class="hint-more-separator"><span>Need more help?</span></div><button class="btn secondary block" onclick="showHint(${level+1})">${nextLabel}</button>`:`<p class="small muted hint-final-note">Try the question again. Asking for help is recorded as learning evidence, not as an incorrect answer.</p>`}
    </div>
  `,true);
  if(state.voiceEnabled) setTimeout(()=>speak(`${hintTierName(level)}. ${hint}`),120);
};
function renderIncorrect(){
  const q=state.homework.questions[state.index];
  const hint = q.hint || "Break the problem into smaller steps.";
  const explanation = q.explanation || `The correct answer is ${q.answer}.`;
  app.innerHTML=shell(`
    <div class="card">
      <div class="mascot" style="text-align:center">🌱</div>
      <h1>Good try.</h1>
      <p>Let’s work it out together.</p>
      <div class="feedback hint"><strong>Hint</strong><br>${esc(hint)}</div>
      <div class="feedback learn"><strong>How it works</strong><br>${esc(explanation)}</div>
      ${voiceControl()}
      ${q.practice_prompt ? `<div class="feedback good"><strong>Upgrade challenge</strong><br>${formatMath(q.practice_prompt)}</div>
      ${/^\d{1,2}:\d{2}/.test(String(q.practice_answer||"").trim()) ? timeAnswerMarkup("practice",{answer:q.practice_answer}) : /^\s*-?\d+(\s*,\s*-?\d+){1,}\s*$/.test(String(q.practice_answer||"")) ? `<div class="field"><label>Your answer</label>${sequenceMarkup("practiceSeq",{answer:q.practice_answer})}</div>` : `<div class="field"><label>Your answer</label><div class="answer-with-unit"><button type="button" class="sign-toggle" onclick="toggleAnswerSign('practiceInput')" aria-label="Make the answer negative or positive" title="Make negative / positive">±</button><input id="practiceInput" inputmode="decimal"></div></div>`}
      <button class="btn green block" onclick="checkPractice()">Check upgrade answer</button>` :
      `<button class="btn green block" onclick="retryOriginal()">Try the original again</button>`}
    </div>
  `,"returnToCurrentQuestion()");
  if (state.voiceEnabled) {
    const practice = q.practice_prompt ? `Now try this similar question. ${q.practice_prompt}` : "Now try the original question again.";
    setTimeout(() => speak(`That was a good try. Mistakes help our brains grow. Here is a clue. ${hint}. Let us work through it. ${explanation}. ${practice}`), 120);
  }
}
window.retryOriginal=()=>renderQuestion();
window.checkPractice=()=>{
  const q=state.homework.questions[state.index];
  const timePractice=/^\d{1,2}:\d{2}/.test(String(q.practice_answer||"").trim());
  const seqPractice=/^\s*-?\d+(\s*,\s*-?\d+){1,}\s*$/.test(String(q.practice_answer||""));
  const practiceWantsMeridiem=timeNeedsMeridiem({answer:q.practice_answer});
  const v=timePractice ? readTimeAnswer("practice",practiceWantsMeridiem)
        : seqPractice ? readSequenceAnswer("practiceSeq",sequenceCount({answer:q.practice_answer}))
        : ($("#practiceInput")?.value||"").trim();
  if(v===null) return alert(timePractice?(practiceWantsMeridiem?"Enter the hour, minutes, and choose AM or PM.":"Enter a valid hour and minutes."):"Fill in every box.");
  if(!v) return alert("Enter an answer.");
  const record=state.attempts[state.index];
  record.practice_attempts=(record.practice_attempts||0)+1;
  const practiceCorrect = seqPractice ? sequenceIsCorrect(v,q.practice_answer) : isCorrect(v,q.practice_answer);
  if(practiceCorrect){
    record.mastered=true;
    renderCorrect(false,true);
  } else if(record.practice_attempts===1){
    const existing=$("#practiceRetryMessage");
    if(existing) existing.remove();
    $(".card").insertAdjacentHTML("beforeend",`<div id="practiceRetryMessage" class="feedback hint">Nearly. Re-read the explanation and try once more.</div>`);
  } else {
    app.innerHTML=shell(`
      <div class="mission">
        <div class="mascot">🌱</div>
        <h1>Let’s keep going</h1>
        <div class="feedback learn">That one was still tricky. Numera has recorded it as a skill to practise, and we’ll move to the next question.</div>
        <button class="btn green block" onclick="nextQuestion()">Next question</button>
      </div>
    `);
    if(state.voiceEnabled) setTimeout(()=>speak("That one was still tricky. That is okay. We will practise it again another time and move to the next question."),120);
  }
};
function renderCorrect(firstTry,upgraded=false){
  const praise = firstTry
    ? "Fantastic! You got it on your first attempt."
    : "Well done! You learned from the mistake and mastered the skill.";
  app.innerHTML=shell(`
    <div class="mission">
      <div class="mascot">${firstTry?"🌟":"🏆"}</div>
      <h1>${firstTry?"Fantastic!":"Score upgraded!"}</h1>
      <div class="feedback good">${firstTry?"You got it on your first attempt.":"You learned from the mistake and mastered the skill."}</div>
      ${voiceControl()}
      <button class="btn green block" style="margin-top:10px" onclick="nextQuestion()">Next question</button>
    </div>
  `);
  if (state.voiceEnabled) setTimeout(() => speak(praise), 120);
}
window.nextQuestion=()=>{
  state.index++;
  state.selected=null;
  if(state.index>=state.homework.questions.length) finishHomework();
  else renderQuestion();
};

async function finishHomework(){
  const total=state.homework.questions.length;
  for(let i=0;i<total;i++){
    if(!state.attempts[i]) state.attempts[i]={question_index:i,first_answer:null,first_correct:false,retries:0,mastered:false,hint_used:false,highest_hint_level:0,hint_count:0,hint_events:[]};
  }

  // A Level Up is a synthetic homework with no DB row, so it must not be saved as
  // a normal submission (that would hit a foreign key and double-count evidence).
  // Celebrate the result directly instead. (Persisting Level Up evidence to the
  // understanding model is a deliberate future step, handled separately.)
  if(state.homework.is_level_up){
    const mastered=state.attempts.filter(a=>a.mastered||a.first_correct).length;
    // Record the outcome against each question's ORIGINAL homework so a question
    // the child now got right graduates out of their weak pool and won't reappear
    // in future Level Ups (and once the pool is small enough, Level Up stops being
    // offered). Best-effort — never block the celebration on it.
    recordLevelUpResults();
    return renderLevelUpComplete(mastered,total);
  }

  const autoMarked=state.attempts.filter(a=>!a.requires_teacher_review);
  const scoreTotal=Math.max(1,autoMarked.length);
  const original=autoMarked.filter(a=>a.first_correct).length;
  const mastery=autoMarked.filter(a=>a.first_correct||a.mastered).length;
  const teacherReviewCount=state.attempts.filter(a=>a.requires_teacher_review).length;

  const topicStats={};
  state.homework.questions.forEach((q,i)=>{
    const t=q.topic||state.homework.topic;
    topicStats[t] ||= {ok:0,total:0};
    topicStats[t].total++;
    if(state.attempts[i].first_correct||state.attempts[i].mastered) topicStats[t].ok++;
  });
  const strengths=Object.entries(topicStats).filter(([,v])=>v.ok/v.total>=.75).map(([k])=>k);
  const needs=Object.entries(topicStats).filter(([,v])=>v.ok/v.total<.75).map(([k])=>k);

  // Understanding insights for the summary (child-first, growth framing).
  // Derived only from real per-question records — no fabricated signal.
  const auto=autoMarked; // questions that were auto-marked (exclude teacher-review)
  const insight={
    // Right first time with no hint at all — genuine independent success.
    independent: auto.filter(a=>a.first_correct && !a.hint_used).length,
    // Wrong (or hint-needed) at first but got there in the end — resilience.
    turned_around: auto.filter(a=>!a.first_correct && a.mastered).length,
    // Questions where a hint was used and the child then got it right.
    hint_helped: auto.filter(a=>a.hint_used && (a.first_correct||a.mastered)).length,
    // How many questions any hint was opened on, and total hints opened.
    questions_with_hints: auto.filter(a=>a.hint_used).length,
    total_hints: auto.reduce((n,a)=>n+(Number(a.hint_count)||0),0)
  };

  // D1 should store answer metadata and drawing coordinates, not a large PNG data URL.
  const safeAttempts=state.attempts.map(a=>{
    const copy={...a};
    delete copy.drawing_preview;
    if(typeof copy.first_answer==="string" && copy.first_answer.startsWith("{")){
      try{
        const parsed=JSON.parse(copy.first_answer);
        if(parsed?.strokes){
          copy.first_answer=JSON.stringify({strokes:parsed.strokes});
        }
      }catch{}
    }
    return copy;
  });

  state.pendingSubmission={
    payload:{
      homework_id:state.homework.id,
      student_name:state.studentName,
      student_username:state.studentUsername,
      original_score:original,
      mastery_score:mastery,
      total_questions:scoreTotal,
      attempts:safeAttempts,
      strengths,
      needs_practice:needs
    },
    summary:{original,mastery,scoreTotal,strengths,needs,teacherReviewCount,insight}
  };
  state.pendingSummaryAttempts=safeAttempts; // for gem computation on the complete screen

  localStorage.setItem("numera:pendingSubmission",JSON.stringify(state.pendingSubmission));
  renderSavingResults();
  await savePendingSubmission();
}

function renderSavingResults(){
  app.innerHTML=shell(`
    <div class="mission">
      <div class="spinner"></div>
      <h1>Saving your results…</h1>
      <p class="muted">Keep this page open until Numera confirms the result has been recorded.</p>
    </div>
  `);
}

async function savePendingSubmission(){
  if(!state.pendingSubmission) return;
  try{
    const result=await api("/api/submissions",{
      method:"POST",
      body:JSON.stringify(state.pendingSubmission.payload)
    });
    localStorage.removeItem("numera:pendingSubmission");
    const s=state.pendingSubmission.summary;
    state.pendingSubmission=null;
    renderComplete(s.original,s.mastery,s.scoreTotal,s.strengths,s.needs,s.teacherReviewCount,result.id,s.insight);
    if(result.understanding_updated===false){
      console.warn("Result saved, but understanding graph update failed:",result.understanding_error);
    }
    setTimeout(loadParentProgress,80);
  }catch(e){
    renderSubmissionSaveError(e);
  }
}

function renderSubmissionSaveError(error){
  const message=error?.message||"The result could not be saved.";
  app.innerHTML=shell(`
    <section class="mobile-page-head">
      <span class="step-chip error-chip">Results not saved</span>
      <h1>We need to try saving again</h1>
      <p class="muted">Your answers are still held safely on this device.</p>
    </section>
    <div class="card extraction-error">
      <div class="camera-error-icon">☁️</div>
      <h2>${esc(message)}</h2>
      <p>The teacher dashboard will not update until this save succeeds.</p>
      <button class="btn primary block" onclick="retrySubmissionSave()">Retry saving results</button>
      <button class="btn secondary block" style="margin-top:10px" onclick="copySubmissionDebug()">Copy error details</button>
    </div>
  `);
}

window.retrySubmissionSave=async()=>{
  renderSavingResults();
  await savePendingSubmission();
};

window.copySubmissionDebug=async()=>{
  const info={
    homework_id:state.pendingSubmission?.payload?.homework_id,
    student_name:state.pendingSubmission?.payload?.student_name,
    payload_bytes:new Blob([JSON.stringify(state.pendingSubmission?.payload||{})]).size,
    page:location.href
  };
  await navigator.clipboard.writeText(JSON.stringify(info,null,2));
  alert("Submission details copied.");
};

function learningStoryMarkup(insight,original,mastery,total){
  if(!insight) return "";
  const gained=Math.max(0,mastery-original);
  const lines=[];

  // Lead with growth: questions figured out during the session after the first try.
  if(gained>0){
    lines.push(`💪 You figured out <strong>${gained}</strong> more question${gained===1?"":"s"} after your first go. That's your understanding growing right in front of you.`);
  }else if(original===total && total>0){
    lines.push(`🌟 You got every question right first time — brilliant.`);
  }

  // Resilience: turned-around questions.
  if(insight.turned_around>0){
    lines.push(`🔄 On <strong>${insight.turned_around}</strong> question${insight.turned_around===1?"":"s"} you didn't get it at first but kept going and got there. That's exactly how learning works.`);
  }

  // Hints as evidence — always framed as a smart, positive thing.
  if(insight.questions_with_hints>0){
    if(insight.hint_helped>0){
      lines.push(`💡 You asked for a clue on <strong>${insight.questions_with_hints}</strong> question${insight.questions_with_hints===1?"":"s"} and it paid off — asking for help is a clever thing to do, not a mistake.`);
    }else{
      lines.push(`💡 You used clues on <strong>${insight.questions_with_hints}</strong> question${insight.questions_with_hints===1?"":"s"}. Asking for help is a smart move — it's how you work things out.`);
    }
  }

  // Independence, kept light and warm.
  if(insight.independent>0){
    lines.push(`✅ You solved <strong>${insight.independent}</strong> question${insight.independent===1?"":"s"} all on your own, no clues needed.`);
  }

  if(!lines.length) return "";
  return `<div class="card learning-story"><h3>Your learning story</h3>${lines.map(l=>`<p>${l}</p>`).join("")}</div>`;
}

// --- Gems: a light, non-addictive motivation layer (v2.38) ---
// Points reward EFFORT and PROGRESS, not speed or streaks — so it motivates
// without the pressure mechanics schools dislike, and it's honest (derived only
// from real per-question outcomes). Persisted per student so a running total
// accumulates across homeworks; this is the foundation the finance-literacy idea
// can later build on (turning gems into a save/spend learning tool). Stored
// locally for now (single-device pilot); can move server-side without changing
// the rule.
function computeGemsEarned(attempts){
  let g=0;
  for(const a of (attempts||[])){
    if(a.requires_teacher_review) continue;
    if(a.first_correct && !a.hint_used) g+=10;        // independent success
    else if(a.first_correct || a.mastered) g+=5;       // got there (persistence)
    if(a.hint_used && (a.first_correct||a.mastered)) g+=2; // used help then succeeded
  }
  if(g>0) g+=5; // small completion bonus for finishing
  return g;
}
function gemsTotalKey(){ return `numera:gems:${state.studentUsername||"guest"}`; }
function getGemsTotal(){ return Number(localStorage.getItem(gemsTotalKey())||0); }
function addGems(n){
  const total=getGemsTotal()+Math.max(0,Number(n)||0);
  try{ localStorage.setItem(gemsTotalKey(), String(total)); }catch{}
  return total;
}

function renderComplete(original,mastery,total,strengths,needs,teacherReviewCount=0,submissionId="",insight=null){
  const op=Math.round(original/total*100), mp=Math.round(mastery/total*100);
  // Award gems for this homework (once), from the real attempts, and read the
  // running total so the child sees their collection grow.
  const gemsEarned = insight ? computeGemsEarned(state.pendingSummaryAttempts||[]) : 0;
  const gemsTotal = gemsEarned>0 ? addGems(gemsEarned) : getGemsTotal();
  app.innerHTML=shell(`
    <div class="mission">
      <div class="confetti">🎉 ⭐ 🎉</div><h1>Great work, ${esc(state.studentName)}!</h1>
      <p>You improved your understanding by ${Math.max(0,mp-op)} percentage points.</p>
      <span class="saved-confirmation">✓ Results saved to the teacher dashboard</span>
    </div>
    ${gemsEarned>0?`<div class="card gems-card">
      <div class="gems-earned"><span class="gem">💎</span> +${gemsEarned} gems earned!</div>
      <div class="gems-total">You now have <strong>${gemsTotal}</strong> gems in your collection</div>
      <div class="gems-note">Earn gems by having a go, sticking with tricky questions, and finishing your work.</div>
    </div>`:""}
    <div class="score-grid">
      <div class="score"><span>Original score</span><strong>${op}%</strong><span>${original}/${total}</span></div>
      <div class="score mastery"><span>Mastery score</span><strong>${mp}%</strong><span>${mastery}/${total}</span></div>
    </div>
    ${learningStoryMarkup(insight,original,mastery,total)}
    <div id="levelUpOffer"></div>
    <div class="parent-summary-label">Parent progress update</div><div class="card parent-summary-card" style="margin-top:10px"><h3>Strengths</h3><p>${strengths.length?strengths.map(x=>`✓ ${esc(x)}`).join("<br>"):"You showed excellent persistence."}</p>
      <h3>Keep practising</h3><p>${needs.length?needs.map(x=>`• ${esc(x)}`).join("<br>"):"No topic stood out as needing further practice."}</p>
      <div class="feedback learn"><strong>Parent suggestion</strong><br>Ask ${esc(state.studentName)} to explain one question aloud. Explaining the method helps make the learning stick.</div>
    </div>
    <div class="card child-history-card">
      <div class="row between wrap"><div><h3>${esc(state.studentName)}’s Numera progress</h3><p class="muted">Past homework for <strong>@${esc(state.studentUsername)}</strong>.</p></div><button class="btn secondary" onclick="loadParentProgress()">↻ Refresh</button></div>
      <div id="parentProgress"><div class="spinner small-spinner"></div><p class="muted">Loading past results…</p></div>
    </div>
  `);
  if (state.voiceEnabled) setTimeout(() => speak(`Excellent work, ${state.studentName}. You completed the mission and improved your understanding.`), 150);
  checkLevelUpOffer();
}

// Check whether the student has enough weak material to unlock a Level Up, and
// if so show an inviting card. Silent if not available (never nags the child).
async function checkLevelUpOffer(){
  const box=document.getElementById("levelUpOffer");
  if(!box || !state.studentUsername || !state.studentToken) return;
  try{
    const data=await api(`/api/level-up?student_username=${encodeURIComponent(state.studentUsername)}&student_token=${encodeURIComponent(state.studentToken)}&t=${Date.now()}`);
    if(!data.available) return; // stay silent
    box.innerHTML=`
      <div class="card level-up-card">
        <div class="level-up-badge">⚡ LEVEL UP</div>
        <h3>Ready for a challenge, ${esc(state.studentName)}?</h3>
        <p>We've picked ${data.questions.length} questions from things you found tricky before. Beat them to level up your understanding!</p>
        <button class="btn green block" onclick="startLevelUp()">⚡ Start Level Up</button>
      </div>`;
  }catch{ /* silent — Level Up is a bonus, never blocks the summary */ }
}

// Load the Level Up challenge into the normal player. A Level Up is just a
// synthetic homework, so the existing mission/question flow runs it unchanged.
window.startLevelUp=async()=>{
  if(!state.studentUsername || !state.studentToken) return;
  app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Building your Level Up…</h2></div>`);
  try{
    const data=await api(`/api/level-up?student_username=${encodeURIComponent(state.studentUsername)}&student_token=${encodeURIComponent(state.studentToken)}&t=${Date.now()}`);
    if(!data.available || !data.questions?.length){
      alert(data.message||"No Level Up available yet.");
      return renderComplete(0,0,1);
    }
    // Synthetic homework — reuse the whole player. Pass questions as an ARRAY
    // directly (the frontend never parses questions_json; the backend normally
    // returns questions already parsed). Passing questions_json here left
    // homework.questions undefined and crashed the player on .length.
    state.homework=normaliseHomeworkQuestions({
      id:`levelup-${Date.now()}`,
      title:data.title||"Level Up Challenge",
      topic:"Level Up",
      year_group:"",
      questions:Array.isArray(data.questions)?data.questions:[],
      settings:{},
      is_level_up:true
    });
    if(!state.homework.questions.length){
      alert("No Level Up available yet.");
      return renderComplete(0,0,1);
    }
    state.homework.is_level_up=true;
    state.index=0; state.attempts=[];
    renderMission();
  }catch(e){ alert(e.message); }
};

async function recordLevelUpResults(){
  try{
    if(!state.studentUsername || !state.studentToken) return;
    const qs=state.homework?.questions||[];
    const results=[];
    for(let i=0;i<qs.length;i++){
      const src=qs[i]?.level_up_source;
      if(!src || !src.homework_id) continue; // only graduate questions with known origin
      const a=state.attempts[i]||{};
      results.push({
        homework_id:src.homework_id,
        question_index:Number(src.question_index),
        concept_key:qs[i].concept_key||"",
        correct:(a.first_correct===true || a.mastered===true),
        hint_used:a.hint_used===true,
        highest_hint_level:Number(a.highest_hint_level)||0,
        retries:Number(a.retries)||0
      });
    }
    if(!results.length) return;
    await api("/api/level-up",{method:"POST",body:JSON.stringify({
      student_username:state.studentUsername,
      student_token:state.studentToken,
      results
    })});
  }catch(e){ /* best-effort: never block the child's celebration */ }
}

function renderLevelUpComplete(mastered,total){
  const pct=Math.round(mastered/Math.max(1,total)*100);
  const great=pct>=70;
  app.innerHTML=shell(`
    <div class="mission">
      <div class="confetti">⚡ 🎉 ⚡</div>
      <h1>Level Up complete, ${esc(state.studentName)}!</h1>
      <p>${great?"Brilliant — you turned tricky questions into ones you can do.":"Good effort — every one of these was something you found hard before, and you took it on."}</p>
    </div>
    <div class="score-grid">
      <div class="score mastery"><span>You got</span><strong>${mastered}/${total}</strong><span>of your tricky questions</span></div>
    </div>
    <div class="card level-up-card">
      <p>These were all questions you found hard in earlier homework. Coming back to them is exactly how understanding grows. 💪</p>
    </div>
  `,true);
  if(state.voiceEnabled) setTimeout(()=>speak(`Level up complete, ${state.studentName}. Great effort revisiting the tricky questions.`),150);
}

window.shareTeacherResults = async () => {
  const url = `${location.origin}${location.pathname}#/results?id=${state.homework.id}`;
  if (navigator.share) {
    await navigator.share({title:"Numera teacher results", text:`${state.studentName}'s Numera results`, url});
  } else {
    await navigator.clipboard.writeText(url);
    alert("Teacher-results link copied.");
  }
};


window.loadParentProgress=async()=>{
  const box=$("#parentProgress");
  if(!box) return;
  try{
    const [history,understanding]=await Promise.all([
      api(`/api/submissions?student_username=${encodeURIComponent(state.studentUsername)}&t=${Date.now()}`),
      api(`/api/understanding?student_username=${encodeURIComponent(state.studentUsername)}&t=${Date.now()}`)
    ]);

    const rows=history.results||[];
    const scores=history.summary||{};
    const u=understanding.summary||{};
    const concepts=understanding.concepts||[];

    const conceptRows=concepts.slice(0,8).map(c=>`
      <article class="understanding-row">
        <div class="understanding-label">
          <strong>${esc(c.concept_name)}</strong>
          <span>${esc(c.curriculum_objective||c.topic||"Maths")}</span>
        </div>
        <div class="understanding-meter" aria-label="${esc(c.concept_name)} ${c.mastery_score}%">
          <div style="width:${Math.max(0,Math.min(100,c.mastery_score))}%"></div>
        </div>
        <span class="understanding-value ${esc(c.band)}">${c.mastery_score}%</span>
      </article>
    `).join("");

    box.innerHTML=`
      <section class="understanding-hero">
        <div>
          <span class="small">CURRENT UNDERSTANDING</span>
          <strong>${u.understanding_score||0}%</strong>
          <p>Built from ${u.evidence_count||0} question-level learning signals—not just test scores.</p>
        </div>
        <div class="understanding-counts">
          <span><b>${u.secure_count||0}</b> secure</span>
          <span><b>${u.developing_count||0}</b> developing</span>
          <span><b>${u.priority_count||0}</b> priority</span>
        </div>
      </section>

      <div class="parent-summary-grid">
        <div class="mini-score"><span>Homeworks</span><strong>${scores.homework_count||0}</strong></div>
        <div class="mini-score"><span>Average original</span><strong>${scores.average_original||0}%</strong></div>
        <div class="mini-score mastery"><span>Average mastery</span><strong>${scores.average_mastery||0}%</strong></div>
      </div>

      <section class="understanding-section">
        <div class="row between"><h4>Understanding map</h4><span class="small muted">${u.concept_count||0} concepts observed</span></div>
        ${conceptRows||`<p class="muted">Complete more homework to build the understanding map.</p>`}
      </section>

      <section class="understanding-section">
        <h4>Recent homework</h4>
        ${rows.length?`<div class="progress-history-list">${rows.slice(0,8).map(r=>{
          const original=Math.round(r.original_score/Math.max(1,r.total_questions)*100);
          const mastery=Math.round(r.mastery_score/Math.max(1,r.total_questions)*100);
          return `<article class="progress-history-item">
            <div><strong>${esc(r.homework_title||"Maths homework")}</strong><span>${esc(r.topic||"Mixed maths")} · ${new Date(r.completed_at+"Z").toLocaleDateString("en-GB")}</span></div>
            <div class="history-score-pair"><span>${original}%</span><strong>${mastery}%</strong></div>
          </article>`;
        }).join("")}</div>`:`<p class="muted">This is the first recorded homework for this username.</p>`}
      </section>
    `;
  }catch(error){
    box.innerHTML=`<div class="notice"><strong>Progress could not be loaded.</strong><br>${esc(error.message)}</div>`;
  }
};

async function renderResults(){
  let submissions=[];
  let resultsError="";
  try{
    submissions=await api(`/api/submissions?homework_id=${encodeURIComponent(state.homework.id)}&t=${Date.now()}`);
  }catch(e){
    resultsError=e.message||"Results could not be loaded.";
  }
  const rows=submissions.map(s=>{
    const op=Math.round(s.original_score/s.total_questions*100), mp=Math.round(s.mastery_score/s.total_questions*100);
    const flag=mp<70?`<span class="pill orange">Needs support</span>`:op>90?`<span class="pill green">Needs challenge</span>`:`<span class="pill">On track</span>`;
    return `<tr><td><strong>${esc(s.student_name)}</strong></td><td>${op}%</td><td>${mp}%</td><td>${flag}</td><td>${new Date(s.completed_at+"Z").toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}</td></tr>`;
  }).join("");
  const complete=submissions.length;
  const avgO=complete?Math.round(submissions.reduce((a,s)=>a+s.original_score/s.total_questions*100,0)/complete):0;
  const avgM=complete?Math.round(submissions.reduce((a,s)=>a+s.mastery_score/s.total_questions*100,0)/complete):0;
  app.innerHTML=shell(`
    <div class="row between wrap"><div><h1>${esc(state.homework.title)}</h1><p class="muted">Teacher results dashboard</p></div><div class="row wrap"><button class="btn secondary" onclick="renderResults()">↻ Refresh</button><a class="btn secondary" href="#/edit-homework?id=${state.homework.id}">✏ Edit homework</a></div></div>
    ${resultsError?`<div class="notice"><strong>Results could not be loaded:</strong> ${esc(resultsError)}</div>`:""}
    <div class="grid two">
      <div class="score"><span>Completed</span><strong>${complete}</strong><span>students</span></div>
      <div class="score mastery"><span>Average upgrade</span><strong>+${Math.max(0,avgM-avgO)}</strong><span>percentage points</span></div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="table-wrap"><table><thead><tr><th>Student</th><th>Original</th><th>Mastery</th><th>Action</th><th>Completed</th></tr></thead><tbody>${rows||`<tr><td colspan="5" class="empty">No submissions yet. Open the student link to complete the first homework.</td></tr>`}</tbody></table></div>
    </div>
    <div class="card"><h3>What to look for tomorrow</h3><p class="muted">Prioritise children whose mastery score remains below 70%. Children scoring above 90% on their first attempt may need a greater challenge.</p></div>
  `,true);
}

function esc(v=""){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function js(v=""){return String(v).replaceAll("\\","\\\\").replaceAll("'","\\'");}
function formatMath(v=""){return esc(v).replace(/\n/g,"<br>");}

router();
