import express from "express";

// Serverless Handler for Vercel Deployment
const app = express();

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", environment: "Vercel Serverless" });
});

export default app;
