
const json=(body,init={})=>Response.json(body,{
  ...init,
  headers:{"Cache-Control":"no-store",...(init.headers||{})}
});

function band(score,confidence){
  if(confidence<0.75) return "insufficient_evidence";
  if(score>=85) return "secure";
  if(score>=65) return "developing";
  return "priority";
}

export async function onRequestGet(context){
  try{
    if(!context.env.DB) return json({error:"Cloudflare D1 binding DB is missing."},{status:503});
    const username=String(
      new URL(context.request.url).searchParams.get("student_username")||""
    ).trim().toLowerCase();

    if(!username) return json({error:"student_username is required."},{status:400});

    const student=await context.env.DB.prepare(`
      SELECT username,display_name FROM students WHERE username=?
    `).bind(username).first();

    if(!student) return json({error:"Student username not found."},{status:404});

    const {results=[]}=await context.env.DB.prepare(`
      SELECT m.concept_key,c.concept_name,c.curriculum_objective,c.year_group,
             c.topic,m.mastery_score,m.confidence_score,m.evidence_count,
             m.last_evidence_type,m.last_seen_at,m.next_review_at
      FROM student_concept_mastery m
      JOIN concepts c ON c.concept_key=m.concept_key
      WHERE m.student_username=?
      ORDER BY m.mastery_score DESC,c.concept_name
    `).bind(username).all();

    const concepts=results.map(row=>({
      ...row,
      band:band(Number(row.mastery_score),Number(row.confidence_score))
    }));

    const weighted=concepts.reduce((acc,row)=>{
      const weight=Math.max(0.25,Math.min(5,Number(row.confidence_score)||0));
      acc.score+=Number(row.mastery_score)*weight;
      acc.weight+=weight;
      return acc;
    },{score:0,weight:0});

    const understandingScore=weighted.weight
      ? Math.round(weighted.score/weighted.weight)
      : 0;

    const byBand=name=>concepts.filter(row=>row.band===name);
    const priorities=[...concepts]
      .filter(row=>row.band==="priority")
      .sort((a,b)=>a.mastery_score-b.mastery_score)
      .slice(0,5);
    const strengths=[...concepts]
      .filter(row=>row.band==="secure")
      .sort((a,b)=>b.mastery_score-a.mastery_score)
      .slice(0,5);

    return json({
      student,
      summary:{
        understanding_score:understandingScore,
        concept_count:concepts.length,
        secure_count:byBand("secure").length,
        developing_count:byBand("developing").length,
        priority_count:byBand("priority").length,
        evidence_count:concepts.reduce((sum,row)=>sum+Number(row.evidence_count||0),0)
      },
      strengths,
      priorities,
      concepts
    });
  }catch(error){
    return json({error:error.message||"Understanding data could not be loaded."},{status:500});
  }
}
