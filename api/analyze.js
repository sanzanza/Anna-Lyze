const OPENAI_API_URL = "https://api.openai.com/v1/responses";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
  }

  try {
    const {
      pair,
      direction,
      rr,
      biasClear,
      structureClear,
      breakConfirmed,
      retestConfirmed,
      entryConfirmation,
      screenshot4h,
      screenshot1h,
      screenshotEntry
    } = req.body || {};

    const missingFields = [
      !pair && "pair",
      !direction && "direction",
      (!rr && rr !== 0) && "rr",
      !screenshot4h && "4h screenshot",
      !screenshot1h && "1h screenshot",
      !screenshotEntry && "5m/15m screenshot"
    ].filter(Boolean);

    if (missingFields.length) {
      return res.status(400).json({
        error: "Missing required fields.",
        missing_fields: missingFields
      });
    }

    const numericRr = Number(rr);
    if (!Number.isFinite(numericRr)) {
      return res.status(400).json({ error: "RR must be a valid number." });
    }

    const systemPrompt = [
      "You are Anna-Lyze, a strict professional trading validator.",
      "Review the provided chart screenshots and trade context.",
      "Your tone must be strict, professional, direct, and concise.",
      "You must enforce the exact sequence: Break -> Retest -> CHoCH.",
      "If any step is missing, weak, or out of order, verdict must be INVALID.",
      "Challenge trader inputs. Do not trust the user if the screenshots conflict with the stated review.",
      "Detect contradictions between directional intent and higher-timeframe bias.",
      "Detect contradictions between claimed structure and visible consolidation or unclear market conditions.",
      "Rules:",
      "1. Break of structure must be a strong candle close with visible continuation. Wick breaks are invalid. Weak closes are invalid.",
      "2. Retest must revisit the broken level and show reaction. If no retest, INVALID.",
      "3. Entry confirmation must be a lower timeframe CHoCH after the retest. If CHoCH appears before retest, INVALID.",
      "4. Environment filters: INVALID if consolidation, choppy market, ranging market, trading into strong zone, or RR < 1:2.",
      "5. Direction vs bias check: if screenshots show bearish 4H bias and trader wants LONG, INVALID. If screenshots show bullish 4H bias and trader wants SHORT, INVALID.",
      "6. Structure honesty check: if trader claims structure is clear but the chart is consolidating, choppy, ranging, or unclear, reduce score and flag inconsistency.",
      "7. Entry honesty check: if trader claims break, retest, or entry confirmation are present but the screenshot evidence is weak or absent, penalize and flag the contradiction.",
      "Scoring rules:",
      "- Never return all zeros unless the screenshots are completely unusable.",
      "- 4H Bias should usually be 60-90 if direction aligns and bias is clear, lower if unclear or contradictory.",
      "- 1H Structure should usually be 20-60 if unclear, higher only if structure is clearly clean.",
      "- Entry Review should usually be 0-30 if confirmation sequence is weak or missing.",
      "- Risk should usually be 40-80 depending on RR and environmental quality.",
      "Use strict phrases where appropriate, such as: No strong break confirmed. Price did not retest the level. You are anticipating, not reacting. Sequence not respected. Market is consolidating, no trade.",
      "Return JSON only."
    ].join(" ");

    const userPrompt = [
      `Pair: ${pair}`,
      `Direction: ${direction}`,
      `RR: ${numericRr}`,
      `Trader claims 4H bias is clear: ${biasClear}`,
      `Trader claims 1H structure is clear: ${structureClear}`,
      `Trader claims break is confirmed: ${breakConfirmed}`,
      `Trader claims retest is confirmed: ${retestConfirmed}`,
      `Trader claims entry confirmation is present: ${entryConfirmation}`,
      "Assess the trade from the screenshots using the strict sequential rules.",
      "Return an object with this exact schema:",
      "{",
      '  "verdict": "VALID or INVALID",',
      '  "score": number,',
      '  "items": [',
      '    { "name": "4H Bias", "score": number },',
      '    { "name": "1H Structure", "score": number },',
      '    { "name": "Entry Review", "score": number },',
      '    { "name": "Risk", "score": number }',
      "  ],",
      '  "missing": ["specific issues"],',
      '  "message": "strict explanation pointing out contradictions"',
      "}",
      "Missing items must be specific, not generic."
    ].join("\n");

    const openAiResponse = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: userPrompt },
              { type: "input_image", image_url: screenshot4h },
              { type: "input_image", image_url: screenshot1h },
              { type: "input_image", image_url: screenshotEntry }
            ]
          }
        ],
        text: {
          format: {
            type: "json_object"
          }
        }
      })
    });

    const payload = await openAiResponse.json();

    if (!openAiResponse.ok) {
      return res.status(openAiResponse.status).json({
        error: "OpenAI request failed.",
        details: payload
      });
    }

    const rawText = payload.output_text || extractOutputText(payload);
    const parsed = JSON.parse(rawText);

    return res.status(200).json({
      verdict: parsed.verdict === "VALID" ? "VALID" : "INVALID",
      score: clampScore(parsed.score),
      items: normalizeItems(parsed.items),
      missing: Array.isArray(parsed.missing) ? parsed.missing.map(String) : [],
      message: typeof parsed.message === "string"
        ? parsed.message
        : "Sequence not respected."
    });
  } catch (error) {
    return res.status(500).json({
      error: "Analysis failed.",
      details: error instanceof Error ? error.message : "Unknown server error."
    });
  }
};

function clampScore(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function extractOutputText(payload) {
  if (!payload || !Array.isArray(payload.output)) {
    return "";
  }

  const textParts = [];
  payload.output.forEach((item) => {
    if (!Array.isArray(item.content)) {
      return;
    }
    item.content.forEach((contentItem) => {
      if (contentItem.type === "output_text" && contentItem.text) {
        textParts.push(contentItem.text);
      }
    });
  });

  return textParts.join("\n");
}

function normalizeItems(items) {
  const defaults = [
    { name: "4H Bias", score: 0 },
    { name: "1H Structure", score: 0 },
    { name: "Entry Review", score: 0 },
    { name: "Risk", score: 0 }
  ];

  if (!Array.isArray(items)) {
    return defaults;
  }

  const normalized = items
    .map((item) => ({
      name: typeof item?.name === "string" ? item.name : "",
      score: clampScore(item?.score)
    }))
    .filter((item) => item.name);

  if (!normalized.length) {
    return defaults;
  }

  return normalized;
}
