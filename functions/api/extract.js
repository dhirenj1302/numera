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
        required:["type","prompt","answer","options","hint","hints","explanation","topic","practice_prompt","practice_answer","needs_visual","visual_bbox","requires_teacher_check","answer_working","answer_unit","point_answer","coordinate_answer","grid_bounds","grid_step","matching_left","matching_right","matching_pairs","denominator","drag_item_count","clock_start","angle_start","angle_tolerance","drawing_rubric","parts"],
        properties:{
          type:{type:"string",enum:["number","time","multiple_choice","drawing","point","coordinate","matching","fraction","fraction_visual","drag","clock","angle","multipart"]},
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
  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{Authorization:`Bearer ${context.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
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
    })
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error?.message||`OpenAI returned ${response.status}`);
  const raw=outputText(data);
  if(!raw) throw new Error("No repaired multipart data returned.");
  return JSON.parse(raw);
}

async function repairMissedMultipart(context,imageUrl,pageIndex,questions){
  const repaired=[];
  for(const q of questions||[]){
    const markerCount=countPrintedPartMarkers(q.prompt);
    const partsCount=Array.isArray(q.parts)?q.parts.length:0;

    if(markerCount>=2 && partsCount<markerCount){
      try{
        const fixed=await repairMultipartQuestion(context,imageUrl,pageIndex,q);
        repaired.push({...fixed,multipart_repaired:true});
        continue;
      }catch(error){
        repaired.push({...q,type:"multipart",multipart_incomplete:true,repair_warning:error.message});
        continue;
      }
    }

    if(partsCount>1 && q.type!=="multipart"){
      q.type="multipart";
    }
    repaired.push(q);
  }
  return repaired;
}

async function extractPage(context,imageUrl,pageIndex){
  const prompt=`You are processing PAGE ${pageIndex + 1} of a UK primary-school maths worksheet.

Your first duty is faithful transcription. Read ONLY this page. Do not infer questions from another page and never substitute a typical or invented worksheet question.

For every complete visible question:
1. Preserve the actual wording, numbers, mathematical symbols, units, labels and printed answer choices.
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
7. If a printed question contains separately answerable parts such as (a) and (b), use type=multipart and create one parts item for each printed part in order. Each part needs its own prompt, answer, answer_unit and type. Do not merge separate answers. Use type=time whenever the correct answer is a clock time written with a colon, such as 3:07 or 14:35. Store the answer in H:MM or HH:MM format. Use type=drawing where the pupil must draw a line, line of symmetry, matching connection, route, reflection line or other answer directly on the diagram. For drawing questions, set answer to "teacher review", leave practice_prompt and practice_answer empty, and in answer_working record a CONCRETE ANSWER KEY the marker can check against — not a vague description. For a "join/match" drawing question, state every correct pairing and the count that justifies it, e.g. "Nest with 2 eggs -> chicken labelled 2; nest with 5 eggs -> chicken 5; nest with 4 eggs -> chicken 4". For a line-of-symmetry or route question, describe precisely where the correct line goes. Also put drawing_rubric = the same answer key. Read the picture carefully and count objects one by one; if you cannot be sure of the counts, still give your best key but note the uncertainty. Use type=number for other typed answers and multiple_choice only where printed choices exist or are genuinely useful. Whenever you produce a multiple_choice question, options MUST contain the correct answer plus 2-3 DIAGNOSTIC distractors — each distractor being the answer a child would get from a specific common mistake for that exact question (for example, adding the denominators when adding fractions, or an off-by-one place-value slip), never a random wrong number. Preserve the exact notation, units and currency of the question in every option; do not normalise them.
7a. CRITICAL — ONE QUESTION PER PRINTED NUMBER. Each printed question number (for example 5, 6, 7, 8, or a range like "1-2" or "3-4") is a SEPARATE question object. Never merge two different numbered items into one prompt. Introductory text or a worked example that is NOT itself numbered (for example "A is at the point (1,2)." or "A is 1 square along and 2 squares up from (0,0).") is shared context: do NOT emit it as its own question, and do NOT prepend the whole intro to every following question. Instead, put only the essential shared context needed to answer inside each question's own prompt. A blank to fill such as "B is ___ squares along and ___ squares up" is one question. If several numbered items share one diagram (a grid, number line or shape), repeat needs_visual=true and the same visual_bbox on EACH of those questions so every one carries its own copy of the shared picture.
7b. COORDINATE GRID QUESTIONS. When a question asks the pupil to mark, plot or read a point on a coordinate grid, use type=point and populate point_answer with the [x,y] the pupil should mark. Read the printed grid's axis numbers and set grid_bounds to [xmin,xmax,ymin,ymax] exactly matching the printed grid (for example a grid labelled 0 to 5 on both axes is [0,5,0,5], NOT [-5,5,-5,5]). Set grid_step to the spacing between printed gridlines (usually 1). Always set needs_visual=true and give the visual_bbox of the printed grid so the pupil sees the same grid.
7c. NEVER TRANSCRIBE YOUR OWN READING OF A VISUAL INTO THE PROMPT. When the whole point of a question is that the pupil reads a value from a picture — an abacus, a place-value/Dienes diagram, a clock face, a thermometer, a scale, a gauge, a number line position, a bar/pictogram value — the child must read it from the attached image, NOT from your description. Do NOT add parentheticals such as "(Abacus shows: 2 in Thousands, 5 in Hundreds...)" or "(the clock shows 3:15)" to the prompt. Keep the prompt as the printed instruction only (e.g. "Write in words the number shown on the abacus."), set needs_visual=true with a visual_bbox tightly covering the picture, and put YOUR best reading only in answer and answer_working (never in prompt). If you are not fully confident of the reading, set requires_teacher_check=true. Your reading of such visuals is often wrong, so it must never become part of what the child sees.
8. A question referring to a pictogram, graph, table, grid, clock, shape, diagram, number line, chart or picture MUST have needs_visual=true. For pictograms, visual_bbox must include the complete pictogram, all row labels and the entire key. For graphs and diagrams, include every axis, label, dimension and legend needed to answer. Prefer a box that is slightly too large rather than too small.
9. For every question where the answer depends on reading a value off a visual — pictogram, chart, table, image-counting, abacus, place-value/Dienes diagram, clock face, thermometer, scale, gauge or number-line position — set requires_teacher_check=true and write the full reading/calculation in answer_working, for example "Abacus: Th=2, H=0, T=5, U=4 -> 2054" or "Age 10: 9 full symbols × 2 children = 18". Read each place or symbol one by one. For ordinary text-only arithmetic set requires_teacher_check=false. Drawing questions also require teacher check.
18. Set requires_teacher_check=true for every drawing, point or matching question.
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
- drawing_rubric: ""
- parts: []
Only populate these fields with meaningful values when the selected question type uses them.
20. If any item is too unclear, omit it and explain briefly in warning.
11. Set answer_unit to the unit requested by the printed answer line, such as ml, cm, minutes, children or £; use an empty string if unitless. Do not include the unit inside a numeric answer. 12. Return questions in exact top-to-bottom page order. Do not include pupil names.`;

  const response=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{Authorization:`Bearer ${context.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
    body:JSON.stringify({
      model:context.env.OPENAI_MODEL || "gpt-4.1-mini",
      input:[{role:"user",content:[
        {type:"input_text",text:prompt},
        {type:"input_image",image_url:imageUrl,detail:"high"}
      ]}],
      text:{format:{type:"json_schema",name:"numera_page",strict:true,schema:pageSchema}},
      max_output_tokens:10000
    })
  });

  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    throw new Error(data.error?.message || `OpenAI returned ${response.status}`);
  }
  const raw=outputText(data);
  if(!raw) throw new Error("OpenAI returned no page data.");
  try{
    const parsed=JSON.parse(raw);
    parsed.questions=await repairMissedMultipart(context,imageUrl,pageIndex,parsed.questions||[]);
    return parsed;
  }catch(error){
    if(error instanceof SyntaxError) throw new Error("OpenAI returned an invalid page format.");
    throw error;
  }
}

export async function onRequestPost(context){
  try{
    const {images=[]}=await context.request.json();
    if(!images.length) return Response.json({error:"Upload at least one worksheet photo."},{status:400});
    if(!context.env.OPENAI_API_KEY) return Response.json({error:"OPENAI_API_KEY is missing from Cloudflare Production."},{status:503});
    if(images.length>6) return Response.json({error:"Upload no more than six pages at once."},{status:400});

    const allQuestions=[];
    const warnings=[];
    const pageTopics=[];

    // Deliberately process pages one at a time. This prevents later pages from
    // dominating a single multi-image model response and preserves page order.
    for(let i=0;i<images.length;i++){
      try{
        const page=await extractPage(context,images[i],i);
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
