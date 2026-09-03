// functions/api/contact.js
// Receives a contact-form submission from the public contact page and delivers
// it to the Verve Maths inbox.
//
// Design: the message is ALWAYS persisted to the D1 `contact_messages` table
// first. That guarantees nothing is ever lost even if email delivery is not
// configured or fails. If a RESEND_API_KEY secret is present, we then also try
// to email admin@vervemaths.com via Resend. Email failure is non-fatal — the
// row is already saved and can be read back from the database.

import { json } from "./_lib.js";

const INBOX = "admin@vervemaths.com";
// Resend requires the "from" address to be on a domain you've verified with
// them. vervemaths.com is verified for email, so we send as this address.
const FROM = "Verve Maths contact form <noreply@vervemaths.com>";

const MAX_NAME = 200;
const MAX_EMAIL = 320;      // RFC 5321 maximum email length
const MAX_SUBJECT = 300;
const MAX_MESSAGE = 5000;

// Deliberately permissive: we only reject things that are clearly not an
// address. Real validation is that we can actually reply to it.
const looksLikeEmail = value => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

/** Escape a value for safe inclusion in an HTML email body. */
const escapeHtml = value =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));

    const name = String(body.name || "").trim().slice(0, MAX_NAME);
    const email = String(body.email || "").trim().slice(0, MAX_EMAIL);
    const subject = String(body.subject || "").trim().slice(0, MAX_SUBJECT);
    const message = String(body.message || "").trim().slice(0, MAX_MESSAGE);

    if (!name || !email || !message) {
      return json(
        { error: "Please add your name, your email and a message so we can reply." },
        { status: 400 }
      );
    }
    if (!looksLikeEmail(email)) {
      return json(
        { error: "That email address doesn't look right — please check it so we can reply." },
        { status: 400 }
      );
    }

    // 1) Persist to D1. This is the source of truth; if it fails we cannot
    //    guarantee delivery, so this failure IS fatal.
    const db = context.env.DB;
    try {
      await db
        .prepare(
          "INSERT INTO contact_messages (name,email,subject,message) VALUES (?,?,?,?)"
        )
        .bind(name, email, subject || null, message)
        .run();
    } catch (dbError) {
      return json(
        { error: "We couldn't save your message just now. Please try again in a moment." },
        { status: 500 }
      );
    }

    // 2) Best-effort email via Resend. Never fatal — the row is already saved.
    let emailed = false;
    const apiKey = context.env.RESEND_API_KEY;
    if (apiKey) {
      const subjectLine = subject
        ? `Verve Maths contact: ${subject}`
        : "Verve Maths contact form enquiry";
      const textBody =
        `New message from the Verve Maths contact form:\n\n` +
        `Name: ${name}\n` +
        `Email: ${email}\n` +
        `Subject: ${subject || "(none)"}\n\n` +
        `${message}\n`;
      const htmlBody =
        `<p>New message from the Verve Maths contact form:</p>` +
        `<p><strong>Name:</strong> ${escapeHtml(name)}<br>` +
        `<strong>Email:</strong> ${escapeHtml(email)}<br>` +
        `<strong>Subject:</strong> ${escapeHtml(subject || "(none)")}</p>` +
        `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;

      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: FROM,
            to: [INBOX],
            reply_to: email,
            subject: subjectLine,
            text: textBody,
            html: htmlBody
          })
        });
        emailed = resp.ok;
      } catch (mailError) {
        // Swallow — the message is safely stored and can be read from D1.
        emailed = false;
      }
    }

    // From the sender's point of view the message is delivered either way:
    // it's captured and a human will see it.
    return json({ ok: true, emailed });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
