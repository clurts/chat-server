// mcp-server.js

import Database from "better-sqlite3";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v3";
import { Mistral } from "@mistralai/mistralai";
import dotenv from "dotenv";
dotenv.config();

const apiKey = process.env.MISTRAL_API_KEY;

const mistral = new Mistral({ apiKey: apiKey });

const db = new Database("./suset.db");
const schemaText = `

CREATE TABLE "Band" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "time" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "imageId" INTEGER,
  CONSTRAINT "Band_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);`;

const server = new McpServer({
  name: "sqlite-mcp",
  version: "1.0.0",
});

// 1️⃣ Resource: expose your DB schema
server.registerResource(
  "schema",
  new ResourceTemplate("sqlite://schema", {}),
  {
    title: "Database schema",
    description: "SQLite schema for query generation",
    mimeType: "text/plain",
  },
  async () => ({
    contents: [{ uri: "sqlite://schema", text: schemaText }],
  })
);

server.registerResource(
  "schema",
  "schema://main",
  {
    title: "Database Schema",
    description: "SQLite database schema",
    mimeType: "text/plain",
  },
  async (uri) => {
    try {
      const tables = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table'")
        .all();
      return {
        contents: [
          { uri: uri.href, text: tables.map((t) => t.sql).join("\n") },
        ],
      };
    } catch (err) {
      console.error("Fejl ved læsning af schema:", err);
      return {
        contents: [{ uri: uri.href, text: "-- Fejl ved læsning af schema --" }],
      };
    }
  }
);

server.registerTool(
  "query",
  {
    title: "SQL Query",
    description: "Execute SQL queries on the database",
    inputSchema: {
      sql: z.string(),
    },
  },
  async ({ sql }) => {
    try {
      const stmt = db.prepare(sql);
      const results = stmt.all();
      // Synchronous return { content: [ { type: "text", text: JSON.stringify(results, null, 2), }, ], };
    } catch (err) {
      const error = err;
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "ask-mistral",
  {
    title: "ask Mistral LLM",
    description: "ask a question to Mistral LLM via API",
    inputSchema: {
      message: z.string().describe("what to ask the model"),
    },
  },
  async ({ message }) => {
    const completion = await mistral.chat.complete({
      model: "mistral-large-latest",
      messages: [
        {
          role: "system",
          content: message,
        },
      ],
    });
    console.log(
      "Mistral completion content:",
      completion.choices?.[0]?.message?.content
    );
    return {
      content: [
        {
          type: "text",
          text:
            completion.choices?.[0]?.message?.content ||
            "No response from Mistral",
        },
      ],
    };
  }
);

// 2️⃣ Tool: execute raw SQL
server.registerTool(
  "query_sql",
  {
    title: "Execute SQL query",
    description: "Executes a SELECT or other SQL statement and returns JSON",
    inputSchema: { sql: z.string().describe("the query to execute") }, //not inputSchema
  },
  async ({ sql }) => {
    try {
      const rows = db.prepare(sql).all();
      return { content: [{ type: "json", json: rows }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
  }
);
//console.log('inputSchema is ZodObject:', z.object({ sql: z.string() })._def.typeName)

server.registerTool(
  "find_band",
  {
    title: "Find band by natural language",
    description:
      'Responds to prompts like "bands playing on Friday at Sunset Stage"',
    inputSchema: { prompt: z.string() },
  },
  async ({ prompt }) => {
    const fewShot = `
      Prompt: Hvornår spiller Metallica?
      SQL: SELECT * FROM band WHERE LOWER(name) LIKE '%metallica%';

      Prompt: Hvilken dag spiller Volbeat?
      SQL: SELECT day FROM band WHERE LOWER(name) LIKE '%volbeat%';

      Prompt: Hvem spiller på rød scene?
      SQL: SELECT * FROM band WHERE LOWER(stage) LIKE '%rød scene%' ORDER BY day, time;

      Prompt: Hvad er programmet for på fredag?
      SQL: SELECT * FROM band WHERE LOWER(day) LIKE '%fredag%' ORDER BY stage, time;
    `;

    const systemPrompt = `
Du er en AI der konverterer spørgsmål til SQLite SELECT-sætninger.

Regler:
- Returner kun én gyldig SELECT-sætning
- Ingen forklaringer, ingen "Prompt:", ingen "SQL:"
- Returnér kun selve SQL'en

Eksempler: ${fewShot}

 -- Her er spørgsmålet: ${prompt}

   -- Svar kun med SQL:
    `;

    const completion = await mistral.chat.complete({
      model: "mistral-large-latest",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        // {
        //   role: 'user',
        //   content: prompt  // <- the actual user input
        // }
      ],
    });

    console.log(
      "Mistral completion content:",
      completion.choices?.[0]?.message?.content
    );

    let sql = completion.choices?.[0]?.message?.content?.trim();

    sql = sql
      .replace(/^```sql\s*/i, "")
      .replace(/```$/, "")
      .trim();

    if (!sql || !/^\s*select\b/i.test(sql)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid or unsafe SQL generated: ${sql || "undefined"}`,
          },
        ],
      };
    }

    console.log("Generated SQL:", sql);

    try {
      const rows = db.prepare(sql).all();

      if (!rows || rows.length === 0) {
        return {
          content: [{ type: "text", text: `No results for: ${sql}` }],
        };
      }

      const summary = rows.map((row) => JSON.stringify(row)).join("\n");

      const explanation = await mistral.chat.complete({
        model: "mistral-large-latest",
        messages: [
          {
            role: "system",
            content:
              "You convert structured data into plain natural language summaries in the danish language. You always answer in complete sentences. If the response is empty, please reply accoringly, that the band or the stage is not a part of the program this year.",
          },
          {
            role: "user",
            content: `answer the question asked, (${prompt}), whith the information in in the: ${summary}. provide information about both the day, the time and the stage in the response, if relevant.  If the response is empty, reply accordingly, that the band or the stage is not a part of the program this year.`,
          },
        ],
      });

      return {
        content: [
          {
            type: "text",
            text:
              explanation.choices?.[0]?.message?.content ||
              "No explanation provided.",
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error executing SQL: ${e.message}` }],
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
