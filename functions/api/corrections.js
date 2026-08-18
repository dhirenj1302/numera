// functions/api/corrections.js
// The correction-feedback loop. Two jobs:
//   POST { action:"record", ... }  -> persist a batch of teacher corrections
//                                      from one review session, bump rollups.
//   GET  ?setter_username&token     -> return the teacher's impact rollup +
//                                      recent correction themes (for the loop UI).
//
// Honest design: we only ever count REAL corrections/confirmations the teacher
// actually made. Nothing is inflated. The stored corrections are also what a
// future extraction call reads back as few-shot examples (see extract.js hook).

import { json, clean, validSetter } from "./_lib.js";

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const body = await context.request.json();
    const username = clean(body.setter_username);
    if (!(await validSetter(db, username, body.token))) {
      return json({ error: "Setter session expired. Please sign in again." }, { status: 401 });
    }

    if (body.action !== "record") return json({ error: "Unknown action." }, { status: 400 });

    const corrections = Array.isArray(body.corrections) ? body.corrections : [];
    const questionsReviewed = Number(body.questions_reviewed) || 0;

    // Persist each correction. Kept small and defensive — a failure here must
    // never block publishing, so the caller treats this as best-effort.
    const stmts = [];
    for (const c of corrections.slice(0, 200)) {
      const id = crypto.randomUUID();
      stmts.push(
        db.prepare(
          `INSERT INTO extraction_corrections
             (id, setter_username, homework_id, field, ai_value, teacher_value, question_topic, concept_key)
           VALUES (?,?,?,?,?,?,?,?)`
        ).bind(
          id, username, clean(body.homework_id) || null,
          clean(c.field) || "answer",
          truncate(c.ai_value), truncate(c.teacher_value),
          clean(c.question_topic) || null, clean(c.concept_key) || null
        )
      );
    }
    if (stmts.length) await db.batch(stmts);

    // Bump the rollup counters (cheap reads later).
    await db.prepare(
      `UPDATE setters
         SET corrections_made = corrections_made + ?,
             questions_reviewed = questions_reviewed + ?
       WHERE username = ?`
    ).bind(corrections.length, questionsReviewed, username).run();

    return json({ ok: true, recorded: corrections.length });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const username = clean(url.searchParams.get("setter_username"));
    const token = url.searchParams.get("token");
    if (!(await validSetter(db, username, token))) {
      return json({ error: "Setter session expired." }, { status: 401 });
    }

    const setter = await db.prepare(
      "SELECT corrections_made, questions_reviewed FROM setters WHERE username=?"
    ).bind(username).first();

    // Most common correction themes (what this teacher most often fixes), so the
    // loop can be specific ("you often correct abacus readings") and so we know
    // which examples are worth feeding back into extraction.
    const { results: themes = [] } = await db.prepare(
      `SELECT question_topic, field, COUNT(*) n
         FROM extraction_corrections
        WHERE setter_username = ? AND question_topic IS NOT NULL
        GROUP BY question_topic, field
        ORDER BY n DESC
        LIMIT 5`
    ).bind(username).all();

    return json({
      corrections_made: Number(setter?.corrections_made || 0),
      questions_reviewed: Number(setter?.questions_reviewed || 0),
      themes
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

function truncate(v, n = 300) {
  const s = v == null ? "" : String(v);
  return s.length > n ? s.slice(0, n) : s;
}
