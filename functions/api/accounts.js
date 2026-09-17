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
    if (action === "bulk_add_students") {
      return bulkAddStudents(db, body);
    }
    if (action === "login_student") {
      return loginStudent(db, body, username);
    }
    if (action === "request_reset") {
      return requestReset(context, db, body);
    }
    if (action === "reset_pin") {
      return resetPin(db, body);
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
  // Email is required at signup so the account can be recovered if the login is
  // forgotten. Validate gently — just that it looks like an address — to avoid
  // rejecting valid-but-unusual real addresses.
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: "Enter a valid email address so you can recover your login later." }, { status: 400 });
  }
  const salt = crypto.randomUUID();
  const pinHash = await hashPin(body.pin, salt);
  const token = await sessionToken();

  await db
    .prepare(
      `INSERT INTO setters
        (username,display_name,email,pin_hash,pin_salt,session_token,session_expires)
       VALUES (?,?,?,?,?,?,datetime('now',?))`
    )
    .bind(username, String(body.display_name || "").trim(), email, pinHash, salt, token, SESSION_WINDOW)
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

// "Forgot your login?" — the teacher submits their email. If an account has that
// email, we generate a one-time, time-limited reset token, store it, and email
// the teacher their USERNAME plus a link to set a new PIN. The PIN itself is
// hashed and cannot be revealed, so recovery resets it.
//
// SECURITY: the response is IDENTICAL whether or not the email exists, so this
// can't be used to discover which emails have accounts (no user enumeration).
const RESET_WINDOW = "+1 hour";

async function requestReset(context, db, body) {
  const email = String(body.email || "").trim().toLowerCase();
  // Always return the same neutral response, regardless of outcome.
  const neutral = json({ ok: true });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return neutral;

  const row = await db.prepare("SELECT username,display_name FROM setters WHERE email=?").bind(email).first();
  if (!row) return neutral; // unknown email — say nothing revealing

  // Generate and store a one-time reset token.
  const token = await sessionToken();
  await db
    .prepare("UPDATE setters SET reset_token=?,reset_expires=datetime('now',?) WHERE username=?")
    .bind(token, RESET_WINDOW, row.username)
    .run();

  // Email the teacher their username + reset link (best-effort via Resend).
  const apiKey = context.env.RESEND_API_KEY;
  if (apiKey) {
    const origin = new URL(context.request.url).origin;
    const link = `${origin}/#/teacher-reset?token=${encodeURIComponent(token)}`;
    const from = "Verve Maths <noreply@vervemaths.com>";
    const subject = "Your Verve Maths login details";
    const text =
      `Hello${row.display_name ? " " + row.display_name : ""},\n\n` +
      `You asked to recover your Verve Maths teacher login.\n\n` +
      `Your username is: ${row.username}\n\n` +
      `To set a new PIN, open this link (valid for 1 hour):\n${link}\n\n` +
      `If you didn't request this, you can ignore this email — your login is unchanged.\n`;
    const html =
      `<p>Hello${row.display_name ? " " + escapeHtmlLocal(row.display_name) : ""},</p>` +
      `<p>You asked to recover your Verve Maths teacher login.</p>` +
      `<p>Your username is: <strong>${escapeHtmlLocal(row.username)}</strong></p>` +
      `<p>To set a new PIN, open this link (valid for 1 hour):<br>` +
      `<a href="${link}">Set a new PIN</a></p>` +
      `<p>If you didn't request this, you can ignore this email — your login is unchanged.</p>`;
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [email], subject, text, html })
      });
    } catch (mailError) {
      // Swallow — never reveal delivery success/failure to the caller.
    }
  }
  return neutral;
}

function escapeHtmlLocal(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Complete a reset: validate the token, set the new PIN, clear the token, and
// sign the teacher in (return a fresh session) so they land straight in.
async function resetPin(db, body) {
  const token = String(body.token || "").trim();
  const newPin = String(body.pin || "").trim();
  if (!token || !PIN_RE.test(newPin)) {
    return json({ error: "Enter a new four-digit PIN." }, { status: 400 });
  }
  const row = await db
    .prepare("SELECT * FROM setters WHERE reset_token=? AND reset_expires>CURRENT_TIMESTAMP")
    .bind(token)
    .first();
  if (!row) {
    return json({ error: "This reset link has expired or already been used. Please request a new one." }, { status: 400 });
  }
  const salt = crypto.randomUUID();
  const pinHash = await hashPin(newPin, salt);
  const sessionTok = await sessionToken();
  await db
    .prepare(
      "UPDATE setters SET pin_hash=?,pin_salt=?,reset_token=NULL,reset_expires=NULL,session_token=?,session_expires=datetime('now',?) WHERE username=?"
    )
    .bind(pinHash, salt, sessionTok, SESSION_WINDOW, row.username)
    .run();
  return json({ username: row.username, display_name: row.display_name, token: sessionTok });
}

// Create many students at once from a teacher-generated class list. Each entry is
// { username, pin, display_name }. Usernames are generated client-side to be
// unique and typeable; we still validate each and upsert atomically, and link
// every one to this setter. Returns which succeeded so the client can show/download
// the final list. Capped to a sensible class size.
async function bulkAddStudents(db, body) {
  const setter = await validSetter(db, body.setter_username, body.token);
  if (!setter) return json({ error: "Setter session expired." }, { status: 401 });

  const list = Array.isArray(body.students) ? body.students.slice(0, 60) : [];
  if (!list.length) return json({ error: "No students to add." }, { status: 400 });

  const created = [];
  const statements = [];
  for (const s of list) {
    const username = clean(s.username);
    const pin = String(s.pin || "").trim();
    if (!USERNAME_RE.test(username) || !PIN_RE.test(pin)) continue; // skip malformed rows
    const salt = crypto.randomUUID();
    const pinHash = await hashPin(pin, salt);
    statements.push(
      db.prepare(
        `INSERT INTO students (username,display_name,pin_hash,pin_salt)
         VALUES (?,?,?,?)
         ON CONFLICT(username) DO UPDATE SET
           display_name=excluded.display_name,
           pin_hash=excluded.pin_hash,
           pin_salt=excluded.pin_salt`
      ).bind(username, String(s.display_name || "").trim(), pinHash, salt)
    );
    statements.push(
      db.prepare(
        "INSERT OR IGNORE INTO setter_students (setter_username,student_username) VALUES (?,?)"
      ).bind(setter.username, username)
    );
    created.push({ username, display_name: String(s.display_name || "").trim() });
  }
  if (!statements.length) return json({ error: "No valid students to add." }, { status: 400 });
  await db.batch(statements);
  return json({ ok: true, created });
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
