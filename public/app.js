const $ = (s, el=document) => el.querySelector(s);
const app = $("#app");
const state = {
  files: [],
  sourceImages: [],
  draft: null,
  homework: null,
  studentName: "",
  index: 0,
  attempts: [],
  selected: null,
  phase: "answer",
  practiceQuestion: null,
  voiceEnabled: localStorage.getItem("numera:voiceEnabled") === "true"
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

async function cropVisualFromDataURL(dataUrl,bbox){
  if(!Array.isArray(bbox) || bbox.length!==4 || bbox.every(v=>Number(v)===0)) return "";
  const img=await new Promise((resolve,reject)=>{
    const image=new Image(); image.onload=()=>resolve(image); image.onerror=reject; image.src=dataUrl;
  });
  let [x,y,w,h]=bbox.map(Number);
  x=Math.max(0,Math.min(1000,x)); y=Math.max(0,Math.min(1000,y));
  w=Math.max(1,Math.min(1000-x,w)); h=Math.max(1,Math.min(1000-y,h));
  const pad=25;
  x=Math.max(0,x-pad); y=Math.max(0,y-pad); w=Math.min(1000-x,w+pad*2); h=Math.min(1000-y,h+pad*2);
  const sx=Math.round(img.naturalWidth*x/1000), sy=Math.round(img.naturalHeight*y/1000);
  const sw=Math.max(1,Math.round(img.naturalWidth*w/1000)), sh=Math.max(1,Math.round(img.naturalHeight*h/1000));
  const maxSide=760, scale=Math.min(1,maxSide/Math.max(sw,sh));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(sw*scale)); canvas.height=Math.max(1,Math.round(sh*scale));
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/jpeg",0.78);
}

async function attachQuestionVisuals(draft){
  for(const q of draft.questions||[]){
    const pageIndex=Number(q.page_index);
    if(q.needs_visual && state.sourceImages[pageIndex]){
      try{ q.visual_data_url=await cropVisualFromDataURL(state.sourceImages[pageIndex],q.visual_bbox); }
      catch{ q.visual_data_url=state.sourceImages[pageIndex]; }
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

function renderReview(){
  if (!state.draft) return location.hash="#/create";
  const qs = state.draft.questions.map((q,i)=>questionEditor(q,i)).join("");
  app.innerHTML = shell(`
    <section class="mobile-page-head">
      <span class="step-chip">Step 3 of 3</span>
      <h1>Check the questions</h1>
      <p class="muted">Numera found ${state.draft.questions.length} question${state.draft.questions.length===1?"":"s"}. Open each card to check its wording and answer.</p>
    </section>
    ${state.draft.warning ? `<div class="notice">${esc(state.draft.warning)}</div>` : ""}
    <div class="review-summary-card">
      <div class="field"><label>Homework title</label><input id="title" value="${esc(state.draft.title || "Year 4 Maths")}"></div>
      <div class="field"><label>Main topic</label><input id="topic" value="${esc(state.draft.topic || "Mixed maths")}"></div>
    </div>
    <div class="review-instruction"><span>AI draft</span><strong>Tap a question to edit it</strong></div>
    <div id="questionEditors" class="question-editor-list">${qs}</div>
    <button class="btn secondary block" onclick="addQuestion()">＋ Add another question</button>
    <div class="mobile-sticky-action review-publish">
      <button class="btn green block" onclick="publishHomework()">Publish homework</button>
      <span class="small muted">You can change anything before publishing</span>
    </div>
  `, true);
}
function questionEditor(q,i){
  return `<details class="question-accordion" data-i="${i}" ${i===0?"open":""}>
    <summary><span class="question-number">${i+1}</span><span class="summary-copy"><strong>${esc(q.prompt||"Untitled question")}</strong><small>${esc(q.topic||"Maths")} · Answer: ${esc(String(q.answer||"Not set"))}</small></span><span class="chevron">⌄</span></summary>
    <div class="question-form">
      <div class="question-source-row"><span class="pill">${esc(q.source_label||`Page ${(q.page_index??0)+1}`)}</span>${q.needs_visual?`<span class="pill orange">Visual question</span>`:""}</div>
      ${q.visual_data_url ? `<figure class="question-visual"><img src="${q.visual_data_url}" alt="Source visual for question ${i+1}"><figcaption>Image from the worksheet</figcaption></figure>` : ""}
      <div class="field"><label>Question</label><textarea data-k="prompt" rows="3">${esc(q.prompt)}</textarea></div>
      <div class="field-row-mobile">
        <div class="field"><label>Answer type</label><select data-k="type"><option value="number" ${q.type==="number"?"selected":""}>Type an answer</option><option value="multiple_choice" ${q.type==="multiple_choice"?"selected":""}>Multiple choice</option></select></div>
        <div class="field"><label>Correct answer</label><input data-k="answer" value="${esc(String(q.answer))}"></div>
      </div>
      <div class="field"><label>Answer choices <span class="label-note">multiple choice only</span></label><input data-k="options" value="${esc((q.options||[]).join(", "))}" placeholder="12, 14, 16, 18"></div>
      <div class="field"><label>Helpful hint</label><textarea data-k="hint" rows="2">${esc(q.hint||"")}</textarea></div>
      <div class="field"><label>Worked explanation</label><textarea data-k="explanation" rows="3">${esc(q.explanation||"")}</textarea></div>
      <details class="advanced-fields"><summary>More teaching settings</summary><div class="field"><label>Topic</label><input data-k="topic" value="${esc(q.topic||state.draft.topic||"Mixed maths")}"></div><div class="field"><label>Similar practice question</label><input data-k="practice_prompt" value="${esc(q.practice_prompt||"")}"></div><div class="field"><label>Practice answer</label><input data-k="practice_answer" value="${esc(String(q.practice_answer??""))}"></div></details>
      <button type="button" class="btn danger block" onclick="deleteQuestion(${i})">Remove this question</button>
    </div>
  </details>`;
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
  state.draft.questions.push({type:"number",prompt:"",answer:"",options:[],hint:"",explanation:"",topic:state.draft.topic,practice_prompt:"",practice_answer:"",needs_visual:false,visual_bbox:[0,0,0,0],visual_data_url:"",page_index:0,page_number:1,source_label:"Manual question"});
  renderReview();
};

window.publishHomework = async () => {
  syncEditors();
  const title=$("#title").value.trim() || "Year 4 Maths";
  const topic=$("#topic").value.trim() || "Mixed maths";
  if (!state.draft.questions.length) return alert("Add at least one question.");
  if (state.draft.questions.some(q=>!String(q.prompt||"").trim() || String(q.answer??"").trim()==="")) return alert("Every question needs wording and a correct answer.");

  const button=document.querySelector(".review-publish .btn");
  if(button){button.disabled=true;button.textContent="Publishing…";}
  try {
    const payload={
      title, topic, year_group:"Year 4",
      questions:state.draft.questions,
      settings:{hints:true, mastery:true, challenge:true, source_pages:state.draft.page_count||state.sourceImages.length}
    };
    const payloadBytes=new Blob([JSON.stringify(payload)]).size;
    if(payloadBytes>4_500_000) throw new Error("This homework is too large to publish because it contains several detailed images. Remove unnecessary visual questions or publish fewer pages at once.");
    const result = await api("/api/homeworks", {method:"POST", body:JSON.stringify(payload)});
    state.homework={...result,title,topic,questions:state.draft.questions};
    localStorage.setItem("numera:lastHomework", result.id);
    location.hash="#/published";
  } catch(e){
    app.innerHTML=shell(`
      <section class="mobile-page-head"><span class="step-chip error-chip">Publish failed</span><h1>The homework was not saved</h1><p class="muted">Your reviewed questions are still in this browser.</p></section>
      <div class="card extraction-error"><div class="mascot">🛠️</div><p><strong>${esc(e.message)}</strong></p><div class="photo-help"><div>• Check the D1 binding is named DB</div><div>• Confirm the homeworks table exists</div><div>• Try publishing fewer image-based questions</div></div></div>
      <button class="btn primary block" onclick="renderReview()">Return to questions</button>
    `,true);
  } finally {
    if(button){button.disabled=false;button.textContent="Publish homework";}
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
      ${voiceControl()}
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
    <div class="row wrap voice-row">
      ${voiceControl()}
      <button class="btn voice-btn" onclick="readCurrentQuestion()">▶ Read question</button>
    </div>
    <div class="card">
      ${q.visual_data_url ? `<figure class="student-question-visual"><img src="${q.visual_data_url}" alt="Diagram for this question"></figure>` : ""}
      <div class="question-text">${formatMath(q.prompt)}</div>
      ${body}
      <button class="btn primary block" style="margin-top:18px" onclick="checkAnswer()">Check answer</button>
    </div>
    <button class="btn ghost block" onclick="showHint()">💡 Show a hint</button>
  `);
  if (state.voiceEnabled) setTimeout(() => speak(`Question ${state.index + 1}. ${q.prompt}`), 120);
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
  const hint = q.hint || "Break the problem into smaller steps.";
  app.innerHTML=shell(`
    <div class="card">
      <div class="mascot" style="text-align:center">💡</div>
      <h2>Here’s a clue</h2>
      <div class="feedback hint">${esc(hint)}</div>
      ${voiceControl()}
      <button class="btn green block" style="margin-top:10px" onclick="renderQuestion()">Try the question</button>
    </div>
  `,true);
  if (state.voiceEnabled) setTimeout(() => speak(`Here is a clue. ${hint}`), 120);
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
      <div class="field"><label>Your answer</label><input id="practiceInput" inputmode="decimal"></div>
      <button class="btn green block" onclick="checkPractice()">Check upgrade answer</button>` :
      `<button class="btn green block" onclick="retryOriginal()">Try the original again</button>`}
    </div>
  `,true);
  if (state.voiceEnabled) {
    const practice = q.practice_prompt ? `Now try this similar question. ${q.practice_prompt}` : "Now try the original question again.";
    setTimeout(() => speak(`That was a good try. Mistakes help our brains grow. Here is a clue. ${hint}. Let us work through it. ${explanation}. ${practice}`), 120);
  }
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
    <div class="parent-summary-label">Parent progress update</div><div class="card parent-summary-card" style="margin-top:10px"><h3>Strengths</h3><p>${strengths.length?strengths.map(x=>`✓ ${esc(x)}`).join("<br>"):"You showed excellent persistence."}</p>
      <h3>Keep practising</h3><p>${needs.length?needs.map(x=>`• ${esc(x)}`).join("<br>"):"No topic stood out as needing further practice."}</p>
      <div class="feedback learn"><strong>Parent suggestion</strong><br>Ask ${esc(state.studentName)} to explain one question aloud. Explaining the method helps make the learning stick.</div>
    </div>
    <div class="card teacher-results-card">
      <h3>For the teacher or parent</h3>
      <p class="muted">Open the results dashboard to see the original score, mastery score and any areas needing support.</p>
      <a class="btn primary block teacher-results-button" href="#/results?id=${state.homework.id}">📊 View teacher results</a>
      <button class="btn secondary block" style="margin-top:10px" onclick="shareTeacherResults()">Share teacher-results link</button>
      <p class="small muted" style="margin-bottom:0">Prototype note: this link is not password protected yet, so share it only with the intended adult.</p>
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
