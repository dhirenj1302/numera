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
        required:["type","prompt","answer","options","hint","explanation","topic","practice_prompt","practice_answer","needs_visual","visual_bbox"],
        properties:{
          type:{type:"string",enum:["number","time","multiple_choice"]},
          prompt:{type:"string"},
          answer:{type:"string"},
          options:{type:"array",items:{type:"string"}},
          hint:{type:"string"},
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
          }
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

async function extractPage(context,imageUrl,pageIndex){
  const prompt=`You are processing PAGE ${pageIndex + 1} of a UK primary-school maths worksheet.

Your first duty is faithful transcription. Read ONLY this page. Do not infer questions from another page and never substitute a typical or invented worksheet question.

For every complete visible question:
1. Preserve the actual wording, numbers, mathematical symbols, units, labels and printed answer choices.
2. Solve it and provide the correct answer.
3. Add a brief helpful hint and a kind worked explanation for a child aged 8–10.
4. Add one similar practice question and answer.
5. Set needs_visual=true when the child must see a grid, shape, diagram, graph, pictogram, number line, table, clock, fraction model or other picture to answer.
6. When needs_visual=true, give visual_bbox as [x,y,width,height] using coordinates from 0 to 1000 across the page. Include the whole relevant visual and any labels needed to understand it. Add a little surrounding context. If no visual is needed, use [0,0,0,0].
7. Use type=time whenever the correct answer is a clock time written with a colon, such as 3:07 or 14:35. Store the answer in H:MM or HH:MM format. Use type=number for other typed answers and multiple_choice only where printed choices exist or are genuinely useful.
8. A question referring to a pictogram, graph, table, grid, clock, shape, diagram, number line, chart or picture MUST have needs_visual=true. For pictograms, visual_bbox must include the complete pictogram, all row labels and the entire key. For graphs and diagrams, include every axis, label, dimension and legend needed to answer. Prefer a box that is slightly too large rather than too small.
9. If any item is too unclear, omit it and explain briefly in warning.
10. Return questions in exact top-to-bottom page order. Do not include pupil names.`;

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
  try{return JSON.parse(raw)}
  catch{throw new Error("OpenAI returned an invalid page format.");}
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
