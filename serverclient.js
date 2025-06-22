// serverClient.js

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";


// 2️⃣ Connect client via stdio
const transport = new StdioClientTransport({
 command: "node",
  args: ["sqlite-mcp.js"],
});

const client = new Client( {
  name: 'sqlite-mcp-client',
  version: '1.0.0',
});
await client.connect(transport);

// 3️⃣ Function to query the server
export async function askPrompt(prompt) {
  const result = await client.callTool({
    name: "find_band",
    arguments: {
      prompt
    }
  });

  const textContent =
    result.content?.find(c => c.type === "text")?.text ??
    JSON.stringify(result.content?.[0]?.json ?? {}, null, 2);

  return textContent;
}
