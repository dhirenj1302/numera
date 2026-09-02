import { json } from "./_lib.js";

export async function onRequest(context){
  if(context.request.method==="POST") return create(context);
  if(context.request.method==="GET") return list(context);
  return json({error:"Method not allowed"},{status:405});
}

const slug=value=>String(value||"")
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[^a-z0-9]+/g,"-")
  .replace(/^-+|-+$/g,"")
  .slice(0,80) || "general-maths";

function questionConcept(question,homework){
  const conceptName=String(
    question.concept_name ||
    question.subtopic ||
    question.topic ||
    homework.topic ||
    "General maths"
  ).trim();

  return {
    concept_key:String(question.concept_key||`${slug(homework.year_group)}:${slug(conceptName)}`),
    concept_name:conceptName,
    curriculum_objective:String(
      question.curriculum_objective ||
      `${homework.year_group || "Primary"} — ${conceptName}`
    ),
    year_group:String(homework.year_group||"Year 4"),
    topic:String(question.topic||homework.topic||"Mixed maths")
  };
}

function evidenceFromAttempt(attempt){
  if(attempt?.requires_teacher_review){
    return {evidence_score:0.50,evidence_weight:0.20,evidence_type:"teacher_review_pending",understanding_state:"unverified"};
  }
  const firstCorrect=attempt?.first_correct===true;
  const mastered=attempt?.mastered===true;
  const level=Math.max(0,Math.min(4,Number(attempt?.highest_hint_level)||0));
  const retries=Math.max(0,Number(attempt?.retries)||0);
  if(firstCorrect){
    const scores=[1.00,0.90,0.80,0.68,0.55];
    const weights=[1.00,0.95,0.90,0.82,0.75];
    const types=["independent_correct","correct_after_hint_1","correct_after_hint_2","correct_after_hint_3","correct_after_hint_4"];
    return {evidence_score:scores[level],evidence_weight:weights[level],evidence_type:types[level],understanding_state:level<=1?"secure":"developing"};
  }
  if(mastered){
    const base=[0.72,0.68,0.62,0.55,0.45][level];
    return {evidence_score:Math.max(0.35,base-(retries*0.04)),evidence_weight:0.75,evidence_type:level?`mastered_after_error_hint_${level}`:"mastered_after_feedback",understanding_state:"developing"};
  }
  return {evidence_score:0.18,evidence_weight:0.90,evidence_type:level?`not_yet_mastered_hint_${level}`:"not_yet_mastered",understanding_state:"priority"};
}

function nextReviewDate(score){
  const days=score>=85?28:score>=70?14:score>=50?7:2;
  const date=new Date(Date.now()+days*86400000);
  return date.toISOString().slice(0,19).replace("T"," ");
}

async function updateUnderstanding(context,{submissionId,homework,username,attempts}){
  const questions=Array.isArray(homework.questions)?homework.questions:[];
  const statements=[];

  for(let i=0;i<questions.length;i++){
    const question=questions[i]||{};
    const attempt=attempts[i]||{};
    const concept=questionConcept(question,homework);
    const evidence=evidenceFromAttempt(attempt);
    const masteryScore=Math.round(evidence.evidence_score*100);
    const eventId=crypto.randomUUID();

    statements.push(
      context.env.DB.prepare(`
        INSERT INTO concepts
          (concept_key,concept_name,curriculum_objective,year_group,topic)
        VALUES (?,?,?,?,?)
        ON CONFLICT(concept_key) DO UPDATE SET
          concept_name=excluded.concept_name,
          curriculum_objective=excluded.curriculum_objective,
          year_group=excluded.year_group,
          topic=excluded.topic
      `).bind(
        concept.concept_key,concept.concept_name,concept.curriculum_objective,
        concept.year_group,concept.topic
      )
    );

    statements.push(
      context.env.DB.prepare(`
        INSERT INTO learning_events
          (id,student_username,submission_id,homework_id,question_index,
           concept_key,evidence_type,evidence_score,evidence_weight,
           first_correct,hint_used,highest_hint_level,hint_count,
           seconds_before_first_hint,retries,mastered,understanding_state)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(
        eventId,username,submissionId,homework.id,i,
        concept.concept_key,evidence.evidence_type,evidence.evidence_score,
        evidence.evidence_weight,attempt.first_correct===true?1:0,
        attempt.hint_used===true?1:0,
        Math.max(0,Math.min(4,Number(attempt.highest_hint_level)||0)),
        Math.max(0,Number(attempt.hint_count)||0),
        attempt.seconds_before_first_hint==null?null:Math.max(0,Number(attempt.seconds_before_first_hint)||0),
        Number(attempt.retries)||0,
        attempt.mastered===true?1:0,evidence.understanding_state
      )
    );

    statements.push(
      context.env.DB.prepare(`
        INSERT INTO student_concept_mastery
          (student_username,concept_key,mastery_score,confidence_score,
           evidence_count,last_evidence_type,last_seen_at,next_review_at)
        VALUES (?,?,?,?,1,?,CURRENT_TIMESTAMP,?)
        ON CONFLICT(student_username,concept_key) DO UPDATE SET
          mastery_score=ROUND(
            (
              student_concept_mastery.mastery_score *
              student_concept_mastery.confidence_score
              +
              excluded.mastery_score *
              excluded.confidence_score
            )
            /
            NULLIF(
              student_concept_mastery.confidence_score +
              excluded.confidence_score,
              0
            )
          ),
          confidence_score=MIN(
            10.0,
            student_concept_mastery.confidence_score +
            excluded.confidence_score
          ),
          evidence_count=student_concept_mastery.evidence_count+1,
          last_evidence_type=excluded.last_evidence_type,
          last_seen_at=CURRENT_TIMESTAMP,
          next_review_at=excluded.next_review_at
      `).bind(
        username,concept.concept_key,masteryScore,evidence.evidence_weight,
        evidence.evidence_type,nextReviewDate(masteryScore)
      )
    );
  }

  // D1 batch is atomic: either all understanding updates succeed or none do.
  if(statements.length) await context.env.DB.batch(statements);
}

async function create(context){
  try{
    if(!context.env.DB) return json({error:"Cloudflare D1 binding DB is missing."},{status:503});
    const body=await context.request.json();
    const username=String(body.student_username||"").trim().toLowerCase();

    if(!body.homework_id) return json({error:"homework_id is required."},{status:400});
    if(!username) return json({error:"Student username is required."},{status:400});

    const homeworkRow=await context.env.DB.prepare(`
      SELECT id,title,year_group,topic,questions_json
      FROM homeworks WHERE id=?
    `).bind(body.homework_id).first();

    if(!homeworkRow) return json({error:"Homework was not found."},{status:404});

    const homework={
      ...homeworkRow,
      questions:JSON.parse(homeworkRow.questions_json||"[]")
    };

    const attempts=Array.isArray(body.attempts)?body.attempts:[];
    const id=crypto.randomUUID();

    await context.env.DB.prepare(`
      INSERT INTO submissions
        (id,homework_id,student_name,student_username,original_score,
         mastery_score,total_questions,attempts_json,strengths_json,
         needs_practice_json,gems_earned)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      id,body.homework_id,String(body.student_name||"").trim(),username,
      Number(body.original_score)||0,Number(body.mastery_score)||0,
      Math.max(1,Number(body.total_questions)||1),
      JSON.stringify(attempts),JSON.stringify(body.strengths||[]),
      JSON.stringify(body.needs_practice||[]),
      Math.max(0,Number(body.gems_earned)||0)
    ).run();

    // The student's accumulated gem total = sum of gems across ALL their
    // submissions (device-independent, since it lives server-side). Include the
    // one just inserted.
    let gemsTotal=0;
    try{
      const row=await context.env.DB.prepare(
        `SELECT COALESCE(SUM(gems_earned),0) AS total FROM submissions WHERE student_username=?`
      ).bind(username).first();
      gemsTotal=Number(row?.total)||0;
    }catch(e){ gemsTotal=Math.max(0,Number(body.gems_earned)||0); }

    try{
      await updateUnderstanding(context,{
        submissionId:id,homework,username,attempts
      });
    }catch(understandingError){
      // Preserve the completed homework even if understanding aggregation fails.
      console.error("Understanding update failed",understandingError);
      return json({
        id,saved:true,understanding_updated:false,
        understanding_error:understandingError.message,
        gems_total:gemsTotal
      });
    }

    return json({id,saved:true,understanding_updated:true,gems_total:gemsTotal});
  }catch(error){
    return json({error:error.message||"The result could not be saved."},{status:500});
  }
}

async function list(context){
  try{
    if(!context.env.DB) return json({error:"Cloudflare D1 binding DB is missing."},{status:503});
    const url=new URL(context.request.url);
    const username=String(url.searchParams.get("student_username")||"").trim().toLowerCase();
    const homeworkId=url.searchParams.get("homework_id");

    if(username){
      const {results=[]}=await context.env.DB.prepare(`
        SELECT s.student_name,s.student_username,s.original_score,
               s.mastery_score,s.total_questions,s.completed_at,
               h.title AS homework_title,h.topic
        FROM submissions s
        JOIN homeworks h ON h.id=s.homework_id
        WHERE s.student_username=?
        ORDER BY s.completed_at DESC
      `).bind(username).all();

      const percentages=results.map(row=>({
        original:Math.round(row.original_score/Math.max(1,row.total_questions)*100),
        mastery:Math.round(row.mastery_score/Math.max(1,row.total_questions)*100)
      }));
      const average=key=>percentages.length
        ? Math.round(percentages.reduce((sum,row)=>sum+row[key],0)/percentages.length)
        : 0;

      return json({
        summary:{
          homework_count:results.length,
          average_original:average("original"),
          average_mastery:average("mastery")
        },
        results
      });
    }

    if(!homeworkId) return json({error:"homework_id or student_username is required."},{status:400});
    const {results=[]}=await context.env.DB.prepare(`
      SELECT * FROM submissions
      WHERE homework_id=?
      ORDER BY completed_at DESC
    `).bind(homeworkId).all();

    return json(results.map(row=>({
      ...row,
      attempts:JSON.parse(row.attempts_json||"[]"),
      strengths:JSON.parse(row.strengths_json||"[]"),
      needs_practice:JSON.parse(row.needs_practice_json||"[]")
    })));
  }catch(error){
    return json({error:error.message||"Results could not be loaded."},{status:500});
  }
}
