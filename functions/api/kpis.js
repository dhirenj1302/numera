// functions/api/kpis.js
// OWNER-ONLY business KPI dashboard. Read-only aggregate counts across the whole
// platform, for the owner to judge pilot health. Gated by the same OWNER_KEY
// secret as the admin-corrections view. No owner key configured => disabled.
//
// All KPIs are derived from existing tables (setters, students, setter_students,
// homeworks, submissions) — no new tracking. Demo homeworks (settings_json has
// "demo":true) are excluded from "homeworks set" so the numbers reflect real use.

import { json } from "./_lib.js";

// A homework counts as "real" (not a demo) when its settings don't mark it demo.
// SQLite has no JSON1 guarantee on all D1 builds, so we match on the raw text —
// demo homeworks are written with the literal "demo":true.
const NOT_DEMO = "(settings_json NOT LIKE '%\"demo\":true%')";

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const configured = context.env.OWNER_KEY;
    const url = new URL(context.request.url);
    const provided = url.searchParams.get("key") || context.request.headers.get("x-owner-key") || "";

    if (!configured) {
      return json({ error: "KPI dashboard is not enabled. Set OWNER_KEY in the environment to use it." }, { status: 503 });
    }
    if (provided !== configured) {
      return json({ error: "Not authorised." }, { status: 401 });
    }

    const one = async (sql, ...binds) => {
      const row = await db.prepare(sql).bind(...binds).first();
      return row ? (Object.values(row)[0] ?? 0) : 0;
    };

    // --- Teachers ---
    const teachers_total = await one("SELECT COUNT(*) FROM setters");
    const teachers_new_7d = await one(
      "SELECT COUNT(*) FROM setters WHERE created_at >= datetime('now','-7 days')");
    // Active = set a real homework OR received a submission in the last 7 days.
    const teachers_active_7d = await one(`
      SELECT COUNT(DISTINCT u) FROM (
        SELECT setter_username u FROM homeworks
          WHERE ${NOT_DEMO} AND created_at >= datetime('now','-7 days') AND setter_username IS NOT NULL
        UNION
        SELECT h.setter_username u FROM submissions s
          JOIN homeworks h ON h.id = s.homework_id
          WHERE h.setter_username IS NOT NULL AND s.completed_at >= datetime('now','-7 days')
      )`);

    // --- Students ---
    const students_total = await one("SELECT COUNT(*) FROM students");
    const students_active = await one(
      "SELECT COUNT(DISTINCT student_username) FROM submissions WHERE student_username IS NOT NULL AND student_username <> ''");

    // --- Homeworks (real, non-demo) ---
    const homeworks_total = await one(`SELECT COUNT(*) FROM homeworks WHERE ${NOT_DEMO}`);
    const homeworks_7d = await one(
      `SELECT COUNT(*) FROM homeworks WHERE ${NOT_DEMO} AND created_at >= datetime('now','-7 days')`);
    const homeworks_with_setter = await one(
      `SELECT COUNT(*) FROM homeworks WHERE ${NOT_DEMO} AND setter_username IS NOT NULL`);
    // Homeworks that got at least one submission.
    const homeworks_completed = await one(`
      SELECT COUNT(*) FROM homeworks h
      WHERE (h.settings_json NOT LIKE '%"demo":true%')
        AND EXISTS (SELECT 1 FROM submissions s WHERE s.homework_id = h.id)`);

    // --- Submissions & scores ---
    const submissions_total = await one("SELECT COUNT(*) FROM submissions");
    const submissions_7d = await one(
      "SELECT COUNT(*) FROM submissions WHERE completed_at >= datetime('now','-7 days')");
    const avg_original = await one(
      "SELECT ROUND(AVG(100.0*original_score/NULLIF(total_questions,0))) FROM submissions");
    const avg_mastery = await one(
      "SELECT ROUND(AVG(100.0*mastery_score/NULLIF(total_questions,0))) FROM submissions");

    // --- Retention: teachers who set a 2nd / 3rd real homework ---
    const teachers_with_hw = await one(`
      SELECT COUNT(*) FROM (
        SELECT setter_username FROM homeworks
        WHERE ${NOT_DEMO} AND setter_username IS NOT NULL
        GROUP BY setter_username)`);
    const teachers_2plus = await one(`
      SELECT COUNT(*) FROM (
        SELECT setter_username FROM homeworks
        WHERE ${NOT_DEMO} AND setter_username IS NOT NULL
        GROUP BY setter_username HAVING COUNT(*) >= 2)`);
    const teachers_3plus = await one(`
      SELECT COUNT(*) FROM (
        SELECT setter_username FROM homeworks
        WHERE ${NOT_DEMO} AND setter_username IS NOT NULL
        GROUP BY setter_username HAVING COUNT(*) >= 3)`);

    // Median days from a teacher's 1st to 2nd real homework (approx via avg).
    const avg_days_to_second = await one(`
      SELECT ROUND(AVG(gap_days),1) FROM (
        SELECT setter_username,
          (julianday(MIN(CASE WHEN rn=2 THEN created_at END)) -
           julianday(MIN(CASE WHEN rn=1 THEN created_at END))) gap_days
        FROM (
          SELECT setter_username, created_at,
            ROW_NUMBER() OVER (PARTITION BY setter_username ORDER BY created_at) rn
          FROM homeworks WHERE ${NOT_DEMO} AND setter_username IS NOT NULL
        )
        WHERE rn <= 2
        GROUP BY setter_username
        HAVING COUNT(*) >= 2)`);

    const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

    return json({
      generated_at: new Date().toISOString(),
      teachers: {
        total: teachers_total,
        new_7d: teachers_new_7d,
        active_7d: teachers_active_7d,
        set_homework: teachers_with_hw,
        repeat_2plus: teachers_2plus,
        repeat_3plus: teachers_3plus,
        repeat_2plus_pct: pct(teachers_2plus, teachers_with_hw),
        repeat_3plus_pct: pct(teachers_3plus, teachers_with_hw),
        avg_days_to_second: avg_days_to_second,
      },
      students: {
        total: students_total,
        active: students_active,
        active_pct: pct(students_active, students_total),
      },
      homeworks: {
        total: homeworks_total,
        last_7d: homeworks_7d,
        completed: homeworks_completed,
        completion_pct: pct(homeworks_completed, homeworks_total),
        per_active_teacher: teachers_with_hw ? Math.round((10 * homeworks_with_setter) / teachers_with_hw) / 10 : 0,
      },
      submissions: {
        total: submissions_total,
        last_7d: submissions_7d,
        avg_original_pct: avg_original,
        avg_mastery_pct: avg_mastery,
      },
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
