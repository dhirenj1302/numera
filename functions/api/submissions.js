export async function onRequest(context) {
  if(context.request.method==="GET") return list(context);
  if(context.request.method==="POST") return create(context);
  return Response.json({error:"Method not allowed"},{status:405});
}

const json = (body, init={}) => Response.json(body,{
  ...init,
  headers:{
    "Cache-Control":"no-store",
    ...(init.headers||{})
  }
});

async function create(context){
  try{
    if(!context.env.DB) return json({error:"Cloudflare D1 binding DB is missing."},{status:503});

    const b=await context.request.json();
    if(!b.homework_id) return json({error:"homework_id is required."},{status:400});
    if(!String(b.student_name||"").trim()) return json({error:"student_name is required."},{status:400});

    const attemptsJson=JSON.stringify(b.attempts||[]);
    const strengthsJson=JSON.stringify(b.strengths||[]);
    const needsJson=JSON.stringify(b.needs_practice||[]);
    const payloadBytes=new TextEncoder().encode(attemptsJson).length;

    if(payloadBytes>750000){
      return json({
        error:"The result data is too large to save. Drawing preview images must not be included.",
        payload_bytes:payloadBytes
      },{status:413});
    }

    const id=crypto.randomUUID();
    await context.env.DB.prepare(`INSERT INTO submissions
      (id,homework_id,student_name,original_score,mastery_score,total_questions,attempts_json,strengths_json,needs_practice_json)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(
        id,
        b.homework_id,
        String(b.student_name).trim(),
        Number(b.original_score)||0,
        Number(b.mastery_score)||0,
        Math.max(1,Number(b.total_questions)||1),
        attemptsJson,
        strengthsJson,
        needsJson
      ).run();

    return json({id,saved:true});
  }catch(e){
    return json({error:e.message||"The result could not be saved to D1."},{status:500});
  }
}

async function list(context){
  try{
    if(!context.env.DB) return json({error:"Cloudflare D1 binding DB is missing."},{status:503});
    const homeworkId=new URL(context.request.url).searchParams.get("homework_id");
    if(!homeworkId) return json({error:"homework_id is required."},{status:400});

    const {results=[]}=await context.env.DB.prepare(`
      SELECT id,homework_id,student_name,original_score,mastery_score,total_questions,
             attempts_json,strengths_json,needs_practice_json,completed_at
      FROM submissions
      WHERE homework_id=?
      ORDER BY completed_at DESC
    `).bind(homeworkId).all();

    return json(results.map(r=>({
      ...r,
      attempts:JSON.parse(r.attempts_json||"[]"),
      strengths:JSON.parse(r.strengths_json||"[]"),
      needs_practice:JSON.parse(r.needs_practice_json||"[]")
    })));
  }catch(e){
    return json({error:e.message||"Results could not be loaded from D1."},{status:500});
  }
}
