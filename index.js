import express from "express";
import OpenAI from "openai";
import cors from "cors";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileTypeFromBuffer } from "file-type";
import pdf from "pdf-poppler";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TEMP_DIR = "./tmp";
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

async function downloadFile(url) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(response.data);
}

async function convertPdfToImages(buffer) {
  const fileId = Date.now();
  const pdfPath = path.join(TEMP_DIR, `input_${fileId}.pdf`);
  fs.writeFileSync(pdfPath, buffer);

  const outputDir = path.join(TEMP_DIR, `out_${fileId}`);
  fs.mkdirSync(outputDir);

  const options = {
    format: "png",
    out_dir: outputDir,
    out_prefix: "page",
    page: null
  };

  await pdf.convert(pdfPath, options);

  const files = fs.readdirSync(outputDir);
  return files.map(f => path.join(outputDir, f));
}

async function runVision(imagePathOrUrl) {
  const imageInput =
    imagePathOrUrl.startsWith("http")
      ? { type: "input_image", image_url: imagePathOrUrl }
      : {
          type: "input_image",
          image_base64: fs.readFileSync(imagePathOrUrl, { encoding: "base64" })
        };

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

Struttura:
{
  "documento": { "numero_documento": string|null, "data_documento": string|null },
  "fornitore": { "ragione_sociale": string|null, "piva": string|null },
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
          imageInput
        ]
      }
    ]
  });

  const text = response.output?.[0]?.content?.[0]?.text;
  if (!text) throw new Error("Risposta OpenAI vuota");

  let cleaned = text.trim();
  cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").trim();

  return JSON.parse(cleaned);
}

app.post("/ocr", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ success: false, error: "imageUrl mancante" });
    }

    const buffer = await downloadFile(imageUrl);
    const type = await fileTypeFromBuffer(buffer);

    let results = [];

    if (type?.mime === "application/pdf") {
      const images = await convertPdfToImages(buffer);
      for (const img of images) {
        const parsed = await runVision(img);
        results.push(parsed);
      }
    } else {
      const parsed = await runVision(imageUrl);
      results.push(parsed);
    }

    // 🔥 Merge multipagina
    const final = {
      documento: results[0]?.documento ?? null,
      fornitore: results[0]?.fornitore ?? null,
      righe: []
    };

    for (const r of results) {
      if (Array.isArray(r.righe)) {
        final.righe.push(...r.righe);
      }
    }

    // Dedup semplice
    const seen = new Set();
    final.righe = final.righe.filter(r => {
      const key = `${r.descrizione}_${r.quantita}_${r.prezzo_unitario}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ success: true, ...final });

  } catch (err) {
    console.error("Errore OCR:", err);
    res.status(500).json({ success: false, error: "Errore OCR server" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("OCR server avviato su porta " + PORT);
});
