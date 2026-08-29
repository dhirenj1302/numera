// functions/api/suggest-options.js
// On-demand helper for the teacher editor: given a question and its correct
// answer, suggest a set of multiple-choice options — the correct answer plus
// diagnostic distractors. A diagnostic distractor is the answer a child gets
// when they make a SPECIFIC common mistake (e.g. adding denominators when
// adding fractions), not a random wrong number. Each distractor carries the
// misconception it represents, so the teacher can see WHY it's a good wrong
// answer — and so this signal can later feed the understanding model.

import { json } from "./_lib.js";

const optionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["correct_answer", "distractors", "shuffled_options"],
  properties: {
    correct_answer: { type: "string" },
    distractors: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["value", "misconception"],
        properties: {
          value: { type: "string" },
          // Short label for the mistake this wrong answer represents, e.g.
          // "added the denominators" or "off-by-one place value". Kept concise.
          misconception: { type: "string" }
        }
      }
    },
    // The full option list (correct + distractors) in a sensible display order,
    // so the frontend can drop it straight into the options field.
    shuffled_options: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 4 }
  }
};

export async function onRequestPost(context) {
  try {
    if (!context.env.OPENAI_API_KEY) {
      return json({ error: "OpenAI key missing." }, { status: 503 });
    }

    const body = await context.request.json();
    const prompt = String(body.prompt || "").trim();
    const answer = String(body.answer ?? "").trim();
    if (!prompt) return json({ error: "A question prompt is required." }, { status: 400 });

    const instruction =
      `You are helping a primary-school teacher build a multiple-choice maths question.\n` +
      `Question: "${prompt}"\n` +
      (answer ? `The correct answer is: "${answer}".\n` : `Work out the correct answer yourself.\n`) +
      `Produce the correct answer plus 2-3 DIAGNOSTIC distractors. A diagnostic distractor is the ` +
      `answer a child would get from a SPECIFIC common mistake for this exact question — for example, ` +
      `for adding fractions with the same denominator, a child who also adds the denominators, or who ` +
      `adds numerators and forgets the denominator. Do NOT use random wrong numbers. For each distractor ` +
      `give its value and a short plain-English label of the mistake it represents.\n` +
      `CRITICAL: preserve the exact notation, units and currency of the question as written (for example ` +
      `keep a comma decimal separator if the question uses one, keep the currency symbol used, keep the ` +
      `units). Do not convert or normalise notation. Keep every option in the same format as the answer.\n` +
      `IMPORTANT - combination questions: if the question presents a FIXED SET of specific items or values ` +
      `(for example boxes labelled 6kg, 4kg, 5kg, 2kg, or a list of given numbers) and asks which of them ` +
      `combine to meet a condition (which add up to a total, which pair sums to X, which two make Y), then ` +
      `EVERY option - the correct answer and all distractors - MUST be built ONLY from the items actually ` +
      `presented in the question. Never invent a value that is not among the presented items. For example, ` +
      `if the boxes are 6kg, 4kg, 5kg and 2kg and the answer is '4kg and 2kg', a distractor like '5kg and 1kg' ` +
      `is FORBIDDEN because there is no 1kg box; use only real combinations such as '6kg and 2kg' or '5kg and 4kg'. ` +
      `The distractors should be plausible WRONG combinations of the presented items (ones that do not meet the ` +
      `condition, or a common miscount), so the child is genuinely tested on identifying the right combination.\n` +
      `Return shuffled_options as the correct answer and the distractors together in a natural order.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: context.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [{ role: "user", content: [{ type: "input_text", text: instruction }] }],
        text: {
          format: {
            type: "json_schema",
            name: "mc_options",
            strict: true,
            schema: optionsSchema
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Could not suggest options.");

    const raw = (data.output || [])
      .flatMap(item => item.content || [])
      .find(part => part.type === "output_text")?.text;

    const parsed = JSON.parse(raw);

    // Defensive: guarantee the correct answer is actually present in the options.
    // Treat an empty/whitespace correct_answer as missing (|| not ??) so it
    // falls back to the answer the teacher provided.
    const correct = (String(parsed.correct_answer ?? "").trim()) || String(answer ?? "").trim();
    let options = Array.isArray(parsed.shuffled_options) ? parsed.shuffled_options.map(o => String(o).trim()).filter(Boolean) : [];
    if (correct && !options.some(o => o === correct)) options.unshift(correct);
    // De-duplicate while preserving order.
    options = [...new Set(options)];

    return json({
      correct_answer: correct,
      distractors: parsed.distractors || [],
      options
    });
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
