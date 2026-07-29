export async function onRequest(context) {
  if(context.request.method==="GET") return list(context);
  if(context.request.method==="POST") return create(context);
  return new Response("Method not allowed",{status:405});
}
async function create(context){
  try{
    const b=await context.request.json();
    const id=crypto.randomUUID();
    await context.env.DB.prepare(`INSERT INTO submissions
      (id,homework_id,student_name,original_score,mastery_score,total_questions,attempts_json,strengths_json,needs_practice_json)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(id,b.homework_id,b.student_name,b.original_score,b.mastery_score,b.total_questions,
        JSON.stringify(b.attempts||[]),JSON.stringify(b.strengths||[]),JSON.stringify(b.needs_practice||[])).run();
    return Response.json({id});
  }catch(e){return Response.json({error:e.message},{status:500});}
}
async function list(context){
  try{
    const homeworkId=new URL(context.request.url).searchParams.get("homework_id");
    if(!homeworkId) return Response.json({error:"homework_id is required."},{status:400});
    const {results}=await context.env.DB.prepare(`SELECT * FROM submissions WHERE homework_id=? ORDER BY completed_at DESC`).bind(homeworkId).all();
    return Response.json(results.map(r=>({
      ...r,
      attempts:JSON.parse(r.attempts_json),
      strengths:JSON.parse(r.strengths_json),
      needs_practice:JSON.parse(r.needs_practice_json)
    })));
  }catch(e){return Response.json({error:e.message},{status:500});}
}
