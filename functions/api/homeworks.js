import { json } from "./_lib.js";

export async function onRequest(context){if(context.request.method==="GET")return get(context);if(context.request.method==="POST")return create(context);if(context.request.method==="PUT")return update(context);return json({error:"Method not allowed"},{status:405});}
async function create(c){
  try{
    const b=await c.request.json();
    const setterUsername=typeof b.setter_username==="string" && b.setter_username.trim()
      ? b.setter_username.trim().toLowerCase()
      : null;
    const setterToken=typeof b.setter_token==="string" && b.setter_token
      ? b.setter_token
      : null;

    if(setterUsername){
      const auth=await c.env.DB.prepare(
        "SELECT 1 ok FROM setters WHERE username=? AND session_token=? AND session_expires>CURRENT_TIMESTAMP"
      ).bind(setterUsername,setterToken).first();
      if(!auth) return json({error:"Setter session expired. Please sign in again."},{status:401});
    }

    if(!Array.isArray(b.questions) || !b.questions.length){
      return json({error:"At least one question is required."},{status:400});
    }

    const id=crypto.randomUUID().slice(0,8).toUpperCase();
    await c.env.DB.prepare(`
      INSERT INTO homeworks
        (id,title,year_group,topic,questions_json,settings_json,setter_username)
      VALUES (?,?,?,?,?,?,?)
    `).bind(
      id,
      String(b.title||"Maths Homework"),
      String(b.year_group||"Year 4"),
      String(b.topic||"Mixed maths"),
      JSON.stringify(b.questions),
      JSON.stringify(b.settings||{}),
      setterUsername
    ).run();

    return json({id,setter_username:setterUsername});
  }catch(err){
    return json({error:err.message||"The homework could not be saved."},{status:500});
  }
}

async function update(c){
  try{
    const b=await c.request.json();
    const id=String(b.id||"").trim();
    const setterUsername=String(b.setter_username||"").trim().toLowerCase();
    const setterToken=String(b.setter_token||"");

    if(!id) return json({error:"Homework ID is required."},{status:400});
    if(!setterUsername || !setterToken){
      return json({error:"Teacher sign-in is required."},{status:401});
    }

    const auth=await c.env.DB.prepare(`
      SELECT h.id
      FROM homeworks h
      JOIN setters s ON s.username=h.setter_username
      WHERE h.id=?
        AND h.setter_username=?
        AND s.session_token=?
        AND s.session_expires>CURRENT_TIMESTAMP
    `).bind(id,setterUsername,setterToken).first();

    if(!auth){
      return json({error:"You are not authorised to edit this homework, or your session has expired."},{status:403});
    }

    if(!Array.isArray(b.questions) || !b.questions.length){
      return json({error:"At least one question is required."},{status:400});
    }

    await c.env.DB.prepare(`
      UPDATE homeworks
      SET title=?,
          year_group=?,
          topic=?,
          questions_json=?,
          settings_json=?
      WHERE id=? AND setter_username=?
    `).bind(
      String(b.title||"Maths Homework"),
      String(b.year_group||"Year 4"),
      String(b.topic||"Mixed maths"),
      JSON.stringify(b.questions),
      JSON.stringify(b.settings||{}),
      id,
      setterUsername
    ).run();

    return json({id,setter_username:setterUsername,updated:true});
  }catch(err){
    return json({error:err.message||"The homework changes could not be saved."},{status:500});
  }
}

async function get(c){
  try{
    const u=new URL(c.request.url);

    if(u.searchParams.get("list")==="1"){
      const setter=u.searchParams.get("setter_username");
      const sql=setter
        ? `SELECT h.id,h.title,h.year_group,h.topic,h.questions_json,h.created_at,COUNT(s.id) submission_count
           FROM homeworks h
           LEFT JOIN submissions s ON s.homework_id=h.id
           WHERE h.setter_username=?
           GROUP BY h.id
           ORDER BY h.created_at DESC
           LIMIT 100`
        : `SELECT h.id,h.title,h.year_group,h.topic,h.questions_json,h.created_at,COUNT(s.id) submission_count
           FROM homeworks h
           LEFT JOIN submissions s ON s.homework_id=h.id
           GROUP BY h.id
           ORDER BY h.created_at DESC
           LIMIT 100`;

      const stmt=c.env.DB.prepare(sql);
      const {results=[]}=setter?await stmt.bind(setter).all():await stmt.all();

      return json(results.map(r=>({
        id:r.id,
        title:r.title,
        year_group:r.year_group,
        topic:r.topic,
        question_count:JSON.parse(r.questions_json||"[]").length,
        submission_count:Number(r.submission_count)||0,
        created_at:r.created_at
      })));
    }

    const id=u.searchParams.get("id");
    if(!id) return json({error:"Homework ID is required."},{status:400});

    const r=await c.env.DB.prepare(`SELECT * FROM homeworks WHERE id=?`).bind(id).first();
    if(!r) return json({error:"Homework not found."},{status:404});

    const requestedSetter=String(u.searchParams.get("setter_username")||"").toLowerCase();
    const requestedToken=String(u.searchParams.get("setter_token")||"");

    if(requestedSetter || requestedToken){
      const auth=await c.env.DB.prepare(`
        SELECT 1 ok
        FROM setters
        WHERE username=?
          AND session_token=?
          AND session_expires>CURRENT_TIMESTAMP
      `).bind(requestedSetter,requestedToken).first();

      if(!auth || r.setter_username!==requestedSetter){
        return json({error:"You are not authorised to edit this homework."},{status:403});
      }
    }

    return json({
      id:r.id,
      title:r.title,
      year_group:r.year_group,
      topic:r.topic,
      questions:JSON.parse(r.questions_json||"[]"),
      settings:JSON.parse(r.settings_json||"{}"),
      setter_username:r.setter_username,
      created_at:r.created_at
    });
  }catch(err){
    return json({error:err.message||"The homework could not be loaded."},{status:500});
  }
}