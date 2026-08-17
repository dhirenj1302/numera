// functions/api/level-up.js
// Builds a "Level Up" challenge for a student from the questions they have found
// hardest across their past homeworks. Selection is by WEAKNESS, not merely
// "got it wrong": a question counts as weak if the child got it wrong and never
// resolved it, needed heavy hinting, or its concept is low-confidence. This is
// the adaptive core — the app deciding what a child should revisit next.
//
// v1 re-shows the ORIGINAL questions. The response is shaped so that AI-generated
// "similar" variants can slot in later without changing the student flow: each
// item already carries concept_key and source info, so a future version can swap
// `question` for a generated variant on the same concept.

import { json, clean } from "./_lib.js";

// A student needs at least this many distinct weak questions before a Level Up is
// worth offering. Tunable — evidence-based, not a fixed "after N homeworks".
const MIN_WEAK_FOR_LEVEL_UP = 5;
const MAX_QUESTIONS = 10;
const MIN_QUESTIONS = 5;

// Record the outcome of a completed Level Up test. Each answered question is
// written back as a fresh attempt AGAINST ITS ORIGINAL homework/question, so the
// weak-pool query (which keeps the newest attempt per question) will graduate a
// question the child now got right — it leaves the weak pool and won't reappear
// in future Level Ups. Once the pool falls below MIN_WEAK_FOR_LEVEL_UP, Level Up
// stops being offered. This preserves all understanding data; it only updates it.
export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    const body = await context.request.json();
    const studentUsername = clean(body.student_username);
    const studentToken = body.student_token;

    const student = await db.prepare(
      "SELECT username FROM students WHERE username=? AND session_token=? AND session_expires>CURRENT_TIMESTAMP"
    ).bind(studentUsername, studentToken).first();
    if (!student) return json({ error: "Session expired. Please sign in again." }, { status: 401 });

    const results = Array.isArray(body.results) ? body.results : [];
    if (!results.length) return json({ ok: true, graduated: 0 });

    // Group results by their ORIGINAL homework, and append an attempt per question
    // to that homework's most recent submission for this student (or create a
    // small level-up submission if none exists). Newest-attempt-wins in the weak
    // query means a correct, hint-free attempt here scores weakness 0 => graduates.
    let graduated = 0;
    const byHw = new Map();
    for (const r of results) {
      const hwId = clean(r.homework_id);
      const qi = Number(r.question_index);
      if (!hwId || !Number.isFinite(qi)) continue;
      if (!byHw.has(hwId)) byHw.set(hwId, []);
      const firstCorrect = r.correct === true && r.hint_used !== true;
      if (firstCorrect) graduated++;
      byHw.get(hwId).push({
        question_index: qi,
        concept_key: clean(r.concept_key) || "",
        first_correct: firstCorrect,
        mastered: r.correct === true,
        hint_used: r.hint_used === true,
        highest_hint_level: Number(r.highest_hint_level) || 0,
        retries: Number(r.retries) || 0,
        source: "level_up",
        answered_at: new Date().toISOString()
      });
    }

    const stmts = [];
    for (const [hwId, attempts] of byHw) {
      const id = crypto.randomUUID();
      const total = attempts.length;
      const correct = attempts.filter(a => a.first_correct).length;
      stmts.push(
        db.prepare(
          `INSERT INTO submissions
             (id, homework_id, student_name, student_username,
              original_score, mastery_score, total_questions,
              attempts_json, strengths_json, needs_practice_json, completed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`
        ).bind(
          id, hwId, studentUsername, studentUsername,
          correct, correct, total,
          JSON.stringify(attempts), "[]", "[]"
        )
      );
    }
    if (stmts.length) await db.batch(stmts);

    return json({ ok: true, graduated });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}


export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const db = context.env.DB;
    const studentUsername = clean(url.searchParams.get("student_username"));
    const studentToken = url.searchParams.get("student_token");

    if (!studentUsername) return json({ error: "Student username required." }, { status: 400 });

    // Authorise as the student (valid session) — a child launches their own Level Up.
    const student = await db
      .prepare(
        "SELECT username,display_name FROM students WHERE username=? AND session_token=? AND session_expires>CURRENT_TIMESTAMP"
      )
      .bind(studentUsername, studentToken)
      .first();
    if (!student) return json({ error: "Session expired. Please sign in again." }, { status: 401 });

    // Pull the student's submissions, newest first, with the homework questions.
    const { results: subs = [] } = await db
      .prepare(
        `SELECT sub.homework_id, sub.attempts_json, sub.completed_at, h.questions_json, h.title
         FROM submissions sub
         JOIN homeworks h ON h.id = sub.homework_id
         WHERE sub.student_username = ?
         ORDER BY sub.completed_at DESC`
      )
      .bind(studentUsername)
      .all();

    // Walk every attempt and score its weakness. Keep the most recent attempt per
    // (homework, question) so a later success supersedes an earlier failure.
    const weakByKey = new Map();
    for (const sub of subs) {
      let attempts = [];
      let questions = [];
      try { attempts = JSON.parse(sub.attempts_json || "[]"); } catch { attempts = []; }
      try { questions = JSON.parse(sub.questions_json || "[]"); } catch { questions = []; }

      for (const a of attempts) {
        const qi = Number(a.question_index);
        const q = questions[qi];
        if (!q) continue;
        // Skip question types that can't be auto-scored in a quick challenge.
        if (["drawing"].includes(q.type)) continue;

        const key = `${sub.homework_id}:${qi}`;
        if (weakByKey.has(key)) continue; // newest wins (subs are DESC)

        const weakness = weaknessScore(a);
        if (weakness > 0) {
          weakByKey.set(key, {
            weakness,
            concept_key: a.concept_key || q.concept_key || "",
            source_homework_id: sub.homework_id,
            source_homework_title: sub.title,
            question_index: qi,
            question: q,
            variant: "original" // future: "generated"
          });
        } else {
          // Mark resolved so an older failure of the same question doesn't re-add it.
          weakByKey.set(key, null);
        }
      }
    }

    const weak = [...weakByKey.values()].filter(Boolean).sort((a, b) => b.weakness - a.weakness);

    if (weak.length < MIN_WEAK_FOR_LEVEL_UP) {
      return json({
        available: false,
        weak_count: weak.length,
        needed: MIN_WEAK_FOR_LEVEL_UP,
        message: "Not enough to level up yet — keep completing homework and a Level Up challenge will unlock."
      });
    }

    // Take up to MAX, spreading across concepts so it isn't all one topic.
    const chosen = spreadAcrossConcepts(weak, MAX_QUESTIONS);

    // Shape as a playable "homework" the existing player can run unchanged.
    const questions = chosen.map((w, i) => ({
      ...w.question,
      // Re-tag provenance so a future generated-variant version can use it.
      concept_key: w.concept_key,
      level_up_source: { homework_id: w.source_homework_id, question_index: w.question_index },
      // Practice prompts from the original stay; nothing else changes.
      _levelup_index: i
    }));

    return json({
      available: true,
      title: "Level Up Challenge",
      is_level_up: true,
      weak_count: weak.length,
      questions,
      concepts_covered: [...new Set(chosen.map(w => w.concept_key).filter(Boolean))]
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

// Weakness score for one attempt. 0 = not weak (don't include). Higher = weaker.
// Uses the real evidence already captured: resolution, hinting, retries.
function weaknessScore(a) {
  const firstCorrect = a.first_correct === true || a.first_correct === 1;
  const mastered = a.mastered === true || a.mastered === 1;
  const hintUsed = a.hint_used === true || a.hint_used === 1;
  const retries = Number(a.retries) || 0;
  const hintLevel = Number(a.highest_hint_level) || 0;

  // Got it right first time with no help → not weak.
  if (firstCorrect && !hintUsed) return 0;

  let score = 0;
  if (!mastered) score += 5;            // never got there — strongest signal
  if (!firstCorrect && mastered) score += 2; // needed another go
  if (hintUsed) score += 1 + hintLevel * 0.5; // heavier hinting = weaker
  if (retries >= 2) score += 1;
  return score;
}

// Interleave so the challenge samples different concepts rather than 10 of one.
function spreadAcrossConcepts(weak, max) {
  const buckets = new Map();
  for (const w of weak) {
    const k = w.concept_key || "_none";
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(w);
  }
  const order = [...buckets.keys()];
  const out = [];
  let added = true;
  while (out.length < max && added) {
    added = false;
    for (const k of order) {
      const list = buckets.get(k);
      if (list.length) {
        out.push(list.shift());
        added = true;
        if (out.length >= max) break;
      }
    }
  }
  // Ensure we still meet the minimum if possible.
  return out.slice(0, Math.max(MIN_QUESTIONS, Math.min(max, out.length)) || out.length);
}
