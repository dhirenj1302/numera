import { validSetter } from "./_lib.js";

// Call the OpenAI Responses API with a per-attempt TIMEOUT and limited retries.
// Cloudflare Pages Functions have a request time budget, so we must never let a
// single call hang and never retry so long that the whole request is killed
// (which returns NOTHING to the browser and leaves the UI stuck). Each attempt
// is capped by AbortController; we retry transient failures at most twice with
// short backoff. Out-of-credit (429 insufficient_quota) fails fast and clearly.
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524]);
const PER_CALL_TIMEOUT_MS = 50000; // hard cap per attempt (must fit under the frontend api() timeout)

async function openaiResponsesCall(apiKey, payload, { retries = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_CALL_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (response.ok) return await response.json();

      const bodyText = await response.text().catch(() => "");
      let parsed = null;
      try { parsed = JSON.parse(bodyText); } catch { /* HTML/empty */ }

      // Out of credit / quota — do NOT retry, surface a clear message.
      const code = parsed?.error?.code || "";
      if (response.status === 429 && /quota|insufficient/i.test(code + (parsed?.error?.message || ""))) {
        const e = new Error("The worksheet reader is out of OpenAI credit. Please top up the OpenAI account and try again.");
        e.noRetry = true;
        throw e;
      }

      if (TRANSIENT_STATUSES.has(response.status) && attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1))); // 0.5s, 1.0s
        lastErr = new Error(`OpenAI returned ${response.status}`);
        continue;
      }
      const msg = parsed?.error?.message
        || (TRANSIENT_STATUSES.has(response.status)
              ? `The reader service is busy right now (error ${response.status}). Please try again in a moment.`
              : `OpenAI returned ${response.status}`);
      const fatal = new Error(msg);
      fatal.noRetry = true;
      throw fatal;
    } catch (err) {
      clearTimeout(timer);
      if (err?.noRetry) throw err;
      // A timeout already consumed the full per-call budget; retrying another
      // full attempt would exceed the request time budget and leave the UI
      // hanging. So fail through on timeout, but DO retry fast-failing network
      // errors (which return quickly, like a transient 520 dropped connection).
      const isTimeout = err?.name === "AbortError";
      if (!isTimeout && attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        lastErr = err;
        continue;
      }
      throw isTimeout ? new Error("The worksheet reader timed out. Please try again.") : (lastErr || err);
    }
  }
  throw lastErr || new Error("OpenAI request failed.");
}

const pageSchema = {
  type:"object",
  additionalProperties:false,
  required:["page_topic","warning","questions"],
  properties:{
    page_topic:{type:"string"},
    warning:{type:"string"},
    questions:{
      type:"array",
      minItems:0,
      maxItems:40,
      items:{
        type:"object",
        additionalProperties:false,
        required:["type","prompt","answer","options","hint","hints","explanation","topic","difficulty","year_group","question_type","practice_prompt","practice_answer","needs_visual","visual_bbox","requires_teacher_check","answer_working","answer_unit","point_answer","coordinate_answer","grid_bounds","grid_step","matching_left","matching_right","matching_pairs","denominator","drag_item_count","clock_start","angle_start","angle_tolerance","drawing_rubric","grid_rows","grid_cols","shade_fraction","parts"],
        properties:{
          type:{type:"string",enum:["number","time","multiple_choice","drawing","point","coordinate","matching","fraction","fraction_visual","drag","clock","angle","shade","sequence","coins","multipart"]},
          prompt:{type:"string"},
          answer:{type:"string"},
          options:{type:"array",items:{type:"string"}},
          hint:{type:"string"},
          hints:{type:"array",minItems:4,maxItems:4,items:{type:"string"}},
          explanation:{type:"string"},
          topic:{type:"string"},
          difficulty:{type:"string",enum:["foundation","developing","secure","greater_depth"]},
          year_group:{type:"string",enum:["Reception","Year 1","Year 2","Year 3","Year 4","Year 5","Year 6","unknown"]},
          question_type:{type:"string",enum:["fluency","reasoning","word_problem"]},
          practice_prompt:{type:"string"},
          practice_answer:{type:"string"},
          needs_visual:{type:"boolean"},
          visual_bbox:{
            type:"array",
            minItems:4,
            maxItems:4,
            items:{type:"number"}
          },
          requires_teacher_check:{type:"boolean"},
          answer_working:{type:"string"}, answer_unit:{type:"string"},
          point_answer:{type:"array",minItems:2,maxItems:2,items:{type:"number"}},
          coordinate_answer:{type:"array",minItems:2,maxItems:2,items:{type:"number"}},
          grid_bounds:{type:"array",minItems:4,maxItems:4,items:{type:"number"}},
          grid_step:{type:"number"},
          matching_left:{type:"array",items:{type:"string"}},
          matching_right:{type:"array",items:{type:"string"}},
          matching_pairs:{type:"array",items:{type:"string"}},
          denominator:{type:"integer"},
          drag_item_count:{type:"integer"},
          clock_start:{type:"string"},
          angle_start:{type:"number"},
          angle_tolerance:{type:"number"},
          grid_rows:{type:"integer"},
          grid_cols:{type:"integer"},
          shade_fraction:{type:"string"},
          drawing_rubric:{type:"string"},
          parts:{type:"array",maxItems:6,items:{type:"object",additionalProperties:false,required:["label","prompt","answer","answer_unit","type"],properties:{label:{type:"string"},prompt:{type:"string"},answer:{type:"string"},answer_unit:{type:"string"},type:{type:"string",enum:["number","time","multiple_choice"]}}}}
        }
      }
    }
  }
};

function outputText(data){
  const chunks=[];
  for(const item of data.output||[]){
    for(const part of item.content||[]){
      if(part.type==="output_text" && part.text) chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}


const repairedMultipartSchema={
  type:"object",
  additionalProperties:false,
  required:["type","prompt","answer","options","hint","hints","explanation","topic","practice_prompt","practice_answer","needs_visual","visual_bbox","requires_teacher_check","answer_working","answer_unit","parts"],
  properties:{
    type:{type:"string",enum:["multipart"]},
    prompt:{type:"string"},
    answer:{type:"string"},
    options:{type:"array",items:{type:"string"}},
    hint:{type:"string"},
    hints:{type:"array",minItems:4,maxItems:4,items:{type:"string"}},
    explanation:{type:"string"},
    topic:{type:"string"},
    practice_prompt:{type:"string"},
    practice_answer:{type:"string"},
    needs_visual:{type:"boolean"},
    visual_bbox:{type:"array",minItems:4,maxItems:4,items:{type:"number"}},
    requires_teacher_check:{type:"boolean"},
    answer_working:{type:"string"},
    answer_unit:{type:"string"},
    parts:{
      type:"array",
      minItems:2,
      maxItems:6,
      items:{
        type:"object",
        additionalProperties:false,
        required:["label","prompt","answer","answer_unit","type"],
        properties:{
          label:{type:"string"},
          prompt:{type:"string"},
          answer:{type:"string"},
          answer_unit:{type:"string"},
          type:{type:"string",enum:["number","time","multiple_choice"]}
        }
      }
    }
  }
};

function countPrintedPartMarkers(text=""){
  const matches=String(text).match(/\([a-f]\)/gi)||[];
  return new Set(matches.map(x=>x.toLowerCase())).size;
}

async function repairMultipartQuestion(context,imageUrl,pageIndex,question){
  const data=await openaiResponsesCall(context.env.OPENAI_API_KEY,{
    model:context.env.OPENAI_MODEL || "gpt-4.1-mini",
    input:[{role:"user",content:[
        {type:"input_text",text:`Re-read PAGE ${pageIndex+1}. The previous extraction appears to have merged a multi-part maths question.

Locate the exact printed question corresponding to:
${question.prompt}

Return that single question only. It contains separately answerable printed parts such as (a), (b), and possibly more.

NON-NEGOTIABLE:
- type must be multipart.
- Return one parts item for EVERY printed part, in order.
- Each part needs its own exact wording, solved answer, answer unit, and input type.
- The top-level prompt should contain only the shared introductory wording, not repeat all part questions.
- Do not omit part (b) or merge answers.
- Preserve any required visual crop and all existing teaching information.\n- Return exactly four progressive hints following the main Hint 1 to Hint 4 rules.`},
        {type:"input_image",image_url:imageUrl,detail:"high"}
      ]}],
      text:{format:{type:"json_schema",name:"numera_multipart_repair",strict:true,schema:repairedMultipartSchema}},
      max_output_tokens:5000
  },{retries:0});
  const raw=outputText(data);
  if(!raw) throw new Error("No repaired multipart data returned.");
  return JSON.parse(raw);
}

async function repairMissedMultipart(context,imageUrl,pageIndex,questions){
  // Each repair is a SEPARATE OpenAI round-trip. On a dense page many questions
  // can look multi-part (e.g. "98mm = _ cm _ mm"), and running a repair for every
  // one in sequence blows the request time budget and times the whole upload out.
  // So we cap how many repairs run and stop once a time budget is used up. A
  // skipped repair just means that question keeps its first-pass parsing (still
  // usable, and the teacher can fix it) — far better than failing the whole page.
  const MAX_REPAIRS = 2;
  const REPAIR_BUDGET_MS = 15000;
  const startedAt = Date.now();
  let repairsDone = 0;

  const repaired=[];
  for(const q of questions||[]){
    const markerCount=countPrintedPartMarkers(q.prompt);
    const partsCount=Array.isArray(q.parts)?q.parts.length:0;

    const canRepair = markerCount>=2 && partsCount<markerCount
      && repairsDone < MAX_REPAIRS
      && (Date.now()-startedAt) < REPAIR_BUDGET_MS;

    if(markerCount>=2 && partsCount<markerCount){
      if(canRepair){
        try{
          const fixed=await repairMultipartQuestion(context,imageUrl,pageIndex,q);
          repairsDone++;
          repaired.push({...fixed,multipart_repaired:true});
          continue;
        }catch(error){
          repaired.push({...q,type:"multipart",multipart_incomplete:true,repair_warning:error.message});
          continue;
        }
      }
      // Over budget/cap: keep the question, mark it so the editor flags it for a
      // quick teacher check, but don't spend another slow OpenAI call.
      if(partsCount>1) q.type="multipart";
      else q.multipart_incomplete=true;
      repaired.push(q);
      continue;
    }

    if(partsCount>1 && q.type!=="multipart"){
      q.type="multipart";
    }
    repaired.push(q);
  }
  return repaired;
}

// Build few-shot correction guidance from a teacher's past corrections. Reads
// the most common corrections this teacher has made and turns them into a short
// prompt preamble so the reader avoids repeating the same mistakes on this
// teacher's worksheets. In-context learning, not retraining. Best-effort: returns
// "" on any problem so extraction is never blocked.
async function buildCorrectionMemory(context, setterUsername, token){
  const db=context.env.DB;
  if(!db) return "";
  const uname=String(setterUsername||"").trim().toLowerCase();
  if(!(await validSetter(db, uname, token))) return "";

  // Pull recent, topic-tagged corrections; keep a handful of the most instructive.
  const { results=[] } = await db.prepare(
    `SELECT field, ai_value, teacher_value, question_topic
       FROM extraction_corrections
      WHERE setter_username=? AND teacher_value IS NOT NULL AND teacher_value<>''
      ORDER BY created_at DESC
      LIMIT 12`
  ).bind(uname).all();
  if(!results.length) return "";

  // Summarise as short, concrete reminders. Cap length so we never bloat the
  // prompt (which would slow the call or risk truncation).
  const lines=[];
  for(const r of results){
    const topic=r.question_topic?` (${String(r.question_topic).slice(0,40)})`:"";
    if(r.field==="answer" && r.ai_value){
      lines.push(`• On similar questions${topic}, the correct answer was "${String(r.teacher_value).slice(0,60)}", not "${String(r.ai_value).slice(0,60)}".`);
    }else if(r.field==="type" && r.ai_value){
      lines.push(`• Questions like this${topic} should be type "${String(r.teacher_value).slice(0,30)}", not "${String(r.ai_value).slice(0,30)}".`);
    }else if(r.field==="prompt" && r.ai_value){
      lines.push(`• Read the wording carefully${topic}; previously "${String(r.ai_value).slice(0,50)}" should have been "${String(r.teacher_value).slice(0,50)}".`);
    }
    if(lines.length>=6) break;
  }
  if(!lines.length) return "";
  return `\n\nThis teacher has previously corrected the reader on their worksheets. Learn from these to avoid repeating the same mistakes:\n${lines.join("\n")}\n`;
}

async function extractPage(context,imageUrl,pageIndex,correctionMemory=""){
  const prompt=`You are processing PAGE ${pageIndex + 1} of a UK primary-school maths worksheet.${correctionMemory}

Your first duty is faithful transcription. Read ONLY this page. Do not infer questions from another page and never substitute a typical or invented worksheet question.

For every complete visible question:
1. Preserve the actual wording, numbers, mathematical symbols, units, labels and printed answer choices.
1a. FRACTIONS AS "n/d". Whenever a fraction appears anywhere — in the question wording OR in an answer — write it in plain "numerator/denominator" form using a forward slash, e.g. write one-half as "1/2", three-quarters as "3/4", seven-ninths as "7/9". Never use unicode fraction glyphs (½, ¾), never stack it, never write "1 over 2". This reads correctly when the question is spoken aloud.
1b. MINUS SIGN, NOT HYPHEN. When the image shows a subtraction or negative sign, transcribe it as a real minus sign "−" (U+2212), not a hyphen "-". For example "7 − 5" and "−3", using "−". This ensures it is read aloud as "minus" rather than a dash. (Ranges or hyphenated words that are genuinely hyphens stay as hyphens; only mathematical minus/subtraction becomes "−".)
2. Solve it and provide the correct answer.
3. Create exactly four progressive hint tiers in the hints array:
   - Hint 1: a gentle orienting prompt. Do not name the operation or method.
   - Hint 2: a strategy cue that identifies the useful approach but does not calculate it.
   - Hint 3: scaffold the problem into short steps while preserving meaningful work for the child.
   - Hint 4: show the worked method using the current numbers, but leave the final answer or final simple step for the child wherever possible.
   Also put Hint 1 into the legacy hint field. Add a separate kind worked explanation for feedback after an incorrect submitted answer.
4. Add one similar practice question and answer.
5. Set needs_visual=true when the child must see a grid, shape, diagram, graph, pictogram, number line, table, clock, fraction model or other picture to answer.
6. When needs_visual=true, give visual_bbox as [x,y,width,height] using coordinates from 0 to 1000 across the page. Include the whole relevant visual and any labels needed to understand it. Add a little surrounding context. If no visual is needed, use [0,0,0,0].
7. If a printed question contains separately answerable parts such as (a) and (b), use type=multipart and create one parts item for each printed part in order. Each part needs its own prompt, answer, answer_unit and type. Do not merge separate answers. IMPORTANT EXCEPTION: a SINGLE instruction with two or more answer boxes but NO (a)/(b) part labels — typically a unit conversion like "98mm = ⬜ cm ⬜ mm" or "204cm = ⬜ m ⬜ cm", where the pupil fills each box to complete ONE statement — is NOT multipart. Use type=sequence for these: put the box values in answer as a comma list IN ORDER (e.g. "9,8" for 98mm = 9 cm 8 mm; "2,4" for 204cm = 2 m 4 cm), and put the unit labels in answer_unit as a comma list in the same order (e.g. "cm,mm" or "m,cm") so each box shows its unit. Only use multipart when there are genuinely separate printed part labels like (a), (b). Use type=time whenever the correct answer is a clock time written with a colon, such as 3:07 or 14:35. FORMAT MUST MATCH WHAT THE QUESTION ASKS FOR: if the question asks for the answer using "a.m." or "p.m." (12-hour), store the answer in 12-hour form WITH the meridiem, e.g. "4:15 PM" or "9:30 AM" (not "16:15"). Only use 24-hour H:MM/HH:MM form when the question uses or implies the 24-hour clock. When in doubt and the question mentions a.m./p.m. or "after midday/midnight/noon", use the 12-hour form with AM or PM. Use type=drawing where the pupil must draw a line, line of symmetry, matching connection, route, reflection line or other answer directly on the diagram. For drawing questions, set answer to "teacher review", leave practice_prompt and practice_answer empty, and in answer_working record a CONCRETE ANSWER KEY the marker can check against — not a vague description. For a "join/match" drawing question, state every correct pairing and the count that justifies it, e.g. "Nest with 2 eggs -> chicken labelled 2; nest with 5 eggs -> chicken 5; nest with 4 eggs -> chicken 4". For a line-of-symmetry or route question, describe precisely where the correct line goes. Also put drawing_rubric = the same answer key. Read the picture carefully and count objects one by one; if you cannot be sure of the counts, still give your best key but note the uncertainty. Use type=sequence when the pupil must fill in several numbers in a sequence or pattern (e.g. "fill in the number snakes", "write the missing numbers", counting in 2s/5s/10s), OR when the pupil must WRITE SEVERAL NUMBERS IN ORDER (e.g. "put these decimals in order from smallest to largest", "arrange these in size order"). Put ALL the values in answer as a comma-separated list IN ORDER, e.g. "20,22,24" or "0.58,0.85,3.09,3.11,4.01". Do NOT use multiple_choice for ordering questions — the pupil gets one number box per value, so they never type commas, and it avoids confusing a comma inside one answer with a comma between choices. Use type=fraction whenever the correct answer is a single fraction written as a numerator over a denominator (e.g. "2/9", "3/4") — the pupil gets separate numerator and denominator boxes, so they never type a "/". Store the answer as "n/d". Use type=coins when the answer is a set of UK coins — questions like "which coins give change from £2 after spending 60p and 78p?", "which three coins make 62p?", "show 85p using the fewest coins". Work out the change/amount, then store the answer as a coin list using UK coins (1p,2p,5p,10p,20p,50p,£1,£2), e.g. "50p, 10p, 2p" for 62p. Include repeats explicitly (e.g. "20p, 20p, 5p"). If the question says "which three coins" or "fewest coins", give exactly that set. The pupil taps coins on screen, so they never type — mark against the exact coin set. Put the working (change = £2.00 − £1.38 = 62p = 50p+10p+2p) in answer_working and set requires_teacher_check=true. Use type=number for other typed answers and multiple_choice only where printed choices exist or are genuinely useful.
7e. WORD ANSWERS DEFAULT TO MULTIPLE CHOICE. When the correct answer is words rather than a number that a child could type on a numeric keypad — for example "write in words the number shown" (answer "four thousand six hundred and two"), spelling a number, naming a shape ("hexagon"), a day/month, or any answer containing alphabetic words — use type=multiple_choice. A phone number pad cannot type letters, so a plain typed answer is impossible for the child. Provide the correct answer plus 2-3 DIAGNOSTIC distractors that reflect common mistakes for that exact answer (e.g. for "four thousand six hundred and two": "four thousand and sixty-two" (misread place value), "four thousand six hundred and twenty" (units/tens slip), "forty-six thousand and two" (magnitude error)). Keep the answer field as the exact correct words. Whenever you produce a multiple_choice question, options MUST contain the correct answer plus 2-3 DIAGNOSTIC distractors — each distractor being the answer a child would get from a specific common mistake for that exact question (for example, adding the denominators when adding fractions, or an off-by-one place-value slip), never a random wrong number. Preserve the exact notation, units and currency of the question in every option; do not normalise them.
7d. MONEY ANSWERS. A child answers on a phone number pad and cannot type "£" or "p". For money questions, put ONLY the number in answer (e.g. "2.37" or "108") and put the currency symbol or unit in answer_unit ("£" for pounds, "p" for pence) so it shows beside the box as a label. Keep pounds and pence consistent with how the question is asked (a "how much change in p" answer is pence like "4" with unit "p"; a "£" answer is pounds like "2.37" with unit "£"). Never put the currency symbol inside the answer string.
7a. CRITICAL — ONE QUESTION PER PRINTED NUMBER. Each printed question number (for example 5, 6, 7, 8, or a range like "1-2" or "3-4") is a SEPARATE question object. Never merge two different numbered items into one prompt. Introductory text or a worked example that is NOT itself numbered (for example "A is at the point (1,2)." or "A is 1 square along and 2 squares up from (0,0).") is shared context: do NOT emit it as its own question, and do NOT prepend the whole intro to every following question. Instead, put only the essential shared context needed to answer inside each question's own prompt. A blank to fill such as "B is ___ squares along and ___ squares up" is one question. If several numbered items share one diagram (a grid, number line or shape), repeat needs_visual=true and the same visual_bbox on EACH of those questions so every one carries its own copy of the shared picture.
7b. COORDINATE GRID QUESTIONS. When a question asks the pupil to mark, plot or read a point on a coordinate grid, use type=point and populate point_answer with the [x,y] the pupil should mark. Read the printed grid's axis numbers and set grid_bounds to [xmin,xmax,ymin,ymax] exactly matching the printed grid (for example a grid labelled 0 to 5 on both axes is [0,5,0,5], NOT [-5,5,-5,5]). Set grid_step to the spacing between printed gridlines (usually 1). Always set needs_visual=true and give the visual_bbox of the printed grid so the pupil sees the same grid.
7c. NEVER TRANSCRIBE YOUR OWN READING OF A VISUAL INTO THE PROMPT. When the whole point of a question is that the pupil reads a value from a picture — an abacus, a place-value/Dienes diagram, a clock face, a thermometer, a scale, a gauge, a number line position, a bar/pictogram value — the child must read it from the attached image, NOT from your description. Do NOT add parentheticals such as "(Abacus shows: 2 in Thousands, 5 in Hundreds...)" or "(the clock shows 3:15)" to the prompt. Keep the prompt as the printed instruction only (e.g. "Write in words the number shown on the abacus."), set needs_visual=true with a visual_bbox tightly covering the picture, and put YOUR best reading only in answer and answer_working (never in prompt). If you are not fully confident of the reading, set requires_teacher_check=true. Your reading of such visuals is often wrong, so it must never become part of what the child sees.
8. A question referring to a pictogram, graph, table, grid, clock, shape, diagram, number line, chart or picture MUST have needs_visual=true. For pictograms, visual_bbox must include the complete pictogram, all row labels and the entire key. For graphs and diagrams, include every axis, label, dimension and legend needed to answer. Prefer a box that is slightly too large rather than too small.
9. For every question where the answer depends on reading a value off a visual — pictogram, chart, table, image-counting, abacus, place-value/Dienes diagram, clock face, thermometer, scale, gauge or number-line position — set requires_teacher_check=true and write the full reading/calculation in answer_working, for example "Abacus: Th=2, H=0, T=5, U=4 -> 2054" or "Age 10: 9 full symbols × 2 children = 18". Read each place or symbol one by one. For ordinary text-only arithmetic set requires_teacher_check=false. Drawing questions also require teacher check.
9c. MULTI-STEP CALCULATIONS: THE WORKING IS THE SOURCE OF TRUTH. For any question needing two or more calculation steps (e.g. elapsed time, "how many more/longer than", "add all the numbers that...", multi-operation or money/measure word problems), you MUST proceed in this exact order:
   (i) Work the answer out step by step in answer_working, showing every step and every number.
   (ii) Re-check each step arithmetically. In particular, when a question says "numbers that can be divided by X without a remainder" or "multiples of X", LIST every qualifying value explicitly and check each one (e.g. between 40 and 50 divisible by 7: 42 and 49, so 42+49=91 — do NOT stop at the first one you find).
   (iii) Take the FINAL RESULT of answer_working and COPY it into the 'answer' field. The 'answer' field must never be computed independently of the working — it is always the last line of the working. If answer_working ends in "= £21.00" then answer is "21.00"; if it ends "= 100g" and the unit box is g then answer is "100"; if it ends "= 91" then answer is "91". A mismatch between the working's final result and the answer field is a SERIOUS ERROR.
   (iv) Make every hint and the incorrect-answer feedback use the SAME numbers as the working.
Double-check elapsed-time sums (9:10 a.m. to 12:00 noon = 170 minutes, not 110). Set requires_teacher_check=true for any multi-step calculation so a teacher can confirm it. Also make sure the 'answer' matches the requested unit: if answer_working concludes "0.1 kg or 100 g" and answer_unit is "kg", store answer "0.1"; if answer_unit is "g", store "100" — the number and its unit box must agree.
18. Set requires_teacher_check=true for every drawing, point or matching question.
9b. TOPIC LABELS MUST BE SPECIFIC. For each question's 'topic', give a precise, descriptive skill label of about 2–5 words — the specific skill the question tests, not a broad umbrella. Good: "reading a 24-hour clock", "abacus place value", "multi-step word problem", "adding fractions same denominator", "fraction of an amount", "column subtraction with exchange", "shading equivalent fractions", "converting mm to cm". Avoid vague labels like "Mixed maths", "Basic arithmetic", "Fractions", "Number" on their own. Base the label on what the pupil actually has to DO in that specific question. Keep labels consistent: if two questions test the same skill, give them the same label word-for-word so they group together in reports.
9e. FRACTION ANSWERS MUST USE type=fraction — NEVER a typed answer. If the correct answer is a single fraction of the form numerator/denominator (e.g. "9/10", "3/4", "2/9", including where the question says "in its simplest form"), you MUST set type=fraction and store answer as "n/d". Do NOT use type=number or type=multiple_choice for a fraction answer. Reason: pupils answer on a phone number keypad, which has no "/" key, so a fraction typed as text is impossible to enter — type=fraction gives separate numerator and denominator boxes. This applies even if the question could also be shown as multiple choice: prefer type=fraction so the pupil can actually enter the answer. Only use multiple_choice for a fraction if the printed question itself lists specific fraction options to choose from.

9d. TAG EACH QUESTION for later filtering. Set three fields based ONLY on the question content and your knowledge of the England National Curriculum for primary maths:
- year_group: the National Curriculum year the SKILL is normally taught (Reception, Year 1 … Year 6). Infer from the maths itself — e.g. number bonds to 10 = Year 1; adding fractions with the same denominator = Year 3; long multiplication = Year 5; long division = Year 6. Use "unknown" only if you genuinely cannot tell.
- difficulty: the demand of THIS question relative to that year: "foundation" (simplest, early in the topic), "developing" (typical practice), "secure" (full expectation), or "greater_depth" (stretch / multi-step / reasoning beyond the basic skill).
- question_type: "fluency" (a bare calculation or recall), "reasoning" (explain / compare / spot the pattern), or "word_problem" (a real-world scenario in words).
These are best-effort tags for organising a question library; the teacher can change any of them, so never let tagging change the transcription of the question itself.
19. Every returned question must include every schema field. For fields that do not apply, use these neutral values:
- point_answer: [0,0]
- coordinate_answer: [0,0]
- grid_bounds: [0,0,0,0]
- grid_step: 0
- matching_left, matching_right and matching_pairs: []
- denominator: 0
- drag_item_count: 0
- clock_start: ""
- angle_start: 0
- angle_tolerance: 0
- grid_rows: 0
- grid_cols: 0
- shade_fraction: ""
- drawing_rubric: ""
- parts: []
Only populate these fields with meaningful values when the selected question type uses them.
19a. SHADE-A-FRACTION. If a question shows a grid or shape divided into equal squares/parts and asks the pupil to shade/colour a fraction of it (e.g. "Shade one-third", "Colour 1/4"), use type=shade. Set grid_rows and grid_cols to the grid you can see (count the rows and columns of cells), and shade_fraction to the target as "n/d" (e.g. "1/3"). Also set answer to the same "n/d" and requires_teacher_check=true, because the grid reading must be confirmed by the teacher. If you cannot clearly count the grid, still choose type=shade with your best row/column guess and note the uncertainty in warning.
20. If any item is too unclear, omit it and explain briefly in warning.
11. Set answer_unit to the unit requested by the printed answer line, such as ml, cm, minutes, children or £; use an empty string if unitless. Do not include the unit inside a numeric answer. 12. Return questions in exact top-to-bottom page order. Do not include pupil names.`;

  const data=await openaiResponsesCall(context.env.OPENAI_API_KEY,{
    model:context.env.OPENAI_MODEL || "gpt-4.1-mini",
    input:[{role:"user",content:[
      {type:"input_text",text:prompt},
      {type:"input_image",image_url:imageUrl,detail:"high"}
    ]}],
    text:{format:{type:"json_schema",name:"numera_page",strict:true,schema:pageSchema}},
    max_output_tokens:12000
  },{retries:1});

  const raw=outputText(data);
  if(!raw) throw new Error("OpenAI returned no page data.");
  // If the model hit the output-token ceiling the JSON is truncated and won't
  // parse. Detect that and give useful guidance rather than a cryptic error.
  if(data.status==="incomplete" && data.incomplete_details?.reason==="max_output_tokens"){
    throw new Error("This page has too many questions to read in one go. Please photograph half the page at a time.");
  }
  try{
    const parsed=JSON.parse(raw);
    parsed.questions=await repairMissedMultipart(context,imageUrl,pageIndex,parsed.questions||[]);
    return parsed;
  }catch(error){
    if(error instanceof SyntaxError) throw new Error("This page was hard to read cleanly. Try a sharper, closer photo, or photograph half the page at a time.");
    throw error;
  }
}

export async function onRequestPost(context){
  try{
    const {images=[], setter_username="", token=""}=await context.request.json();
    if(!images.length) return Response.json({error:"Upload at least one worksheet photo."},{status:400});
    if(!context.env.OPENAI_API_KEY) return Response.json({error:"OPENAI_API_KEY is missing from Cloudflare Production."},{status:503});
    if(images.length>6) return Response.json({error:"Upload no more than six pages at once."},{status:400});

    // Correction memory (the "feed back" half of the loop). If we know the
    // teacher, pull their most common past corrections and feed them into the
    // extraction prompt as few-shot guidance, so the reader gets more accurate
    // for THIS teacher over time. Fully optional and guarded: any failure here
    // leaves extraction working exactly as before. This is in-context learning,
    // NOT model retraining.
    let correctionMemory="";
    try{
      if(setter_username && token){
        correctionMemory=await buildCorrectionMemory(context, setter_username, token);
      }
    }catch(e){ correctionMemory=""; }

    const allQuestions=[];
    const warnings=[];
    const pageTopics=[];

    // Deliberately process pages one at a time. This prevents later pages from
    // dominating a single multi-image model response and preserves page order.
    for(let i=0;i<images.length;i++){
      try{
        const page=await extractPage(context,images[i],i,correctionMemory);
        if(page.page_topic) pageTopics.push(page.page_topic);
        if(page.warning) warnings.push(`Page ${i+1}: ${page.warning}`);
        for(const question of page.questions||[]){
          if(question.repair_warning){
            warnings.push(`Page ${i+1}: a multi-part question needs teacher correction because ${question.repair_warning}`);
          }
          allQuestions.push({
            ...question,
            page_index:i,
            page_number:i+1,
            source_label:`Page ${i+1}`
          });
        }
      }catch(error){
        warnings.push(`Page ${i+1} could not be read: ${error.message}`);
      }
    }

    if(!allQuestions.length){
      return Response.json({error:warnings.join(" ") || "No complete readable maths questions were found."},{status:422});
    }

    const uniqueTopics=[...new Set(pageTopics.filter(Boolean))];
    const topic=uniqueTopics.length===1 ? uniqueTopics[0] : "Mixed maths";
    return Response.json({
      title: images.length>1 ? `Maths Homework — ${images.length} pages` : `${topic} Practice`,
      topic,
      warning:warnings.join(" "),
      page_count:images.length,
      questions:allQuestions,
      source:"ai-page-by-page"
    });
  }catch(error){
    return Response.json({error:error.message||"Unable to read the worksheet."},{status:500});
  }
}
