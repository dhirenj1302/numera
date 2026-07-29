export async function onRequest(context) {
  if (context.request.method === "GET") return getHomework(context);
  if (context.request.method === "POST") return createHomework(context);
  return new Response("Method not allowed",{status:405});
}
async function createHomework(context){
  try{
    const body=await context.request.json();
    if(!body.questions?.length) return Response.json({error:"At least one question is required."},{status:400});
    const id=crypto.randomUUID().slice(0,8).toUpperCase();
    await context.env.DB.prepare(`INSERT INTO homeworks (id,title,year_group,topic,questions_json,settings_json) VALUES (?,?,?,?,?,?)`)
      .bind(id,body.title||"Year 4 Maths",body.year_group||"Year 4",body.topic||"Mixed maths",JSON.stringify(body.questions),JSON.stringify(body.settings||{})).run();
    return Response.json({id});
  }catch(e){return Response.json({error:e.message},{status:500});}
}
async function getHomework(context){
  try{
    const id=new URL(context.request.url).searchParams.get("id");
    if(!id) return Response.json({error:"Homework ID is required."},{status:400});
    const row=await context.env.DB.prepare(`SELECT * FROM homeworks WHERE id=?`).bind(id).first();
    if(!row) return Response.json({error:"Homework not found."},{status:404});
    return Response.json({
      id:row.id,title:row.title,year_group:row.year_group,topic:row.topic,
      questions:JSON.parse(row.questions_json),settings:JSON.parse(row.settings_json),
      created_at:row.created_at
    });
  }catch(e){return Response.json({error:e.message},{status:500});}
}
