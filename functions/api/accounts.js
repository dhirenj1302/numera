// functions/api/accounts.js
// Setter (teacher) and student account creation, sign-in, and roster management.
// POST actions: create_setter, login_setter, add_student, login_student
// GET: list the students attached to a signed-in setter.

import { json, clean, hashPin, sessionToken, validSetter } from "./_lib.js";

const USERNAME_RE = /^[a-z0-9][a-z0-9-]{2,23}$/;
const PIN_RE = /^\d{4}$/;
const SESSION_WINDOW = "+30 days";

export async function onRequest(context) {
  const { method } = context.request;
  if (method === "POST") return post(context);
  if (method === "GET") return get(context);
  return json({ error: "Method not allowed" }, { status: 405 });
}

async function post(context) {
  try {
    const body = await context.request.json();
    const db = context.env.DB;
    const action = body.action;
    const username = clean(body.username);

    if (action === "create_setter") {
      return createSetter(db, body, username);
    }
    if (action === "login_setter") {
      return loginSetter(db, body, username);
    }
    if (action === "add_student") {
      return addStudent(db, body);
    }
    if (action === "login_student") {
      return loginStudent(db, body, username);
    }
    return json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}

async function createSetter(db, body, username) {
  if (!USERNAME_RE.test(username) || !PIN_RE.test(body.pin)) {
    return json({ error: "Use a valid username and four-digit PIN." }, { status: 400 });
  }
  const salt = crypto.randomUUID();
  const pinHash = await hashPin(body.pin, salt);
  const token = await sessionToken();

  await db
    .prepare(
      `INSERT INTO setters
        (username,display_name,pin_hash,pin_salt,session_token,session_expires)
       VALUES (?,?,?,?,?,datetime('now',?))`
    )
    .bind(username, String(body.display_name || "").trim(), pinHash, salt, token, SESSION_WINDOW)
    .run();

  return json({ username, display_name: body.display_name, token });
}

async function loginSetter(db, body, username) {
  const row = await db.prepare("SELECT * FROM setters WHERE username=?").bind(username).first();
  if (!row || (await hashPin(body.pin, row.pin_salt)) !== row.pin_hash) {
    return json({ error: "Username or PIN not recognised." }, { status: 401 });
  }
  // Don't invalidate other signed-in sessions on every login. If a valid token
  // already exists, reuse it and just extend the expiry — so signing in on a
  // second tab/device (or re-entering the PIN) doesn't kick out the session that
  // is mid-way through reviewing/publishing a homework. Only mint a fresh token
  // when there isn't a usable one.
  // D1 stores datetimes as "YYYY-MM-DD HH:MM:SS" (UTC); convert to ISO for Date.
  const expiresMs = row.session_expires
    ? new Date(String(row.session_expires).replace(" ", "T") + "Z").getTime()
    : 0;
  const stillValid = !!row.session_token && expiresMs > Date.now();
  const token = stillValid ? row.session_token : await sessionToken();
  await db
    .prepare("UPDATE setters SET session_token=?,session_expires=datetime('now',?) WHERE username=?")
    .bind(token, SESSION_WINDOW, username)
    .run();

  return json({ username, display_name: row.display_name, token });
}

async function addStudent(db, body) {
  const setter = await validSetter(db, body.setter_username, body.token);
  if (!setter) return json({ error: "Setter session expired." }, { status: 401 });

  const studentUsername = clean(body.student_username);
  if (!USERNAME_RE.test(studentUsername) || !PIN_RE.test(body.pin)) {
    return json({ error: "Use a valid student username and four-digit PIN." }, { status: 400 });
  }

  const salt = crypto.randomUUID();
  const pinHash = await hashPin(body.pin, salt);

  // Batch keeps the student upsert and the setter-student link atomic.
  await db.batch([
    db
      .prepare(
        `INSERT INTO students (username,display_name,pin_hash,pin_salt)
         VALUES (?,?,?,?)
         ON CONFLICT(username) DO UPDATE SET
           display_name=excluded.display_name,
           pin_hash=excluded.pin_hash,
           pin_salt=excluded.pin_salt`
      )
      .bind(studentUsername, String(body.display_name || "").trim(), pinHash, salt),
    db
      .prepare(
        "INSERT OR IGNORE INTO setter_students (setter_username,student_username) VALUES (?,?)"
      )
      .bind(setter.username, studentUsername)
  ]);

  return json({ saved: true });
}

async function loginStudent(db, body, username) {
  const row = await db.prepare("SELECT * FROM students WHERE username=?").bind(username).first();
  if (!row || !row.pin_hash || (await hashPin(body.pin, row.pin_salt)) !== row.pin_hash) {
    return json({ error: "Username or PIN not recognised." }, { status: 401 });
  }
  const token = await sessionToken();
  await db
    .prepare("UPDATE students SET session_token=?,session_expires=datetime('now',?) WHERE username=?")
    .bind(token, SESSION_WINDOW, username)
    .run();

  return json({ username, display_name: row.display_name, token });
}

async function get(context) {
  try {
    const url = new URL(context.request.url);
    const db = context.env.DB;
    const setter = await validSetter(
      db,
      url.searchParams.get("setter_username"),
      url.searchParams.get("token")
    );
    if (!setter) return json({ error: "Setter session expired." }, { status: 401 });

    const { results = [] } = await db
      .prepare(
        `SELECT s.username,s.display_name,COUNT(sub.id) submission_count
         FROM setter_students ss
         JOIN students s ON s.username=ss.student_username
         LEFT JOIN submissions sub ON sub.student_username=s.username
         WHERE ss.setter_username=?
         GROUP BY s.username
         ORDER BY s.display_name`
      )
      .bind(setter.username)
      .all();

    return json({ setter, students: results });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
