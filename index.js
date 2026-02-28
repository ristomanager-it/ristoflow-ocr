import express from "express";
import OpenAI from "openai";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/ocr", async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: "imageUrl mancante"
      });
    }

    const response = await openai.responses.create({
      model: "gpt-4o",
      temperature: 0,
      max_output_tokens: 800,
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

Regole:
- Solo righe prodotto.
- Ignora totali generali.
- Non unire righe.
- Non inventare prodotti.
- Usa punto come separatore decimale.
- Se quantità e totale_riga esistono, calcola prezzo_unitario.
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

    if (!text) {
      return res.status(500).json({
        success: false,
        error: "Risposta OpenAI vuota"
      });
    }

    // 🔥 PULIZIA AUTOMATICA MARKDOWN
    let cleaned = text.trim();

    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/```json/gi, "");
      cleaned = cleaned.replace(/```/g, "");
      cleaned = cleaned.trim();
    }

    let parsed;

    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: "JSON non valido restituito dal modello",
        raw: text
      });
    }

    res.json({
      success: true,
      documento: parsed.documento ?? null,
      fornitore: parsed.fornitore ?? null,
      righe: parsed.righe ?? []
    });

  } catch (err) {
    console.error("Errore OCR:", err);

    res.status(500).json({
      success: false,
      error: "Errore OCR server"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("OCR server avviato su porta " + PORT);
});
