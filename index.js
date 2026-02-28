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
      return res.status(400).json({ success: false, error: "imageUrl mancante" });
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
              text: "Estrai i dati della fattura e restituisci SOLO JSON valido."
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

    res.json({
      success: true,
      raw: text
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Errore OCR" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("OCR server avviato su porta " + PORT);
});
