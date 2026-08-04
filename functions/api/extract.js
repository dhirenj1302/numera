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
        required:["type","prompt","answer","options","hint","hints","explanation","topic","practice_prompt","practice_answer","needs_visual","visual_bbox","requires_teacher_check","answer_working","answer_unit","parts"],
        properties:{
          type:{type:"string",enum:["number","time","multiple_choice","drawing","point","matching","multipart"]},
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
          grid_bounds:{type:"array",minItems:4,maxItems:4,items:{type:"number"}},
          grid_step:{type:"number"},
          matching_left:{type:"array",items:{type:"string"}},
          matching_right:{type:"array",items:{type:"string"}},
          matching_pairs:{type:"array",items:{type:"string"}}, parts:{type:"array",maxItems:6,items:{type:"object",additionalProperties:false,required:["label","prompt","answer","answer_unit","type"],properties:{label:{type:"string"},prompt:{type:"string"},answer:{type:"string"},answer_unit:{type:"string"},type:{type:"string",enum:["number","time","multiple_choice"]}}}}
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
7. If a printed question contains separately answerable parts such as (a) and (b), use type=multipart and create one parts item for each printed part in order. Each part needs its own prompt, answer, answer_unit and type. Do not merge separate answers. Use type=time whenever the correct answer is a clock time written with a colon, such as 3:07 or 14:35. Store the answer in H:MM or HH:MM format. Use type=drawing where the pupil must draw a line, line of symmetry, matching connection, route, reflection line or other answer directly on the diagram. For drawing questions, set answer to "teacher review", leave practice_prompt and practice_answer empty, and describe the expected drawing briefly in answer_working. Use type=number for other typed answers and multiple_choice only where printed choices exist or are genuinely useful.
8. A question referring to a pictogram, graph, table, grid, clock, shape, diagram, number line, chart or picture MUST have needs_visual=true. For pictograms, visual_bbox must include the complete pictogram, all row labels and the entire key. For graphs and diagrams, include every axis, label, dimension and legend needed to answer. Prefer a box that is slightly too large rather than too small.
9. For every pictogram, chart, table or image-counting question, set requires_teacher_check=true. Write the complete counting calculation in answer_working, for example "Age 10: 9 full symbols × 2 children = 18". Count symbols one by one and apply the key explicitly. For ordinary text-only arithmetic set requires_teacher_check=false. Drawing questions also require teacher check.
10. If any item is too unclear, omit it and explain briefly in warning.
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
