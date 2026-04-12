import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Logging middleware for API requests
app.use("/api/*", (req, res, next) => {
  console.log(`[API] ${req.method} ${req.originalUrl}`);
  next();
});

const GROQ_API_KEY = process.env.GROQ_API_KEY;

app.get("/api/chat", (req, res) => {
  res.json({ status: "ok", message: "Local Chat API is running" });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages, systemInstruction, tools, tool_choice } = req.body;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ 
        error: "GROQ_API_KEY не найден в .env" 
      });
    }

    const groq = new Groq({ apiKey });

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemInstruction },
        ...messages
      ],
      model: "llama-3.3-70b-versatile",
      tools,
      tool_choice: tool_choice || "auto",
      temperature: 0.7,
      max_tokens: 1024,
    });

    if (!chatCompletion.choices || chatCompletion.choices.length === 0) {
      throw new Error("Groq вернул пустой список вариантов (choices).");
    }

    res.json(chatCompletion.choices[0].message);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Ошибка сервера" });
  }
});

if (process.env.NODE_ENV !== "production") {
  const startDevServer = async () => {
    try {
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", async () => {
        console.log(`Локальный сервер запущен: http://localhost:${PORT}`);
      });
    } catch (err) {
      console.error("Ошибка запуска Vite:", err);
    }
  };
  startDevServer();
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return;
    res.sendFile(path.join(distPath, 'index.html'));
  });
  
  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`Продакшн сервер запущен: http://localhost:${PORT}`);
  });
}

export default app;
