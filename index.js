import { Hono } from "hono";
import { cors } from "hono/cors";
import { askPrompt } from "./mcp-client.js";
import { serve } from "@hono/node-server";

import dotenv from "dotenv";
dotenv.config();

const app = new Hono();
const port = process.env.PORT || 4000;

// Middleware to handle CORS
app.use("api/*", cors());

app.post("/api/chat", async (c) => {
  const body = await c.req.json();
  console.log("Received body:", body);

  const message = body.message || body.prompt; // Support both 'message' and 'prompt' keys
  console.log("Extracted message:", message);

  if (!message || typeof message !== "string") {
    return c.json({ error: "Missing or invalid prompt" }, 400);
  }

  try {
    const answer = await askPrompt(message);
    return c.json({ answer });
  } catch (error) {
    console.error("MCP client error:", error);
    return c.json({ error: "Failed to query MCP server" }, 500);
  }
});

serve(
  {
    fetch: app.fetch,
    port: port,
  },
  () => {
    console.log(`Server is running on port ${port}`);
  }
);
