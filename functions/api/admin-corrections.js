// functions/api/admin-corrections.js
// OWNER-ONLY view of correction patterns across ALL teachers. This is the piece
// that closes the loop for the platform owner: it turns individual teacher
// corrections into product intelligence, so the owner can decide which recurring
// corrections warrant a systemic fix to the extraction prompt.
//
// IMPORTANT: this exposes data across all teachers, so it is gated by an
// OWNER_KEY environment secret (set in Cloudflare, like OPENAI_API_KEY). Without
// a correct key the endpoint returns 401. No owner key configured => disabled.
//
// It is READ-ONLY. It never changes extraction for anyone. The owner remains the
// human in the loop who decides what (if anything) becomes a global change.

import { json } from "./_lib.js";

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const configured = context.env.OWNER_KEY;
    const url = new URL(context.request.url);
    const provided = url.searchParams.get("key") || context.request.headers.get("x-owner-key") || "";

    if (!configured) {
      return json({ error: "Owner dashboard is not enabled. Set OWNER_KEY in the environment to use it." }, { status: 503 });
    }
    // Constant-ish comparison; keys are short and this is not a high-frequency path.
    if (provided !== configured) {
      return json({ error: "Not authorised." }, { status: 401 });
    }

    // Top correction themes across all teachers: which topic + field gets
    // corrected most, with a couple of representative before/after examples so
    // the owner can judge whether it's a systemic reader weakness or a one-off.
    const { results: themes = [] } = await db.prepare(
      `SELECT question_topic, field, COUNT(*) n
         FROM extraction_corrections
        WHERE question_topic IS NOT NULL AND question_topic <> ''
        GROUP BY question_topic, field
        ORDER BY n DESC
        LIMIT 25`
    ).all();

    // Field-level totals (answer vs type vs prompt) — a quick read on WHERE the
    // reader is weakest overall.
    const { results: byField = [] } = await db.prepare(
      `SELECT field, COUNT(*) n
         FROM extraction_corrections
        GROUP BY field
        ORDER BY n DESC`
    ).all();

    // A sample of recent concrete corrections (before -> after) for inspection.
    const { results: recent = [] } = await db.prepare(
      `SELECT setter_username, field, ai_value, teacher_value, question_topic, created_at
         FROM extraction_corrections
        ORDER BY created_at DESC
        LIMIT 40`
    ).all();

    // Headline totals.
    const totalsRow = await db.prepare(
      `SELECT COUNT(*) total_corrections,
              COUNT(DISTINCT setter_username) teachers_correcting
         FROM extraction_corrections`
    ).first();

    const reviewedRow = await db.prepare(
      `SELECT COALESCE(SUM(questions_reviewed),0) total_reviewed,
              COALESCE(SUM(corrections_made),0) total_corrections_rollup
         FROM setters`
    ).first();

    return json({
      totals: {
        total_corrections: Number(totalsRow?.total_corrections || 0),
        teachers_correcting: Number(totalsRow?.teachers_correcting || 0),
        total_questions_reviewed: Number(reviewedRow?.total_reviewed || 0)
      },
      by_field: byField,
      themes,
      recent
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
