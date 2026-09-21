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

    // A school = the domain of a teacher's email (everyone @gardenhouseschool.co.uk
    // is one school). SQLite has no split, so we derive the domain with substr.
    const DOMAIN = "lower(substr(email, instr(email,'@')+1))";
    const NOT_DEMO_H = "(h.settings_json NOT LIKE '%\"demo\":true%')";

    // MODE: list of schools with headline counts (for the picker).
    if (url.searchParams.get("schools") === "list") {
      const { results = [] } = await db.prepare(`
        SELECT ${DOMAIN} domain, COUNT(*) teachers,
          MIN(created_at) first_signup
        FROM setters
        WHERE email IS NOT NULL AND email <> '' AND instr(email,'@') > 0
        GROUP BY ${DOMAIN}
        ORDER BY teachers DESC, first_signup ASC
      `).all().catch(() => ({ results: [] }));
      return json({ schools: results.map(r => ({ domain: r.domain, teachers: Number(r.teachers||0), first_signup: r.first_signup })) });
    }

    // MODE: full report for one school (by email domain).
    const school = (url.searchParams.get("school") || "").trim().toLowerCase();
    if (school) {
      return json(await schoolReport(db, school, { one, DOMAIN, NOT_DEMO_H }));
    }

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

    // Per-teacher list with activity, newest signups first (cap 200). Last-active
    // = the most recent of (their newest real homework, their newest submission
    // received). Homeworks counted exclude demos.
    const { results: teacherRows = [] } = await db.prepare(`
      SELECT s.username, s.display_name, s.email, s.created_at,
        (SELECT COUNT(*) FROM homeworks h
           WHERE h.setter_username = s.username AND (h.settings_json NOT LIKE '%"demo":true%')) hw_count,
        (SELECT MAX(x) FROM (
           SELECT MAX(h.created_at) x FROM homeworks h
             WHERE h.setter_username = s.username AND (h.settings_json NOT LIKE '%"demo":true%')
           UNION ALL
           SELECT MAX(sub.completed_at) x FROM submissions sub
             JOIN homeworks h2 ON h2.id = sub.homework_id
             WHERE h2.setter_username = s.username
        )) last_active
      FROM setters s
      ORDER BY s.created_at DESC
      LIMIT 200
    `).all().catch(() => ({ results: [] }));

    const teacher_list = teacherRows.map(r => ({
      username: r.username,
      name: r.display_name || "",
      email: r.email || "",
      signed_up: r.created_at,
      homeworks: Number(r.hw_count || 0),
      last_active: r.last_active || null,
    }));

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
      teacher_list,
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

// Per-school report grouped by teacher email domain. Funnel (adoption →
// activation), reach (pupils), and impact (marking, time saved, learning lift,
// insights). Everything is scoped to teachers whose email domain matches `school`
// and, via setter_students / homeworks, to that school's pupils and work.
// Time-saved figures are ESTIMATES and labelled as such on the report.
async function schoolReport(db, school, { one, DOMAIN, NOT_DEMO_H }) {
  const D = DOMAIN; // teacher-domain expression on the `setters` alias `email`
  const scope = `email IS NOT NULL AND ${D} = ?`;

  // --- Adoption ---
  const teachers = await one(`SELECT COUNT(*) FROM setters WHERE ${scope}`, school);
  const teachers_with_class = await one(`
    SELECT COUNT(DISTINCT ss.setter_username)
    FROM setter_students ss
    JOIN setters s ON s.username = ss.setter_username
    WHERE s.email IS NOT NULL AND lower(substr(s.email, instr(s.email,'@')+1)) = ?`, school);
  const pupils = await one(`
    SELECT COUNT(DISTINCT ss.student_username)
    FROM setter_students ss
    JOIN setters s ON s.username = ss.setter_username
    WHERE lower(substr(s.email, instr(s.email,'@')+1)) = ?`, school);

  // Helper: homeworks belonging to this school's teachers (non-demo).
  const HW_SCOPE = `
    FROM homeworks h
    JOIN setters s ON s.username = h.setter_username
    WHERE ${NOT_DEMO_H} AND s.email IS NOT NULL
      AND lower(substr(s.email, instr(s.email,'@')+1)) = ?`;

  // --- Activation ---
  const teachers_set_hw = await one(`SELECT COUNT(DISTINCT h.setter_username) ${HW_SCOPE}`, school);
  const homeworks = await one(`SELECT COUNT(*) ${HW_SCOPE}`, school);
  const teachers_repeat = await one(`
    SELECT COUNT(*) FROM (
      SELECT h.setter_username ${HW_SCOPE} GROUP BY h.setter_username HAVING COUNT(*) >= 2)`, school);
  const span = await db.prepare(`
    SELECT MIN(h.created_at) first_hw, MAX(h.created_at) last_hw ${HW_SCOPE}`).bind(school).first().catch(() => null);

  // --- Reach (pupils + submissions on this school's homeworks) ---
  const SUB_SCOPE = `
    FROM submissions sub
    JOIN homeworks h ON h.id = sub.homework_id
    JOIN setters s ON s.username = h.setter_username
    WHERE ${NOT_DEMO_H} AND s.email IS NOT NULL
      AND lower(substr(s.email, instr(s.email,'@')+1)) = ?`;
  const submissions = await one(`SELECT COUNT(*) ${SUB_SCOPE}`, school);
  const pupils_active = await one(`SELECT COUNT(DISTINCT sub.student_username) ${SUB_SCOPE}`, school);
  const homeworks_completed = await one(`
    SELECT COUNT(DISTINCT sub.homework_id) ${SUB_SCOPE}`, school);

  // --- Impact ---
  const questions_marked = await one(`SELECT COALESCE(SUM(sub.total_questions),0) ${SUB_SCOPE}`, school);
  const avg_original = await one(`
    SELECT ROUND(AVG(100.0*sub.original_score/NULLIF(sub.total_questions,0))) ${SUB_SCOPE}`, school);
  const avg_mastery = await one(`
    SELECT ROUND(AVG(100.0*sub.mastery_score/NULLIF(sub.total_questions,0))) ${SUB_SCOPE}`, school);
  // Specific misconceptions surfaced for this school's pupils.
  const misconceptions_surfaced = await one(`
    SELECT COUNT(DISTINCT le.misconception_tag)
    FROM learning_events le
    JOIN homeworks h ON h.id = le.homework_id
    JOIN setters s ON s.username = h.setter_username
    WHERE le.misconception_tag IS NOT NULL AND le.misconception_tag <> ''
      AND ${NOT_DEMO_H} AND s.email IS NOT NULL
      AND lower(substr(s.email, instr(s.email,'@')+1)) = ?`, school).catch(() => 0);
  const misconception_instances = await one(`
    SELECT COUNT(*)
    FROM learning_events le
    JOIN homeworks h ON h.id = le.homework_id
    JOIN setters s ON s.username = h.setter_username
    WHERE le.misconception_tag IS NOT NULL AND le.misconception_tag <> ''
      AND ${NOT_DEMO_H} AND s.email IS NOT NULL
      AND lower(substr(s.email, instr(s.email,'@')+1)) = ?`, school).catch(() => 0);

  // Estimated teacher time saved from auto-marking. Deliberately conservative:
  // ~15 seconds of marking per question answered. Shown as an estimate.
  const minutes_saved = Math.round((Number(questions_marked) * 15) / 60);

  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const lift = (avg_mastery != null && avg_original != null) ? (avg_mastery - avg_original) : null;

  return {
    school,
    generated_at: new Date().toISOString(),
    funnel: {
      teachers,
      teachers_with_class,
      teachers_set_hw,
      teachers_repeat,
      teachers_repeat_pct: pct(teachers_repeat, teachers_set_hw),
    },
    usage: {
      classes_pupils: pupils,
      homeworks,
      first_homework: span ? span.first_hw : null,
      last_homework: span ? span.last_hw : null,
    },
    reach: {
      pupils_active,
      pupils_active_pct: pct(pupils_active, pupils),
      submissions,
      homeworks_completed,
      completion_pct: pct(homeworks_completed, homeworks),
    },
    impact: {
      questions_marked: Number(questions_marked),
      est_hours_saved: Math.round(minutes_saved / 60 * 10) / 10,
      est_minutes_saved: minutes_saved,
      avg_first_try_pct: avg_original,
      avg_after_mastery_pct: avg_mastery,
      learning_lift_pts: lift,
      misconceptions_surfaced: Number(misconceptions_surfaced),
      misconception_instances: Number(misconception_instances),
    },
  };
}
