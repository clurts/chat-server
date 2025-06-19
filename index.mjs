import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { spawn } from 'child_process';
import { McpClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio/index.js';
import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';
dotenv.config();



const app = new Hono();
const port = process.env.PORT || 4000;

const apiKey = process.env.MISTRAL_API_KEY;

const mistral = new Mistral({apiKey: apiKey});

app.use("/*", (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return next();
});

// Explicitly handle OPTIONS for the /api/chat route
app.options('/api/chat', (c) => {
  return c.text('', 204);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


app.post('/api/chat', async (c) => {
    const { message } = await c.req.json();

     // 1️⃣ Start the MCP server (sqlite-mcp.js must exist)
  const mcpProcess = spawn('node', ['sqlite-mcp.js'], {
    stdio: ['pipe', 'pipe', 'inherit']
  });

  const transport = new StdioClientTransport({
    stdin: mcpProcess.stdin,
    stdout: mcpProcess.stdout
  });

    const mcp = new McpClient({ transport });
    await mcp.handshake();


    try {

        // 2️⃣ Fetch the schema
    const schema = await mcp.getResource('sqlite://schema');
    const schemaText = schema.contents[0].text;


        const completion = await client.chat.complete({
            model: 'mistral-large-latest',
            messages: [
                {
                    role: 'system',
                    content: `You generate only raw SQLite SQL with no explanation or formatting.\nSchema:\n${schemaText}`
                },
                {
                    role: 'user', 
                    content: message
                },
            ]
        });

           const generatedSQL = completion.choices[0].message.content.trim();
    console.log('Generated SQL:', generatedSQL);

    // 4️⃣ Call the MCP tool to execute SQL
    const result = await mcp.callTool('query_sql', { generatedSQL });
    const rows = result.content[0].json;


  

    wait(1000); // Simulate processing delay

    // Step 3: Convert result to natural language with Mistral
    const explanation = await client.chat.complete({
      model: 'mistral-large-latest',
     messages: [
        {
          role: 'system',
          content: 'You summarize JSON data about bands into a natural sentence in Danish.'
        },
        {
          role: 'user',
          content: `Summarize this: ${JSON.stringify(rows, null, 2)}`
        }
      ]
    });

    const summary = explanation.choices[0].message.content.trim();
    mcpProcess.kill();    
    
    return c.json({ sql, data: rows, summary });
        
    } catch (error) {
        console.error('Error:', error);
        mcpProcess.kill();
        return c.json({ error: 'An error occurred while processing your request.' }, 500);
    }

});

serve({
  fetch: app.fetch,
  port: port,
}, () => {
  console.log(`Server is running on port ${port}`);
})