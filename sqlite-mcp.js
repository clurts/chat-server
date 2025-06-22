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
      SQL: SELECT day, time FROM band WHERE LOWER(name) LIKE '%metallica%';

      Prompt: Hvilken dag spiller Volbeat?
      SQL: SELECT day FROM band WHERE LOWER(name) LIKE '%volbeat%';
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

      return {
        content: [{ type: "text", text: `Results for: ${sql}\n\n${summary}` }],
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
