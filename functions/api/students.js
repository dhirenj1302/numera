// functions/api/students.js
// Student sign-in for a specific homework. Confirms the PIN and that the
// student is attached to the setter who set the homework.

import { json, clean, hashPin, withDbRetry, isTransientDbError } from "./_lib.js";

const SESSION_WINDOW = "+30 days";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const username = clean(body.username);
    const db = context.env.DB;

    const student = await withDbRetry(() => db
      .prepare("SELECT * FROM students WHERE username=?")
      .bind(username)
      .first());
    if (!student) {
      return json(
        { error: "This student username has not been created by a setter." },
        { status: 404 }
      );
    }

    if (!student.pin_hash || (await hashPin(body.pin, student.pin_salt)) !== student.pin_hash) {
      return json({ error: "Student PIN not recognised." }, { status: 401 });
    }

    // If the homework belongs to a setter, the student must be linked to them.
    const homework = await withDbRetry(() => db
      .prepare("SELECT setter_username FROM homeworks WHERE id=?")
      .bind(body.homework_id)
      .first());

    if (homework?.setter_username) {
      const link = await withDbRetry(() => db
        .prepare(
          "SELECT 1 ok FROM setter_students WHERE setter_username=? AND student_username=?"
        )
        .bind(homework.setter_username, username)
        .first());
      if (!link) {
        return json(
          { error: "This username is not attached to the account that set this homework." },
          { status: 403 }
        );
      }
    }

    // Issue a session token so the child's later actions (e.g. Level Up) can be
    // authenticated as this student. They're PIN-verified at this point.
    const token = crypto.randomUUID() + crypto.randomUUID();
    await withDbRetry(() => context.env.DB
      .prepare("UPDATE students SET session_token=?,session_expires=datetime('now',?) WHERE username=?")
      .bind(token, SESSION_WINDOW, username)
      .run());

    return json({ username, display_name: student.display_name, token });
  } catch (error) {
    // Transient storage hiccup: give the child a friendly retry message rather
    // than the raw database error.
    if (isTransientDbError(error)) {
      console.error("students: transient D1 error", error?.message);
      return json(
        { error: "Verve had a brief database hiccup. Please tap Continue again in a moment." },
        { status: 503 }
      );
    }
    return json({ error: error.message }, { status: 500 });
  }
}
