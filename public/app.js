const $ = (s, el=document) => el.querySelector(s);
const app = $("#app");
const state = {
  files: [],
  draft: null,
  homework: null,
  studentName: "",
  index: 0,
  attempts: [],
  selected: null,
  phase: "answer",
  practiceQuestion: null
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

const shell = (content, back=false) => `
<div class="app-shell">
  <header class="topbar">
    <div class="row">
      ${back ? `<button class="btn ghost" onclick="history.back()">←</button>` : ""}
      <div><div class="brand">numera<span>.</span></div><div class="tagline">Homework that teaches.</div></div>
    </div>
    <span class="pill green">Prototype</span>
  </header>
  <main>${content}</main>
  <div class="footer-note">Every mistake is a step forward.</div>
</div>`;

function router() {
  const hash = location.hash || "#/";
  const [path, query] = hash.slice(1).split("?");
  const params = new URLSearchParams(query || "");
  if (path === "/") return renderLanding();
  if (path === "/teacher") return renderTeacher();
  if (path === "/create") return renderUpload();
  if (path === "/review") return renderReview();
  if (path === "/published") return renderPublished();
  if (path === "/play") return loadHomework(params.get("id"), "play");
  if (path === "/results") return loadHomework(params.get("id"), "results");
  renderLanding();
}
window.addEventListener("hashchange", router);

function renderLanding(){
  app.innerHTML = shell(`
    <section class="hero">
      <div class="small">NUMERA V0.1</div>
      <h1>Homework<br>that <span style="color:#34d399">teaches.</span></h1>
      <p>Turn a photographed maths worksheet into an interactive quiz that marks, explains mistakes and helps children upgrade their score.</p>
      <div class="row wrap" style="margin-top:22px">
        <a class="btn green" href="#/teacher">Create homework</a>
        <button class="btn secondary" onclick="startDemo()">Try student demo</button>
      </div>
    </section>
    <h2 class="section-title">Built for tomorrow’s homework</h2>
    <div class="grid two">
      <div class="card"><div class="icon">📷</div><h3>Scan worksheets</h3><p class="muted">Upload several printed pages at once.</p></div>
      <div class="card"><div class="icon">✨</div><h3>Review the AI draft</h3><p class="muted">Correct wording, answers and hints before publishing.</p></div>
      <div class="card"><div class="icon">🧠</div><h3>Learn from mistakes</h3><p class="muted">Hints, explanations and a similar practice question.</p></div>
      <div class="card"><div class="icon">📈</div><h3>See original and mastery</h3><p class="muted">Teachers and parents see progress, not only correctness.</p></div>
    </div>
  `);
}

window.startDemo = async () => {
  try {
    const demo = await api("/api/demo", {method:"POST", body:"{}"});
    location.hash = `#/play?id=${demo.id}`;
  } catch(e) { alert(e.message); }
};

function renderTeacher(){
  app.innerHTML = shell(`
    <h1>Good evening 👋</h1>
    <p class="muted">Create Aaryan’s next Year 4 maths homework.</p>
    <div class="grid" style="margin-top:22px">
      <button class="action-card" onclick="location.hash='#/create'">
        <span class="icon">＋</span><span><strong>New homework</strong><br><span class="muted small">Photograph or upload worksheet pages</span></span>
      </button>
      <button class="action-card" onclick="openLastResults()">
        <span class="icon">📊</span><span><strong>Latest results</strong><br><span class="muted small">Completion and score upgrades</span></span>
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

function renderUpload(){
  state.files = [];
  app.innerHTML = shell(`
    <h1>New homework</h1>
    <p class="muted">Upload clear photos in page order. Numera will create an editable draft.</p>
    <label class="upload-zone" for="pages">
      <div class="mascot">🤖</div>
      <h2>Take photos or choose images</h2>
      <p class="muted">JPG, PNG or phone photos. Multiple pages supported.</p>
      <span class="btn secondary">Choose pages</span>
      <input id="pages" type="file" accept="image/*" multiple capture="environment">
    </label>
    <div id="previews" class="preview-strip"></div>
    <button id="extractBtn" class="btn primary block" disabled>Build interactive homework</button>
    <div class="notice" style="margin-top:14px">For tomorrow’s version, Numera converts questions into number-entry or multiple-choice formats.</div>
  `, true);
  $("#pages").addEventListener("change", handleFiles);
  $("#extractBtn").addEventListener("click", extractHomework);
}

async function handleFiles(e){
  state.files = [...e.target.files].slice(0,6);
  const previews = $("#previews");
  previews.innerHTML = "";
  for (const f of state.files){
    const url = URL.createObjectURL(f);
    previews.insertAdjacentHTML("beforeend", `<img src="${url}" alt="Worksheet preview">`);
  }
  $("#extractBtn").disabled = !state.files.length;
}

const fileToDataURL = file => new Promise((resolve,reject)=>{
  const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file);
});

async function extractHomework(){
  app.innerHTML = shell(`
    <div class="mission">
      <div class="spinner"></div>
      <h1>Creating the homework…</h1>
      <div class="status-list card">
        <div class="status">✅ Reading questions</div>
        <div class="status">✅ Understanding mathematical notation</div>
        <div class="status">✨ Writing helpful hints and explanations</div>
      </div>
      <p class="muted small">Clear worksheet photos produce the best draft.</p>
    </div>
  `);
  try {
    const images = await Promise.all(state.files.map(fileToDataURL));
    state.draft = await api("/api/extract", {method:"POST", body:JSON.stringify({images})});
    renderReview();
  } catch(e){
    alert(e.message);
    renderUpload();
  }
}

function renderReview(){
  if (!state.draft) return location.hash="#/create";
  const qs = state.draft.questions.map((q,i)=>questionEditor(q,i)).join("");
  app.innerHTML = shell(`
    <div class="row between wrap">
      <div><h1>Review the draft</h1><p class="muted">${state.draft.questions.length} questions detected. Check every answer before publishing.</p></div>
      <span class="pill">${state.draft.demo_mode ? "Demo extraction" : "AI extraction"}</span>
    </div>
    <div class="card">
      <div class="grid two">
        <div class="field"><label>Homework title</label><input id="title" value="${esc(state.draft.title || "Year 4 Maths")}"></div>
        <div class="field"><label>Topic</label><input id="topic" value="${esc(state.draft.topic || "Mixed maths")}"></div>
      </div>
    </div>
    <div id="questionEditors">${qs}</div>
    <button class="btn secondary block" onclick="addQuestion()">＋ Add question</button>
    <button class="btn green block" style="margin-top:12px" onclick="publishHomework()">Publish homework</button>
  `, true);
}
function questionEditor(q,i){
  return `<div class="card question-card" data-i="${i}">
    <div class="row between"><span class="question-number">${i+1}</span><button class="btn danger" onclick="deleteQuestion(${i})">Delete</button></div>
    <div class="field"><label>Question</label><textarea data-k="prompt">${esc(q.prompt)}</textarea></div>
    <div class="grid two">
      <div class="field"><label>Answer type</label><select data-k="type">
        <option value="number" ${q.type==="number"?"selected":""}>Number entry</option>
        <option value="multiple_choice" ${q.type==="multiple_choice"?"selected":""}>Multiple choice</option>
      </select></div>
      <div class="field"><label>Correct answer</label><input data-k="answer" value="${esc(String(q.answer))}"></div>
    </div>
    <div class="field"><label>Options (comma-separated, for multiple choice)</label><input data-k="options" value="${esc((q.options||[]).join(", "))}"></div>
    <div class="field"><label>Hint</label><input data-k="hint" value="${esc(q.hint||"")}"></div>
    <div class="field"><label>Explanation</label><textarea data-k="explanation">${esc(q.explanation||"")}</textarea></div>
    <div class="grid two">
      <div class="field"><label>Topic</label><input data-k="topic" value="${esc(q.topic||state.draft.topic||"Mixed maths")}"></div>
      <div class="field"><label>Similar practice question</label><input data-k="practice_prompt" value="${esc(q.practice_prompt||"")}"></div>
    </div>
    <div class="field"><label>Practice answer</label><input data-k="practice_answer" value="${esc(String(q.practice_answer??""))}"></div>
  </div>`;
}
function syncEditors(){
  document.querySelectorAll("[data-i]").forEach(card=>{
    const i=+card.dataset.i, q=state.draft.questions[i];
    card.querySelectorAll("[data-k]").forEach(el=>{
      const k=el.dataset.k;
      q[k] = k==="options" ? el.value.split(",").map(x=>x.trim()).filter(Boolean) : el.value;
    });
  });
}
window.deleteQuestion = i => { syncEditors(); state.draft.questions.splice(i,1); renderReview(); };
window.addQuestion = () => {
  syncEditors();
  state.draft.questions.push({type:"number",prompt:"",answer:"",options:[],hint:"",explanation:"",topic:state.draft.topic,practice_prompt:"",practice_answer:""});
  renderReview();
};

window.publishHomework = async () => {
  syncEditors();
  const title=$("#title").value.trim() || "Year 4 Maths";
  const topic=$("#topic").value.trim() || "Mixed maths";
  if (!state.draft.questions.length) return alert("Add at least one question.");
  if (state.draft.questions.some(q=>!q.prompt.trim() || String(q.answer).trim()==="")) return alert("Every question needs wording and a correct answer.");
  try {
    const result = await api("/api/homeworks", {method:"POST", body:JSON.stringify({
      title, topic, year_group:"Year 4",
      questions:state.draft.questions,
      settings:{hints:true, mastery:true, challenge:true}
    })});
    state.homework={...result,title,topic,questions:state.draft.questions};
    localStorage.setItem("numera:lastHomework", result.id);
    location.hash="#/published";
  } catch(e){ alert(e.message); }
};

function renderPublished(){
  const h=state.homework;
  if(!h) return location.hash="#/teacher";
  const student=`${location.origin}${location.pathname}#/play?id=${h.id}`;
  const results=`${location.origin}${location.pathname}#/results?id=${h.id}`;
  app.innerHTML=shell(`
    <div class="mission">
      <div class="confetti">🎉 ✨ 🎉</div>
      <h1>Homework published!</h1>
      <p class="muted">${esc(h.title)}</p>
    </div>
    <div class="card">
      <label>Student / parent link</label>
      <div class="row" style="margin-top:8px"><input id="studentLink" readonly value="${student}"><button class="btn secondary" onclick="copyField('studentLink')">Copy</button></div>
      <button class="btn green block" style="margin-top:14px" onclick="shareLink('${student.replaceAll("'","")}')">Share link</button>
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

async function loadHomework(id, mode){
  if(!id) return renderLanding();
  app.innerHTML=shell(`<div class="mission"><div class="spinner"></div><h2>Loading…</h2></div>`);
  try{
    state.homework=await api(`/api/homeworks?id=${encodeURIComponent(id)}`);
    if(mode==="results") renderResults();
    else renderJoin();
  }catch(e){app.innerHTML=shell(`<div class="card"><h2>Homework unavailable</h2><p>${esc(e.message)}</p></div>`,true);}
}

function renderJoin(){
  app.innerHTML=shell(`
    <div class="mission">
      <div class="mascot">🟢</div>
      <h1>Welcome!</h1>
      <p class="muted">${esc(state.homework.title)}</p>
    </div>
    <div class="card">
      <div class="field"><label>Enter your child’s first name</label><input id="studentName" autocomplete="given-name" placeholder="e.g. Aaryan"></div>
      <button class="btn green block" onclick="joinHomework()">Continue</button>
    </div>
    <p class="small muted" style="text-align:center">No student account is required for this prototype.</p>
  `);
}
window.joinHomework=()=>{
  const n=$("#studentName").value.trim();
  if(!n) return alert("Please enter a first name.");
  state.studentName=n; state.index=0; state.attempts=[]; renderMission();
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
      <button class="btn green block" onclick="beginQuiz()">Start mission</button>
    </div>
  `);
}
window.beginQuiz=()=>{state.phase="answer";state.selected=null;renderQuestion();};

function renderQuestion(){
  const q=state.homework.questions[state.index], n=state.homework.questions.length;
  const pct=(state.index/n)*100;
  const body=q.type==="multiple_choice"
    ? `<div class="options">${(q.options||[]).map(o=>`<button class="option ${state.selected===String(o)?"selected":""}" onclick="selectOption('${js(String(o))}')">${esc(String(o))}</button>`).join("")}</div>`
    : `<div class="field"><label>Your answer</label><input id="answerInput" inputmode="decimal" autocomplete="off" placeholder="Type your answer"></div>`;
  app.innerHTML=shell(`
    <div class="row between"><strong>Question ${state.index+1} of ${n}</strong><span class="pill">${esc(q.topic||state.homework.topic)}</span></div>
    <div class="progress" style="margin:12px 0"><div style="width:${pct}%"></div></div>
    <div class="card">
      <div class="question-text">${formatMath(q.prompt)}</div>
      ${body}
      <button class="btn primary block" style="margin-top:18px" onclick="checkAnswer()">Check answer</button>
    </div>
    <button class="btn ghost block" onclick="showHint()">💡 Show a hint</button>
  `);
}
window.selectOption=v=>{state.selected=v;renderQuestion();};
function getStudentAnswer(q){
  return q.type==="multiple_choice" ? state.selected : ($("#answerInput")?.value||"").trim();
}
function normalise(v){return String(v).trim().toLowerCase().replace(/\s+/g,"").replace(/,/g,"");}
function isCorrect(given,answer){return normalise(given)===normalise(answer);}
window.checkAnswer=()=>{
  const q=state.homework.questions[state.index], given=getStudentAnswer(q);
  if(given===null || given==="") return alert("Enter or choose an answer.");
  const record=state.attempts[state.index] || {question_index:state.index,first_answer:given,first_correct:false,retries:0,mastered:false,hint_used:false};
  if(!state.attempts[state.index]){
    record.first_answer=given;
    record.first_correct=isCorrect(given,q.answer);
    state.attempts[state.index]=record;
  } else record.retries++;
  if(isCorrect(given,q.answer)){
    record.mastered=true;
    renderCorrect(record.first_correct);
  } else renderIncorrect();
};
window.showHint=()=>{
  const q=state.homework.questions[state.index];
  const record=state.attempts[state.index] || {question_index:state.index,first_answer:"",first_correct:false,retries:0,mastered:false,hint_used:true};
  record.hint_used=true; state.attempts[state.index]=record;
  app.innerHTML=shell(`
    <div class="card">
      <div class="mascot" style="text-align:center">💡</div>
      <h2>Here’s a clue</h2>
      <div class="feedback hint">${esc(q.hint||"Break the problem into smaller steps.")}</div>
      <button class="btn green block" onclick="renderQuestion()">Try the question</button>
    </div>
  `,true);
};
function renderIncorrect(){
  const q=state.homework.questions[state.index];
  app.innerHTML=shell(`
    <div class="card">
      <div class="mascot" style="text-align:center">🌱</div>
      <h1>Good try.</h1>
      <p>Let’s work it out together.</p>
      <div class="feedback hint"><strong>Hint</strong><br>${esc(q.hint||"Break the problem into smaller steps.")}</div>
      <div class="feedback learn"><strong>How it works</strong><br>${esc(q.explanation||`The correct answer is ${q.answer}.`)}</div>
      ${q.practice_prompt ? `<div class="feedback good"><strong>Upgrade challenge</strong><br>${formatMath(q.practice_prompt)}</div>
      <div class="field"><label>Your answer</label><input id="practiceInput" inputmode="decimal"></div>
      <button class="btn green block" onclick="checkPractice()">Check upgrade answer</button>` :
      `<button class="btn green block" onclick="retryOriginal()">Try the original again</button>`}
    </div>
  `,true);
}
window.retryOriginal=()=>renderQuestion();
window.checkPractice=()=>{
  const q=state.homework.questions[state.index], v=$("#practiceInput").value.trim();
  if(!v)return alert("Enter an answer.");
  if(isCorrect(v,q.practice_answer)){
    state.attempts[state.index].mastered=true;
    renderCorrect(false,true);
  } else {
    $(".card").insertAdjacentHTML("beforeend",`<div class="feedback hint">Nearly. Re-read the explanation and try once more.</div>`);
  }
};
function renderCorrect(firstTry,upgraded=false){
  app.innerHTML=shell(`
    <div class="mission">
      <div class="mascot">${firstTry?"🌟":"🏆"}</div>
      <h1>${firstTry?"Fantastic!":"Score upgraded!"}</h1>
      <div class="feedback good">${firstTry?"You got it on your first attempt.":"You learned from the mistake and mastered the skill."}</div>
      <button class="btn green block" onclick="nextQuestion()">Next question</button>
    </div>
  `);
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
    if(!state.attempts[i]) state.attempts[i]={question_index:i,first_answer:"",first_correct:false,retries:0,mastered:false,hint_used:false};
  }
  const original=state.attempts.filter(a=>a.first_correct).length;
  const mastery=state.attempts.filter(a=>a.first_correct||a.mastered).length;
  const topicStats={};
  state.homework.questions.forEach((q,i)=>{
    const t=q.topic||state.homework.topic;
    topicStats[t] ||= {ok:0,total:0};
    topicStats[t].total++;
    if(state.attempts[i].first_correct||state.attempts[i].mastered) topicStats[t].ok++;
  });
  const strengths=Object.entries(topicStats).filter(([,v])=>v.ok/v.total>=.75).map(([k])=>k);
  const needs=Object.entries(topicStats).filter(([,v])=>v.ok/v.total<.75).map(([k])=>k);
  try{
    await api("/api/submissions",{method:"POST",body:JSON.stringify({
      homework_id:state.homework.id,student_name:state.studentName,
      original_score:original,mastery_score:mastery,total_questions:total,
      attempts:state.attempts,strengths,needs_practice:needs
    })});
  }catch(e){console.error(e);}
  renderComplete(original,mastery,total,strengths,needs);
}
function renderComplete(original,mastery,total,strengths,needs){
  const op=Math.round(original/total*100), mp=Math.round(mastery/total*100);
  app.innerHTML=shell(`
    <div class="mission">
      <div class="confetti">🎉 ⭐ 🎉</div><h1>Great work, ${esc(state.studentName)}!</h1>
      <p>You improved your understanding by ${Math.max(0,mp-op)} percentage points.</p>
    </div>
    <div class="score-grid">
      <div class="score"><span>Original score</span><strong>${op}%</strong><span>${original}/${total}</span></div>
      <div class="score mastery"><span>Mastery score</span><strong>${mp}%</strong><span>${mastery}/${total}</span></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Strengths</h3><p>${strengths.length?strengths.map(x=>`✓ ${esc(x)}`).join("<br>"):"You showed excellent persistence."}</p>
      <h3>Keep practising</h3><p>${needs.length?needs.map(x=>`• ${esc(x)}`).join("<br>"):"No topic stood out as needing further practice."}</p>
      <div class="feedback learn"><strong>Parent suggestion</strong><br>Ask ${esc(state.studentName)} to explain one question aloud. Explaining the method helps make the learning stick.</div>
    </div>
  `);
}

async function renderResults(){
  let submissions=[];
  try{submissions=await api(`/api/submissions?homework_id=${encodeURIComponent(state.homework.id)}`);}catch(e){}
  const rows=submissions.map(s=>{
    const op=Math.round(s.original_score/s.total_questions*100), mp=Math.round(s.mastery_score/s.total_questions*100);
    const flag=mp<70?`<span class="pill orange">Needs support</span>`:op>90?`<span class="pill green">Needs challenge</span>`:`<span class="pill">On track</span>`;
    return `<tr><td><strong>${esc(s.student_name)}</strong></td><td>${op}%</td><td>${mp}%</td><td>${flag}</td><td>${new Date(s.completed_at+"Z").toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})}</td></tr>`;
  }).join("");
  const complete=submissions.length;
  const avgO=complete?Math.round(submissions.reduce((a,s)=>a+s.original_score/s.total_questions*100,0)/complete):0;
  const avgM=complete?Math.round(submissions.reduce((a,s)=>a+s.mastery_score/s.total_questions*100,0)/complete):0;
  app.innerHTML=shell(`
    <div class="row between wrap"><div><h1>${esc(state.homework.title)}</h1><p class="muted">Teacher results dashboard</p></div><a class="btn secondary" href="#/play?id=${state.homework.id}">Open homework</a></div>
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
