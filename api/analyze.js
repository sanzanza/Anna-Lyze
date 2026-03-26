export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { pair, direction, rr } = req.body;

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1",
        input: `You are a strict trading validator.

Return ONLY valid JSON. No extra text.

Pair: ${pair}
Direction: ${direction}
RR: ${rr}

Rules:
- Must have strong break + continuation
- Must have retest
- Must have CHoCH entry
- Reject consolidation
- Reject weak structure
- Reject RR < 1:2

Return EXACTLY:

{
  "verdict": "VALID or INVALID",
  "score": number,
  "items": [
    { "name": "4H Bias", "score": number },
    { "name": "1H Structure", "score": number },
    { "name": "Entry Review", "score": number },
    { "name": "Risk", "score": number }
  ],
  "missing": ["list of issues"],
  "message": "strict explanation"
}`
      }),
    });

    const data = await response.json();
    const text = data.output?.[0]?.content?.[0]?.text || "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        verdict: "INVALID",
        score: 0,
        items: [],
        missing: ["Failed to parse AI response"],
        message: text
      };
    }

    return res.status(200).json(parsed);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
