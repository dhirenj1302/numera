export async function onRequest(context) {
  if (context.request.method === "GET") return getHomework(context);
  if (context.request.method === "POST") return createHomework(context);
  return Response.json({error:"Method not allowed"},{status:405});
}

async function createHomework(context){
  try{
    if(!context.env.DB) return Response.json({error:"Cloudflare D1 binding DB is missing from Production."},{status:503});
    const raw=await context.request.text();
    if(raw.length>5_500_000) return Response.json({error:"Homework payload is too large to store. Reduce the number or size of worksheet visuals."},{status:413});
    let body;
    try{body=JSON.parse(raw)}catch{return Response.json({error:"The publish request was not valid JSON."},{status:400});}
    if(!Array.isArray(body.questions) || !body.questions.length) return Response.json({error:"At least one question is required."},{status:400});
    const invalid=body.questions.findIndex(q=>!String(q.prompt||"").trim() || String(q.answer??"").trim()==="");
    if(invalid>=0) return Response.json({error:`Question ${invalid+1} needs both wording and a correct answer.`},{status:400});

    const id=crypto.randomUUID().slice(0,8).toUpperCase();
    const questionsJson=JSON.stringify(body.questions);
    const settingsJson=JSON.stringify(body.settings||{});
    await context.env.DB.prepare(`INSERT INTO homeworks (id,title,year_group,topic,questions_json,settings_json) VALUES (?,?,?,?,?,?)`)
      .bind(id,body.title||"Year 4 Maths",body.year_group||"Year 4",body.topic||"Mixed maths",questionsJson,settingsJson).run();
    return Response.json({id});
  }catch(e){
    return Response.json({error:`Could not save homework to D1: ${e.message}`},{status:500});
  }
}

async function getHomework(context){
  try{
    if(!context.env.DB) return Response.json({error:"Cloudflare D1 binding DB is missing from Production."},{status:503});
    const id=new URL(context.request.url).searchParams.get("id");
    if(!id) return Response.json({error:"Homework ID is required."},{status:400});
    const row=await context.env.DB.prepare(`SELECT * FROM homeworks WHERE id=?`).bind(id).first();
    if(!row) return Response.json({error:"Homework not found."},{status:404});
    return Response.json({
      id:row.id,title:row.title,year_group:row.year_group,topic:row.topic,
      questions:JSON.parse(row.questions_json),settings:JSON.parse(row.settings_json),created_at:row.created_at
    });
  }catch(e){return Response.json({error:`Could not load homework: ${e.message}`},{status:500});}
}
