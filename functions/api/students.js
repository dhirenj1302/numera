const json = (body, init = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init.headers || {}),
    },
  });

function cleanUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export async function onRequestPost(context) {
  try {
    if (!context.env.DB) {
      return json(
        { error: "Cloudflare D1 binding DB is missing." },
        { status: 503 }
      );
    }

    const body = await context.request.json();
    const username = cleanUsername(body.username);
    const displayName = String(body.display_name || "").trim();

    if (!/^[a-z0-9][a-z0-9-]{2,23}$/.test(username)) {
      return json(
        {
          error:
            "Username must be 3–24 characters using letters, numbers or hyphens.",
        },
        { status: 400 }
      );
    }

    if (!displayName) {
      return json({ error: "First name is required." }, { status: 400 });
    }

    const existing = await context.env.DB
      .prepare(
        `SELECT username, display_name
         FROM students
         WHERE username = ?`
      )
      .bind(username)
      .first();

    if (existing) {
      return json(existing);
    }

    await context.env.DB
      .prepare(
        `INSERT INTO students (username, display_name)
         VALUES (?, ?)`
      )
      .bind(username, displayName)
      .run();

    return json(
      {
        username,
        display_name: displayName,
      },
      { status: 201 }
    );
  } catch (error) {
    return json(
      {
        error: error.message || "The username could not be created.",
      },
      { status: 500 }
    );
  }
}

export async function onRequestGet(context) {
  try {
    if (!context.env.DB) {
      return json(
        { error: "Cloudflare D1 binding DB is missing." },
        { status: 503 }
      );
    }

    const username = cleanUsername(
      new URL(context.request.url).searchParams.get("username")
    );

    if (!username) {
      return json({ error: "username is required." }, { status: 400 });
    }

    const student = await context.env.DB
      .prepare(
        `SELECT username, display_name, created_at
         FROM students
         WHERE username = ?`
      )
      .bind(username)
      .first();

    if (!student) {
      return json({ error: "Username not found." }, { status: 404 });
    }

    return json(student);
  } catch (error) {
    return json(
      {
        error: error.message || "Student could not be loaded.",
      },
      { status: 500 }
    );
  }
}
