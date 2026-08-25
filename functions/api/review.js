// functions/api/review.js
// Read-only review data.
//   ?student_username=...  -> that student's homework history (setter- or student-authorised)
//   (no student_username)  -> setter's class overview: students, homeworks, ranking

import { json, clean } from "./_lib.js";

async function setterAuth(db, username, token) {
  return db
    .prepare(
      "SELECT username FROM setters WHERE username=? AND session_token=? AND session_expires>CURRENT_TIMESTAMP"
    )
    .bind(clean(username), token)
    .first();
}

const pct = (value, total) => Math.round((Number(value) / Math.max(1, Number(total))) * 100);

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const db = context.env.DB;
    const studentUsername = clean(url.searchParams.get("student_username"));
    const setter = await setterAuth(
      db,
      url.searchParams.get("setter_username"),
      url.searchParams.get("token")
    );

    if (studentUsername) {
      return studentHistory(context, db, setter, studentUsername, url);
    }

    if (!setter) return json({ error: "Setter session expired." }, { status: 401 });
    return classOverview(db, setter);
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

async function studentHistory(context, db, setter, studentUsername, url) {
  // Authorised either as the owning setter, or as the student with a valid token.
  let allowed =
    setter &&
    (await db
      .prepare(
        "SELECT 1 ok FROM setter_students WHERE setter_username=? AND student_username=?"
      )
      .bind(setter.username, studentUsername)
      .first());

  if (!allowed) {
    const student = await db
      .prepare(
        "SELECT username FROM students WHERE username=? AND session_token=? AND session_expires>CURRENT_TIMESTAMP"
      )
      .bind(studentUsername, url.searchParams.get("student_token"))
      .first();
    allowed = !!student;
  }

  if (!allowed) {
    return json({ error: "Not authorised to view this student." }, { status: 403 });
  }

  const student = await db
    .prepare("SELECT username,display_name FROM students WHERE username=?")
    .bind(studentUsername)
    .first();

  const { results = [] } = await db
    .prepare(
      `SELECT sub.homework_id,h.title homework_title,h.topic,
              sub.original_score,sub.mastery_score,sub.total_questions,sub.attempts_json,sub.completed_at
       FROM submissions sub
       JOIN homeworks h ON h.id=sub.homework_id
       WHERE sub.student_username=?
       ORDER BY sub.completed_at DESC`
    )
    .bind(studentUsername)
    .all();

  const avg = key =>
    results.length
      ? Math.round(
          results.reduce((sum, row) => sum + pct(row[key], row.total_questions), 0) /
            results.length
        )
      : 0;

  // Concept-level signal from the understanding model. These tables may be
  // sparse until concept tagging is fully populated, so everything downstream
  // treats an empty result as "not available yet" rather than inventing data.
  const { results: concepts = [] } = await db
    .prepare(
      `SELECT scm.concept_key,
              c.concept_name, c.topic, c.year_group,
              scm.mastery_score, scm.confidence_score, scm.evidence_count
       FROM student_concept_mastery scm
       LEFT JOIN concepts c ON c.concept_key = scm.concept_key
       WHERE scm.student_username = ?
       ORDER BY scm.mastery_score ASC`
    )
    .bind(studentUsername)
    .all()
    .catch(() => ({ results: [] }));

  // Aggregate learning-event signals that DO exist today: hint reliance and
  // recovery-after-retry. misconception_tag is selected defensively; if the
  // column does not exist yet the whole query fails and we fall back to empty.
  const { results: eventAgg = [] } = await db
    .prepare(
      `SELECT
         COUNT(*) total_events,
         SUM(hint_used) hint_events,
         SUM(CASE WHEN first_correct=0 AND mastered=1 THEN 1 ELSE 0 END) recovered_events,
         SUM(CASE WHEN misconception_tag IS NOT NULL AND misconception_tag<>'' THEN 1 ELSE 0 END) tagged_events
       FROM learning_events
       WHERE student_username = ?`
    )
    .bind(studentUsername)
    .all()
    .catch(() => ({ results: [{ total_events: 0, hint_events: 0, recovered_events: 0, tagged_events: 0 }] }));

  // Real misconception tallies — populated only once tagging exists. Empty today.
  const { results: misconceptions = [] } = await db
    .prepare(
      `SELECT misconception_tag, concept_key, COUNT(*) occurrences
       FROM learning_events
       WHERE student_username = ?
         AND misconception_tag IS NOT NULL AND misconception_tag <> ''
       GROUP BY misconception_tag, concept_key
       ORDER BY occurrences DESC`
    )
    .bind(studentUsername)
    .all()
    .catch(() => ({ results: [] }));

  // Topics the child has actually met, weakest-first, from homework scores.
  // Used to key age-typical watch-points to real content (not invented topics).
  // We compute an UNDERSTANDING score per topic that reflects HOW MUCH HELP each
  // question needed — not just whether it was eventually right. The tiered hint
  // ladder exists to capture this: right-first-time-unaided is full understanding;
  // each hint level needed lowers the score; never getting there is zero. This is
  // the granularity a binary "correct/incorrect" throws away.
  //
  // Per-question understanding credit (highest hint level reached, 0–4):
  //   solved with 0 hints -> 1.00   (independent mastery)
  //   solved at hint 1    -> 0.80
  //   solved at hint 2    -> 0.60
  //   solved at hint 3    -> 0.40
  //   solved at hint 4    -> 0.20   (needed walking all the way there)
  //   never solved        -> 0.00
  const HINT_CREDIT = [1.0, 0.8, 0.6, 0.4, 0.2];
  function questionUnderstanding(a){
    const solved = a.first_correct===true || a.first_correct===1 || a.mastered===true || a.mastered===1;
    if(!solved) return 0;
    const lvl = Math.max(0, Math.min(4, Number(a.highest_hint_level)||0));
    // If solved but hint_used is false, treat as level 0 regardless.
    const usedHint = a.hint_used===true || a.hint_used===1;
    return usedHint ? HINT_CREDIT[lvl] : 1.0;
  }

  const topicRollup = {};
  for (const r of results) {
    const t = (r.topic || "General maths").trim();
    if (!topicRollup[t]) topicRollup[t] = { topic: t, attempts: 0, mastery_sum: 0, original_sum: 0, understanding_sum: 0, understanding_n: 0 };
    topicRollup[t].attempts += 1;
    topicRollup[t].mastery_sum += pct(r.mastery_score, r.total_questions);
    topicRollup[t].original_sum += pct(r.original_score, r.total_questions);
    // Parse per-question attempts to get hint-weighted understanding.
    let atts=[];
    try{ atts=JSON.parse(r.attempts_json||"[]"); }catch{ atts=[]; }
    for(const a of atts){
      if(a && a.requires_teacher_review) continue; // not auto-scored
      topicRollup[t].understanding_sum += questionUnderstanding(a);
      topicRollup[t].understanding_n += 1;
    }
  }
  const topics = Object.values(topicRollup)
    .map(t => ({
      topic: t.topic,
      attempts: t.attempts,
      avg_mastery: Math.round(t.mastery_sum / t.attempts),
      avg_original: Math.round(t.original_sum / t.attempts),
      // Understanding as a 0–100 score; falls back to first-attempt score if no
      // per-question hint data is available (older submissions).
      understanding: t.understanding_n
        ? Math.round((t.understanding_sum / t.understanding_n) * 100)
        : Math.round(t.original_sum / t.attempts)
    }))
    // Sort by understanding (ascending) — the truest difficulty signal.
    .sort((a, b) => a.understanding - b.understanding);

  // "Worth practising" reflects genuine difficulty: understanding below full.
  // A child who reached the answer only after several hints scores lower here
  // than one who needed a single nudge — exactly the granularity the hint ladder
  // was built to capture. Threshold at <95 to avoid flagging trivial rounding.
  const weakest = topics.filter(t => t.understanding < 95).slice(0, 3);
  // "Strongest" = high understanding (mostly unaided), never also flagged weak.
  const weakestSet = new Set(weakest.map(t => t.topic));
  const strongest = [...topics].reverse()
    .filter(t => t.understanding >= 95 && !weakestSet.has(t.topic))
    .slice(0, 2);
  // Fallback so a struggling-but-improving student still sees a relative strength.
  if (!strongest.length) {
    const best = [...topics].sort((a,b)=>b.understanding-a.understanding)
      .filter(t => !weakestSet.has(t.topic)).slice(0,1);
    strongest.push(...best);
  }

  const ev = eventAgg[0] || {};
  const report = {
    // Everything here is derived from real stored data. Fields that depend on
    // concept tagging are reported as availability flags so the UI can show an
    // honest "coming once tagging is on" state instead of a fabricated insight.
    has_concept_data: concepts.length > 0,
    has_misconception_tagging: Number(ev.tagged_events || 0) > 0,
    hint_reliance_pct: ev.total_events ? Math.round((100 * (ev.hint_events || 0)) / ev.total_events) : null,
    recovered_after_retry: Number(ev.recovered_events || 0),
    weakest_topics: weakest,
    strongest_topics: strongest,
    weakest_concepts: concepts.slice(0, 4),
    observed_misconceptions: misconceptions
  };

  return json({
    student,
    report,
    summary: {
      homework_count: results.length,
      average_original: avg("original_score"),
      average_mastery: avg("mastery_score")
    },
    results: results.map(row => ({
      ...row,
      original_percent: pct(row.original_score, row.total_questions),
      mastery_percent: pct(row.mastery_score, row.total_questions)
    }))
  });
}

async function classOverview(db, setter) {
  // Pull per-submission detail (not just averaged mastery) so we can compute an
  // UNDERSTANDING score (hint-depth weighted) and GROWTH per student, rather than
  // ranking on the flat mastery number that can't tell independent work from
  // heavily-hinted work.
  const { results: subRows = [] } = await db
    .prepare(
      `SELECT s.username,s.display_name,
              sub.original_score,sub.mastery_score,sub.total_questions,sub.attempts_json
       FROM setter_students ss
       JOIN students s ON s.username=ss.student_username
       LEFT JOIN submissions sub ON sub.student_username=s.username
       WHERE ss.setter_username=?`
    )
    .bind(setter.username)
    .all();

  // Hint-depth understanding credit (same model as the individual report).
  const HINT_CREDIT = [1.0, 0.8, 0.6, 0.4, 0.2];
  const qUnderstanding = (a) => {
    const solved = a && (a.first_correct===true||a.first_correct===1||a.mastered===true||a.mastered===1);
    if(!solved) return 0;
    const usedHint = a.hint_used===true||a.hint_used===1;
    if(!usedHint) return 1.0;
    return HINT_CREDIT[Math.max(0,Math.min(4,Number(a.highest_hint_level)||0))];
  };

  // Aggregate per student.
  const byStudent = {};
  for(const row of subRows){
    const u=row.username;
    if(!byStudent[u]) byStudent[u]={username:u,display_name:row.display_name,completed:0,mastery_sum:0,original_sum:0,u_sum:0,u_n:0};
    const s=byStudent[u];
    if(row.total_questions){ // a real submission (LEFT JOIN can yield a null row)
      s.completed+=1;
      s.mastery_sum+=pct(row.mastery_score,row.total_questions);
      s.original_sum+=pct(row.original_score,row.total_questions);
      let atts=[]; try{ atts=JSON.parse(row.attempts_json||"[]"); }catch{ atts=[]; }
      for(const a of atts){ if(a&&a.requires_teacher_review) continue; s.u_sum+=qUnderstanding(a); s.u_n+=1; }
    }
  }

  const students = Object.values(byStudent).map(s=>{
    const average_mastery = s.completed?Math.round(s.mastery_sum/s.completed):0;
    const average_original = s.completed?Math.round(s.original_sum/s.completed):0;
    const understanding = s.u_n?Math.round((s.u_sum/s.u_n)*100):average_original;
    const growth = Math.max(0, average_mastery - average_original); // improvement after feedback
    return { username:s.username, display_name:s.display_name, completed:s.completed,
             average_mastery, average_original, understanding, growth };
  });

  // Class view, reframed around GROWTH and INDEPENDENCE rather than a bare ability
  // rank. Two orderings the teacher can use as triage — neither is a "who's worst"
  // leaderboard:
  //   most_independent: highest understanding (works things out with least help)
  //   most_improved:    biggest jump from first attempt to mastery
  const most_independent = [...students].filter(s=>s.completed>0)
    .sort((a,b)=> b.understanding - a.understanding || b.average_mastery - a.average_mastery);
  const most_improved = [...students].filter(s=>s.completed>0 && s.growth>0)
    .sort((a,b)=> b.growth - a.growth);

  const { results: students_list = [] } = await db
    .prepare(
      `SELECT s.username,s.display_name,COUNT(sub.id) completed,
              COALESCE(ROUND(AVG(100.0*sub.mastery_score/sub.total_questions)),0) average_mastery
       FROM setter_students ss
       JOIN students s ON s.username=ss.student_username
       LEFT JOIN submissions sub ON sub.student_username=s.username
       WHERE ss.setter_username=?
       GROUP BY s.username`
    )
    .bind(setter.username)
    .all();

  const { results: homeworks = [] } = await db
    .prepare(
      `SELECT h.id,h.title,COUNT(DISTINCT sub.student_username) completed,
              COALESCE(ROUND(AVG(100.0*sub.mastery_score/sub.total_questions)),0) average_mastery
       FROM homeworks h
       LEFT JOIN submissions sub ON sub.homework_id=h.id
       WHERE h.setter_username=?
       GROUP BY h.id
       ORDER BY h.created_at DESC`
    )
    .bind(setter.username)
    .all();

  return json({
    students: students_list,
    homeworks,
    // Reframed class view: independence (understanding) and improvement (growth),
    // not a bare ability ranking.
    most_independent,
    most_improved
  });
}
