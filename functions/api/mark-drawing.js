// functions/api/mark-drawing.js
// AI marking of a child's freehand maths drawing. Deliberately conservative:
// if the drawing cannot be judged reliably, the model must return low confidence
// so the app falls back to teacher review.

import { json } from "./_lib.js";

const drawingMarkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["correct", "confidence", "feedback"],
  properties: {
    correct: { type: "boolean" },
    confidence: { type: "number" },
    feedback: { type: "string" }
  }
};

export async function onRequestPost(context) {
  try {
    if (!context.env.OPENAI_API_KEY) {
      return json({ error: "OpenAI key missing." }, { status: 503 });
    }

    const body = await context.request.json();
    const instruction =
      `Mark this child's maths drawing. Task: ${body.prompt}. ` +
      `Rubric or expected result: ${body.rubric || "Use the task wording"}. ` +
      `Be conservative. Return JSON with correct boolean, confidence 0-1, and short kind feedback. ` +
      `If the drawing cannot be judged reliably, confidence must be below 0.72.`;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: context.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: instruction },
              { type: "input_image", image_url: body.drawing_image, detail: "high" }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "drawing_mark",
            strict: true,
            schema: drawingMarkSchema
          }
        }
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Drawing mark failed.");

    const raw = (data.output || [])
      .flatMap(item => item.content || [])
      .find(part => part.type === "output_text")?.text;

    return json(JSON.parse(raw));
  } catch (error) {
    return json({ error: error.message }, { status: 500 });
  }
}
