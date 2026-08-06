const $ = (s, el=document) => el.querySelector(s);
const app = $("#app");
const state = {
  files: [],
  sourceImages: [],
  draft: null,
  editingHomeworkId: null,
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
  const utterance = new SpeechSynthesisUtterance(String(text).replace(/<[^>]*>/g, " "));
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
  const res = await fetch(url, {
    headers: {"Content-Type":"application/json", ...(options.headers||{})},
    ...options
  });
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
    <span class="pill green">Prototype</span>
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
    <section class="hero landing-hero">
      <div class="small">NUMERA</div>
      <h1>Homework<br>that <span style="color:#34d399">teaches.</span></h1>
      <p>Turn maths worksheets into interactive lessons that mark answers, explain mistakes and build a long-term picture of what each child understands.</p>
      <div class="row wrap landing-actions">
        <a class="btn green" href="#/teacher-account">Set homework</a>
        <a class="btn secondary" href="#/review-access">Review work</a>
        <a class="btn secondary" href="#/demo">Try student demo</a>
      </div>
    </section>
    <section class="paper-comparison">
      <span class="paper-comparison-kicker">Start without an email address</span>
      <h2>Enter a username and name to set a homework task.</h2>
      <p>For this early version, Numera does not ask for an email address. Teachers and parents who set work create a username, display name and four-digit PIN, then create student usernames under their account. Students use a valid username to open assigned work, while parents and teachers can review the appropriate history.</p>
    </section>
    <section class="workflow-grid">
      <article><span>1</span><h3>Teacher</h3><p>The person setting the work—usually a teacher, but sometimes a parent—creates student profiles, publishes tasks and reviews progress.</p></article>
      <article><span>2</span><h3>Student</h3><p>The child completes assigned work using a valid student username and PIN.</p></article>
      <article><span>3</span><h3>Reviewer</h3><p>A parent reviews one child; a teacher reviews every student and homework they manage.</p></article>
    </section>
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
    state.setterSession=session;localStorage.setItem("numera:setterSession",JSON.stringify(session));location.hash="#/teacher-dashboard";
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

  const strong=r.strongest_topics&&r.strongest_topics.length?`<div class="report-row good"><span class="report-k">Strongest so far</span><span>${r.strongest_topics.map(t=>`${esc(t.topic)} (${t.avg_mastery}%)`).join(", ")}</span></div>`:"";
  const weak=r.weakest_topics&&r.weakest_topics.length?`<div class="report-row watch"><span class="report-k">Worth practising</span><span>${r.weakest_topics.map(t=>`${esc(t.topic)} (${t.avg_mastery}%)`).join(", ")}</span></div>`:"";

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
  const img = await new Promise((resolve,reject)=>{
    const image = new Image(); image.onload=()=>resolve(image); image.onerror=()=>reject(new Error(`Could not read ${file.name}. Use a JPG, PNG or a fresh camera photo.`)); image.src=source;
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
    state.draft = await api("/api/extract", {method:"POST", body:JSON.stringify({images})});
    if (!state.draft.questions?.length) throw new Error("No readable questions were found. Retake the photo closer to the page.");
    status[1]?.classList.remove("active"); status[2]?.classList.add("active");
    state.draft=await attachQuestionVisuals(state.draft);
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
        ${q.visual_data_url?`<button type="button" class="btn ghost" onclick="removeQuestionImageDirect(${i})">Remove image</button>`:""}
      </div>
      <div class="field"><label>Question</label><textarea data-k="prompt" rows="3">${esc(q.prompt)}</textarea></div>
      <div class="field-row-mobile">
        <div class="field"><label>Answer type</label><select data-k="type"><option value="number" ${q.type==="number"?"selected":""}>Type an answer</option><option value="time" ${q.type==="time"?"selected":""}>Time (hour and minutes)</option><option value="multiple_choice" ${q.type==="multiple_choice"?"selected":""}>Multiple choice</option><option value="drawing" ${q.type==="drawing"?"selected":""}>Draw line(s) on image</option><option value="point" ${q.type==="point"?"selected":""}>Select a point on a grid</option><option value="coordinate" ${q.type==="coordinate"?"selected":""}>Enter a coordinate pair</option><option value="matching" ${q.type==="matching"?"selected":""}>Connect matching items</option><option value="multipart" ${q.type==="multipart"?"selected":""}>Multiple parts (a, b…)</option></select></div>
        <div class="field"><label>Correct answer</label><input data-k="answer" value="${esc(String(q.answer))}"></div>
      </div>
      <div class="field"><label>Answer unit <span class="label-note">shown beside the input</span></label><input data-k="answer_unit" value="${esc(q.answer_unit||"")}" placeholder="e.g. ml, cm, children"></div>
      ${q.type==="multipart"?`<div class="multipart-editor"><div class="row between"><strong>Answer parts</strong><button type="button" class="btn secondary" onclick="addQuestionPart(${i})">＋ Add part</button></div>${(q.parts||[]).map((p,pi)=>`<div class="part-editor" data-part-i="${pi}"><div class="row between"><span class="part-label">${esc(p.label||String.fromCharCode(97+pi))}</span><button type="button" class="btn ghost" onclick="deleteQuestionPart(${i},${pi})">Remove</button></div><div class="field"><label>Part prompt</label><input data-part-k="prompt" value="${esc(p.prompt||"")}"></div><div class="field-row-mobile"><div class="field"><label>Answer</label><input data-part-k="answer" value="${esc(p.answer||"")}"></div><div class="field"><label>Unit</label><input data-part-k="answer_unit" value="${esc(p.answer_unit||"")}"></div></div><div class="field"><label>Input type</label><select data-part-k="type"><option value="number" ${p.type==="number"?"selected":""}>Number</option><option value="time" ${p.type==="time"?"selected":""}>Time</option><option value="multiple_choice" ${p.type==="multiple_choice"?"selected":""}>Multiple choice</option></select></div></div>`).join("")}</div>`:""}

      ${q.type==="coordinate"?`<div class="interaction-editor"><strong>Coordinate-answer setup</strong><div class="field"><label>Correct coordinate</label><input data-k="coordinate_answer" value="${esc(Array.isArray(q.coordinate_answer)?JSON.stringify(q.coordinate_answer):String(q.coordinate_answer||q.answer||"[0,0]"))}" placeholder="[3, 2]"></div><p class="small muted">Students will see separate x and y boxes.</p></div>`:""}
      ${q.type==="point"?`<div class="interaction-editor">
        <strong>Coordinate-grid setup</strong>
        <div class="field-row-mobile">
          <div class="field"><label>Correct point</label><input data-k="point_answer" value="${esc(Array.isArray(q.point_answer)?JSON.stringify(q.point_answer):String(q.point_answer||q.answer||"[0,0]"))}" placeholder="[3, 2]"></div>
          <div class="field"><label>Grid bounds</label><input data-k="grid_bounds" value="${esc(Array.isArray(q.grid_bounds)?JSON.stringify(q.grid_bounds):String(q.grid_bounds||"[-5,5,-5,5]"))}" placeholder="[-5,5,-5,5]"></div>
        </div>
        <div class="field"><label>Grid step</label><input data-k="grid_step" type="number" step="0.25" value="${esc(String(q.grid_step||1))}"></div>
      </div>`:""}
      ${q.type==="matching"?`<div class="interaction-editor">
        <strong>Matching setup</strong>
        <div class="field"><label>Left items <span class="label-note">separate with |</span></label><input data-k="matching_left" value="${esc(parseStringList(q.matching_left).join(" | "))}" placeholder="A | B | C"></div>
        <div class="field"><label>Right items <span class="label-note">separate with |</span></label><input data-k="matching_right" value="${esc(parseStringList(q.matching_right).join(" | "))}" placeholder="i | ii | iii"></div>
        <div class="field"><label>Correct pairs <span class="label-note">e.g. A->ii | B->i</span></label><input data-k="matching_pairs" value="${esc(parseStringList(q.matching_pairs).join(" | "))}" placeholder="A->ii | B->i | C->iii"></div>
      </div>`:""}

      <div class="field"><label>Answer choices <span class="label-note">multiple choice only</span></label><input data-k="options" value="${esc((q.options||[]).join(", "))}" placeholder="12, 14, 16, 18"></div>
      ${(q.requires_teacher_check || ["drawing","point","coordinate","matching"].includes(q.type)) ? `<div class="teacher-check-card">
        <strong>Teacher verification required</strong>
        <p>${q.type==="drawing" ? "This answer will be drawn on the worksheet image and saved for adult review." : q.type==="point" ? "Check the coordinate bounds and correct point before publishing." : q.type==="matching" ? "Check every left item, right item and correct pair before publishing." : "Numera counted information from a visual. Check the image, calculation and final answer before publishing."}</p>
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
  });
}
window.deleteQuestion = i => { syncEditors(); state.draft.questions.splice(i,1); renderReview(); };
window.addQuestion = () => {
  syncEditors();
  state.draft.questions.push({type:"number",prompt:"",answer:"",options:[],hint:"",hints:["","","",""],explanation:"",topic:state.draft.topic,practice_prompt:"",practice_answer:"",needs_visual:false,visual_bbox:[0,0,0,0],visual_data_url:"",page_index:0,page_number:1,source_label:"Manual question",ai_visual_bbox:[0,0,1000,1000],visual_user_box:null,visual_user_adjusted:false,requires_teacher_check:false,answer_working:"",teacher_confirmed:false,answer_unit:"",parts:[],point_answer:[0,0],coordinate_answer:[0,0],grid_bounds:[-5,5,-5,5],grid_step:1,matching_left:[],matching_right:[],matching_pairs:[]});
  renderReview();
};

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
      alert("Homework changes saved.");
      location.hash=`#/edit-homework?id=${savedId}`;
    }else{
      result=await api("/api/homeworks",{method:"POST",body:JSON.stringify(payload)});
      state.homework={...result,title,topic,questions:state.draft.questions};
      state.reusedFromTitle="";
      localStorage.setItem("numera:lastHomework",result.id);
      location.hash="#/published";
    }
  } catch(e){
    app.innerHTML=shell(`
      <section class="mobile-page-head"><span class="step-chip error-chip">${state.editingHomeworkId?"Save failed":"Publish failed"}</span><h1>${state.editingHomeworkId?"The changes were not saved":"The homework was not saved"}</h1><p class="muted">Your reviewed questions are still in this browser.</p></section>
      <div class="card extraction-error"><div class="mascot">🛠️</div><p><strong>${esc(e.message)}</strong></p><div class="photo-help"><div>• Check the D1 binding is named DB</div><div>• Confirm the homeworks table exists</div><div>• Try publishing fewer image-based questions</div></div></div>
      <button class="btn primary block" onclick="renderReview()">Return to questions</button>
    `,true);
  } finally {
    if(button){button.disabled=false;button.textContent=state.editingHomeworkId?"Save changes":"Publish homework";}
  }
};

function renderPublished(){
  const h=state.homework;
  if(!h) return location.hash="#/teacher";
  const student=`${location.origin}${location.pathname}#/play?id=${h.id}`;
  const results=`${location.origin}${location.pathname}#/results?id=${h.id}`;
  app.innerHTML=shell(`
    <div class="mission">
      <div class="confetti">🎉 ✨ 🎉</div>
      <h1>Homework is ready!</h1>
      <p class="muted">${esc(h.title)}</p>
    </div>
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
function timeAnswerMarkup(prefix=""){
  return `<div class="time-answer" role="group" aria-label="Enter the time">
    <div class="field"><label for="${prefix}hourInput">Hour</label><input id="${prefix}hourInput" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="3" autocomplete="off"></div>
    <span class="time-colon" aria-hidden="true">:</span>
    <div class="field"><label for="${prefix}minuteInput">Minutes</label><input id="${prefix}minuteInput" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="07" autocomplete="off"></div>
  </div>`;
}
function readTimeAnswer(prefix=""){
  const hour=$("#"+prefix+"hourInput")?.value.trim()||"";
  const minute=$("#"+prefix+"minuteInput")?.value.trim()||"";
  if(!hour && !minute) return "";
  if(!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;
  const h=Number(hour), m=Number(minute);
  if(h>23 || m>59) return null;
  return `${h}:${String(m).padStart(2,"0")}`;
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

function answerWithUnitMarkup(id,unit){return `<div class="answer-with-unit"><input id="${id}" inputmode="decimal" autocomplete="off" placeholder="Type your answer">${unit?`<span class="answer-unit">${esc(unit)}</span>`:""}</div>`;}
function multipartMarkup(q){return `<div class="multipart-answer">${(q.parts||[]).map((p,i)=>`<section class="student-part"><div class="student-part-heading"><span>${esc(p.label||String.fromCharCode(97+i))}</span>${esc(p.prompt||"")}</div>${p.type==="time"?`<div class="time-answer"><div class="time-field"><label>Hour</label><input id="partHour${i}" inputmode="numeric" maxlength="2"></div><span class="time-colon">:</span><div class="time-field"><label>Minutes</label><input id="partMinute${i}" inputmode="numeric" maxlength="2" placeholder="00"></div>${p.answer_unit?`<span class="answer-unit">${esc(p.answer_unit)}</span>`:""}</div>`:answerWithUnitMarkup(`partAnswer${i}`,p.answer_unit||"")}</section>`).join("")}</div>`;}
function readMultipartAnswer(q){const v=[];for(let i=0;i<(q.parts||[]).length;i++){const p=q.parts[i];if(p.type==="time"){const hr=$(`#partHour${i}`)?.value.trim()||"",mn=$(`#partMinute${i}`)?.value.trim()||"";if(!hr||!mn||Number(mn)>59)return null;v.push(`${Number(hr)}:${mn.padStart(2,"0")}`);}else{const x=$(`#partAnswer${i}`)?.value.trim()||"";if(!x)return null;v.push(x);}}return v;}
function multipartIsCorrect(g,q){return Array.isArray(g)&&g.length===(q.parts||[]).length&&q.parts.every((p,i)=>isCorrect(g[i],p.answer));}


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
  return JSON.stringify({
    strokes:drawingState.strokes,
    preview:canvas?.toDataURL("image/png")||""
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
        ? `<div class="options">${(q.options||[]).map(o=>`<button class="option ${state.selected===String(o)?"selected":""}" onclick="selectOption('${js(String(o))}')">${esc(String(o))}</button>`).join("")}</div>`
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
              : q.type==="clock"
                ? clockMarkup(q)
                : q.type==="drag"
                  ? dragMarkup(q)
                  : q.type==="angle"
                    ? angleMarkup(q)
                    : q.type==="multipart"
        ? multipartMarkup(q)
        : isTimeQuestion(q)
          ? timeAnswerMarkup("")
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
window.selectOption=v=>{state.selected=v;renderQuestion();};
function getStudentAnswer(q){
  if(q.type==="multiple_choice") return state.selected;
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
  if(q.type==="multipart") return readMultipartAnswer(q);
  if(isTimeQuestion(q)) return readTimeAnswer("");
  return ($("#answerInput")?.value||"").trim();
}
function normalise(v){
  const raw=String(v).trim().toLowerCase().replace(/\s+/g,"").replace(/,/g,"");
  const time=raw.match(/^(\d{1,2}):(\d{1,2})$/);
  return time ? `${Number(time[1])}:${String(Number(time[2])).padStart(2,"0")}` : raw;
}
function isCorrect(given,answer){return normalise(given)===normalise(answer);}
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
  return isCorrect(given,q.answer);
}
window.checkAnswer=async()=>{
  const q=state.homework.questions[state.index], given=getStudentAnswer(q);
  if(given===null) return alert(q.type==="matching"?"Connect every item before checking.":q.type==="point"?"Tap a point on the grid first.":q.type==="coordinate"?"Enter both the x-coordinate and y-coordinate.":q.type==="multipart"?"Complete every answer part. For time answers, minutes must be between 00 and 59.":"Enter a valid hour and minutes. Minutes must be between 00 and 59.");
  if(given==="") return alert(q.type==="drawing" ? "Draw at least one line before submitting." : "Enter or choose an answer.");
  if(q.type==="drawing"){
    const parsed=JSON.parse(given);
    app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Checking the drawing…</h2><p class="muted">Numera is comparing the drawing with the task.</p></div>`,true);
    try{
      const mark=await api("/api/mark-drawing",{method:"POST",body:JSON.stringify({prompt:q.prompt,rubric:q.drawing_rubric||q.answer||"",source_image:q.visual_data_url||"",drawing_image:parsed.preview})});
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
      ${/^\d{1,2}:\d{2}$/.test(String(q.practice_answer||"").trim()) ? timeAnswerMarkup("practice") : `<div class="field"><label>Your answer</label><input id="practiceInput" inputmode="decimal"></div>`}
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
  const timePractice=/^\d{1,2}:\d{2}$/.test(String(q.practice_answer||"").trim());
  const v=timePractice ? readTimeAnswer("practice") : ($("#practiceInput")?.value||"").trim();
  if(v===null) return alert("Enter a valid hour and minutes.");
  if(!v) return alert("Enter an answer.");
  const record=state.attempts[state.index];
  record.practice_attempts=(record.practice_attempts||0)+1;
  if(isCorrect(v,q.practice_answer)){
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
    summary:{original,mastery,scoreTotal,strengths,needs,teacherReviewCount}
  };

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
    renderComplete(s.original,s.mastery,s.scoreTotal,s.strengths,s.needs,s.teacherReviewCount,result.id);
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

function renderComplete(original,mastery,total,strengths,needs,teacherReviewCount=0,submissionId=""){
  const op=Math.round(original/total*100), mp=Math.round(mastery/total*100);
  app.innerHTML=shell(`
    <div class="mission">
      <div class="confetti">🎉 ⭐ 🎉</div><h1>Great work, ${esc(state.studentName)}!</h1>
      <p>You improved your understanding by ${Math.max(0,mp-op)} percentage points.</p>
      <span class="saved-confirmation">✓ Results saved to the teacher dashboard</span>
    </div>
    <div class="score-grid">
      <div class="score"><span>Original score</span><strong>${op}%</strong><span>${original}/${total}</span></div>
      <div class="score mastery"><span>Mastery score</span><strong>${mp}%</strong><span>${mastery}/${total}</span></div>
    </div>
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
