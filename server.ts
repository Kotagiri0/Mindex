import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Groq Proxy Route
app.post("/api/chat", async (req, res) => {
  console.log("Received chat request at /api/chat");
  try {
    const { messages, systemInstruction, tools, tool_choice } = req.body;
    
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      console.error("GROQ_API_KEY is missing on server");
      return res.status(500).json({ error: "GROQ_API_KEY is missing on server. Please add it to Vercel environment variables." });
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

    res.json(chatCompletion.choices[0].message);
  } catch (error: any) {
    console.error("Groq Proxy Error:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", env: process.env.NODE_ENV, vercel: !!process.env.VERCEL });
});

// Development Setup
if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
  const startDevServer = async () => {
    try {
      const { createServer } = await import("vite");
      const vite = await createServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Development server running on http://localhost:${PORT}`);
      });
    } catch (err) {
      console.error("Failed to start dev server:", err);
    }
  };
  startDevServer();
} else {
  // In production (Vercel or Cloud Run), we serve static files if we are not on Vercel
  // On Vercel, static files are handled by vercel.json and @vercel/static-build
  if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) return;
      res.sendFile(path.join(distPath, 'index.html'));
    });
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Production server running on http://localhost:${PORT}`);
    });
  }
}

export default app;
