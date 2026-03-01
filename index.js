import express from "express";
import OpenAI from "openai";
import cors from "cors";

/* ========================= */
/* ===== APP INIT ========== */
/* ========================= */

const app = express();

/* ========================= */
/* ===== CORS FIX ========= */
/* ========================= */

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.options("*", cors());

app.use(express.json({ limit: "20mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

/* ========================= */
/* ===== OPENAI INIT ======= */
/* ========================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ========================= */
/* ===== OCR ENGINE ======== */
/* ========================= */

async function runVision(imageUrl) {
  const response = await openai.responses.create({
    model: "gpt-4o",
    temperature: 0,
    max_output_tokens: 1200,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
Analizza questa fattura italiana.

Restituisci SOLO JSON valido.
Nessun testo fuori dal JSON.

Struttura:
{
  "documento": {
    "numero_documento": string|null,
    "data_documento": string|null
  },
  "fornitore": {
    "ragione_sociale": string|null,
    "piva": string|null
  },
  "righe": [
    {
      "descrizione": string,
      "quantita": number,
      "unita_misura": string|null,
      "prezzo_unitario": number|null,
      "totale_riga": number|null,
      "iva_percent": number|null
    }
  ]
}
`
          },
          {
            type: "input_image",
            image_url: imageUrl
          }
        ]
      }
    ]
  });

  const text = response.output?.[0]?.content?.[0]?.text;
  if (!text) throw new Error("Risposta OpenAI vuota");

  let cleaned = text.trim();
  cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON non valido:", cleaned);
    throw new Error("JSON non valido restituito dal modello");
  }
}

/* ========================= */
/* ===== DEDUP ============= */
/* ========================= */

function dedupeRighe(righe = []) {
  const seen = new Set();

  return righe.filter(r => {
    const key = `${(r.descrizione || "").trim().toLowerCase()}_${r.quantita}_${r.prezzo_unitario}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ========================= */
/* ===== OCR ROUTE ========= */
/* ========================= */

app.post("/ocr", async (req, res) => {
  try {
    const { imageUrl, imageUrls } = req.body;

    const urls = Array.isArray(imageUrls)
      ? imageUrls
      : imageUrl
        ? [imageUrl]
        : [];

    if (!urls.length) {
      return res.status(400).json({
        success: false,
        error: "imageUrl o imageUrls mancanti"
      });
    }

    let results = [];

    for (const url of urls) {
      const parsed = await runVision(url);
      results.push(parsed);
    }

    const final = {
      documento: results[0]?.documento ?? null,
      fornitore: results[0]?.fornitore ?? null,
      righe: []
    };

    for (const r of results) {
      if (Array.isArray(r?.righe)) {
        final.righe.push(...r.righe);
      }
    }

    final.righe = dedupeRighe(final.righe);

    res.json({
      success: true,
      ...final
    });

  } catch (err) {
    console.error("Errore OCR:", err);

    res.status(500).json({
      success: false,
      error: err.message || "Errore OCR server"
    });
  }
});

/* ========================= */
/* ===== START SERVER ====== */
/* ========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("OCR server avviato su porta " + PORT);
});
