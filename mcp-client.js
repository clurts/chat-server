// mcp-client.js

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// 2️⃣ Connect client via stdio
const transport = new StdioClientTransport({
  command: "node",
  args: ["mcp-server.js"],
});

const client = new Client({
  name: "sqlite-mcp-client",
  version: "1.0.0",
});
await client.connect(transport);

const tools = await client.listTools();
console.log("Available tools:", tools);

// 1. Liste tilgængelige resources
const resourceList = await client.listResources();
console.log("Available resources:", resourceList.resources[0].uri);

export async function askPrompt(prompt) {
  const resource = await client.readResource({
    uri: "schema://main",
  });
  let schemaText = resource.contents[0].text;

  // Brug LLM til at generere SQL-sætningen baseret på skemaet og prompten
  const llmResponse = await client.callTool({
    name: "ask-mistral",
    arguments: {
      message: `Skema: ${schemaText}\n\nPrompt: ${prompt}\n\nGenerer en rå SQL-sætning uden nærmere forklaring, baseret på skemaet og prompten. Tag højde for, at brugeren måske ikke har skrevet præcist, hvad de ønsker, så vær fleksibel i din fortolkning. Returner kun SQL-sætningen uden yderligere tekst eller forklaringer. Brug gerne keywords som "SELECT", "FROM", "WHERE", "ORDER BY" osv. Husk at SQL'en skal være gyldig og sikker at køre mod databasen.\n\nEksempel på SQL-sætning:\n\n\`\`\`sql\nSELECT * FROM band WHERE LOWER(stage) LIKE '%rød scene%' ORDER BY day, time;\n\`\`\`\n\nForetræk altid 'SELECT * FROM...' så der er mest mulig data til at generere svaret med.`,
    },
  });

  const sqlResponse = llmResponse.content[0].text;

  const sqlQuery = sqlResponse.replace(/```sql\n|\n```/g, "").trim();
  console.log("Generated SQL Query:", sqlQuery);

  // Brug den genererede SQL-sætning til at foretage din databaseforespørgsel
  const queryResponse = await client.callTool({
    name: "query",
    arguments: {
      sql: sqlQuery,
    },
  });

  console.log("Response from query_sql:", queryResponse.content[0].text);

  const finalResponse = await client.callTool({
    name: "ask-mistral",
    arguments: {
      message: `omskriv databaseresponsen til et menneskeligt læsbart format: ${queryResponse.content[0].text}. Udelad id'er og billedstier fra tekst-resultatet.`,
    },
  });
  console.log("Final response:", finalResponse.content[0].text);

  let textContent = finalResponse.content[0].text;
  return textContent;
}
