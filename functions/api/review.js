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

  return json({
    student,
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
