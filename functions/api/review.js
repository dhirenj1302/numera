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
              sub.original_score,sub.mastery_score,sub.total_questions,sub.completed_at
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
  const topicRollup = {};
  for (const r of results) {
    const t = (r.topic || "General maths").trim();
    if (!topicRollup[t]) topicRollup[t] = { topic: t, attempts: 0, mastery_sum: 0 };
    topicRollup[t].attempts += 1;
    topicRollup[t].mastery_sum += pct(r.mastery_score, r.total_questions);
  }
  const topics = Object.values(topicRollup)
    .map(t => ({ topic: t.topic, attempts: t.attempts, avg_mastery: Math.round(t.mastery_sum / t.attempts) }))
    .sort((a, b) => a.avg_mastery - b.avg_mastery);

  // "Worth practising" must reflect a REAL weakness — a topic the student did not
  // fully master (made errors or needed hints). A topic at 100% is never worth
  // practising, even if it's the only topic so far. If nothing is below 100%, the
  // list is empty and the UI shows an encouraging "nothing stands out" state.
  const weakest = topics.filter(t => t.avg_mastery < 100).slice(0, 3);
  // "Strongest" should reflect genuine strength — 100%, or at least strong. Only
  // surface it when there's real data, and never surface the same topic as both
  // strongest and weakest.
  const weakestSet = new Set(weakest.map(t => t.topic));
  const strongest = [...topics].reverse()
    .filter(t => t.avg_mastery >= 80 && !weakestSet.has(t.topic))
    .slice(0, 2);

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
  const { results: students = [] } = await db
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
    students,
    homeworks,
    ranking: [...students].sort((a, b) => b.average_mastery - a.average_mastery)
  });
}
