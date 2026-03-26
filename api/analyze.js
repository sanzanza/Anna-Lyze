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

Pair: ${pair}
Direction: ${direction}
RR: ${rr}

Rules:
1. Break must be strong close + continuation
2. Retest must occur
3. Entry must be CHoCH after retest
4. Invalid if consolidation
5. Invalid if no retest
6. Invalid if weak break
7. Invalid if RR < 1:2

Return JSON:
{
  "verdict": "VALID or INVALID",
  "score": number,
  "summary": "",
  "explanation": ""
}`
      }),
    });

    const data = await response.json();

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
