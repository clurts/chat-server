import Database from 'better-sqlite3';
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import sqlite3 from "sqlite3";

import { z } from 'zod';

const db = new sqlite3.Database('./suset.db');
const schemaText = `
# Schema:

## band
- id: INTEGER PRIMARY KEY
- name: TEXT NOT NULL
- day: TEXT NOT NULL
- time: TEXT NOT NULL
- stage: TEXT NOT NULL
- description: TEXT
`;


const server = new McpServer({ 
  name: 'sqlite-mcp', 
  version: '1.0.0' 
});

// 1️⃣ Resource: expose your DB schema

server.registerResource(
  'schema',
  new ResourceTemplate('sqlite://schema', {
    read: z.object({})
  }),
  {
    title: 'Database schema',
    description: 'SQLite schema for query generation',
    mimeType: 'text/plain'
  },
  async () => ({
    contents: [{ uri: 'sqlite://schema', text: schemaText }]
  })
);



// 2️⃣ Tool: execute raw SQL
server.registerTool(
  'query_sql',
  {
    title: 'Execute SQL query',
    description: 'Executes a SELECT or other SQL statement and returns JSON',
    inputSchema: z.object({ sql: z.string() })
  },
  async ({ sql }) => {
    const db = getDb();
    try {
      const results = await db.all(sql);
      return { content: [{ type: 'json', json: results }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${e.message}` }] };
    } finally {
      await db.close();
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

