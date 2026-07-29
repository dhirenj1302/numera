const schema = {
  type:"object", additionalProperties:false,
  required:["title","topic","warning","questions"],
  properties:{
    title:{type:"string"}, topic:{type:"string"}, warning:{type:"string"},
    questions:{type:"array",minItems:1,maxItems:40,items:{
      type:"object",additionalProperties:false,
      required:["type","prompt","answer","options","hint","explanation","topic","practice_prompt","practice_answer"],
      properties:{
        type:{type:"string",enum:["number","multiple_choice"]}, prompt:{type:"string"}, answer:{type:"string"},
        options:{type:"array",items:{type:"string"}}, hint:{type:"string"}, explanation:{type:"string"}, topic:{type:"string"},
        practice_prompt:{type:"string"}, practice_answer:{type:"string"}
      }
    }}
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

export async function onRequestPost(context){
  try{
    const {images=[]}=await context.request.json();
    if(!images.length) return Response.json({error:"Upload at least one worksheet photo."},{status:400});
    if(!context.env.OPENAI_API_KEY) return Response.json({error:"OPENAI_API_KEY has not been added to the Production environment in Cloudflare."},{status:503});
    if(images.length>6) return Response.json({error:"Upload no more than six pages at once."},{status:400});

    const content=[{
      type:"input_text",
      text:`Act as a meticulous UK primary-school maths worksheet transcriber and teaching assistant. Read the attached worksheet photographs and convert the ACTUAL visible questions into a mobile quiz for children aged 8–10.

NON-NEGOTIABLE:
1. Transcribe only questions genuinely visible in the images, in page order. Never substitute demo or invented worksheet questions.
2. Solve each visible question independently and provide the correct answer.
3. If part of a question is unreadable, omit that question and mention it briefly in warning.
4. Preserve units, fractions, money, diagrams described in words, answer choices and multi-part labels.
5. For now use type "number" for short typed answers and "multiple_choice" only where choices are printed or clearly useful.
6. For multiple choice, provide 3–5 options and ensure answer exactly matches one option.
7. Give a short hint without revealing the answer, then a kind worked explanation suitable for UK Year 4.
8. Create one genuinely similar practice question and answer.
9. Use concise British English. Do not include pupil names.
10. Return a useful title, overall topic and warning (empty string when all pages are clear).`
    },...images.map(image_url=>({type:"input_image",image_url,detail:"high"}))];

    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${context.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:context.env.OPENAI_MODEL || "gpt-4.1-mini",
        input:[{role:"user",content}],
        text:{format:{type:"json_schema",name:"numera_homework",strict:true,schema}},
        max_output_tokens:12000
      })
    });
    const data=await response.json();
    if(!response.ok){
      const message=data.error?.message || `OpenAI returned ${response.status}`;
      throw new Error(message);
    }
    const raw=outputText(data);
    if(!raw) throw new Error("OpenAI returned no readable worksheet data.");
    let parsed;
    try{parsed=JSON.parse(raw)}catch{throw new Error("OpenAI read the image but returned an invalid question format. Please try once more.");}
    if(!parsed.questions?.length) throw new Error("No complete, readable maths questions were found. Retake the photo closer to the page.");
    parsed.source="ai";
    return Response.json(parsed);
  }catch(error){
    return Response.json({error:error.message||"Unable to read the worksheet."},{status:500});
  }
}
