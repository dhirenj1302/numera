const demo = {
  title:"Year 4 Maths Practice",
  topic:"Mixed maths",
  demo_mode:true,
  questions:[
    {type:"number",prompt:"36 × 7 = ?",answer:"252",options:[],hint:"Work out 30 × 7 and 6 × 7, then add.",explanation:"30 × 7 = 210 and 6 × 7 = 42. Altogether, 210 + 42 = 252.",topic:"Multiplication",practice_prompt:"46 × 7 = ?",practice_answer:"322"},
    {type:"multiple_choice",prompt:"Which fraction is equivalent to 3/4?",answer:"6/8",options:["4/6","6/8","7/10","9/16"],hint:"Multiply the numerator and denominator by the same number.",explanation:"3/4 × 2/2 = 6/8.",topic:"Fractions",practice_prompt:"Which fraction is equivalent to 2/3?",practice_answer:"4/6"},
    {type:"number",prompt:"A teacher shares 48 counters equally between 6 pupils. How many counters does each pupil get?",answer:"8",options:[],hint:"This is a division problem: 48 ÷ 6.",explanation:"48 ÷ 6 = 8 because 6 × 8 = 48.",topic:"Word problems",practice_prompt:"Share 63 counters equally between 7 pupils. How many does each get?",practice_answer:"9"}
  ]
};

const schema = {
  type:"object",
  additionalProperties:false,
  required:["title","topic","questions"],
  properties:{
    title:{type:"string"},
    topic:{type:"string"},
    questions:{
      type:"array",
      minItems:1,
      maxItems:30,
      items:{
        type:"object",
        additionalProperties:false,
        required:["type","prompt","answer","options","hint","explanation","topic","practice_prompt","practice_answer"],
        properties:{
          type:{type:"string",enum:["number","multiple_choice"]},
          prompt:{type:"string"},
          answer:{type:"string"},
          options:{type:"array",items:{type:"string"}},
          hint:{type:"string"},
          explanation:{type:"string"},
          topic:{type:"string"},
          practice_prompt:{type:"string"},
          practice_answer:{type:"string"}
        }
      }
    }
  }
};

export async function onRequestPost(context) {
  try {
    const {images=[]} = await context.request.json();
    if (!images.length) return Response.json({error:"Upload at least one worksheet image."},{status:400});
    if (!context.env.OPENAI_API_KEY) return Response.json(demo);

    const content = [
      {type:"input_text",text:`You convert UK Year 4 maths worksheet images into a child-friendly mobile homework quiz.

Extract every clearly readable question in page order. For this prototype, represent each as either:
- number: answer is typed as a short number, fraction, decimal or brief expression
- multiple_choice: use existing answer choices where present; otherwise use number unless multiple choice is materially clearer

Rules:
- Preserve the mathematical meaning.
- Do not invent questions to replace unreadable content.
- Use concise UK English.
- Put answers in plain text.
- Include a small pedagogical hint that does not reveal the answer.
- Include a short step-by-step explanation suitable for ages 8–10.
- Create one similar practice question and its answer.
- Classify topic with a useful label such as Multiplication, Fractions, Place value, Geometry or Word problems.
- Return only the structured result.`},
      ...images.map(image_url=>({type:"input_image",image_url,detail:"high"}))
    ];

    const response = await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{
        "Authorization":`Bearer ${context.env.OPENAI_API_KEY}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:context.env.OPENAI_MODEL || "gpt-5-mini",
        input:[{role:"user",content}],
        text:{
          format:{
            type:"json_schema",
            name:"numera_homework",
            strict:true,
            schema
          }
        }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "OpenAI extraction failed.");
    const raw = data.output_text || data.output?.flatMap(o=>o.content||[]).find(c=>c.type==="output_text")?.text;
    if (!raw) throw new Error("The AI returned no worksheet data.");
    return Response.json(JSON.parse(raw));
  } catch (error) {
    return Response.json({error:error.message || "Unable to read the worksheet."},{status:500});
  }
}
