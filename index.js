import Database from 'better-sqlite3';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';
dotenv.config();

const db = new Database('./suset.db');

const app = new Hono();
const port = process.env.PORT || 4000;

const apiKey = process.env.MISTRAL_API_KEY;

const client = new Mistral({apiKey: apiKey});

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


const schemaDescription = `
# Schema:

## band
- id: INTEGER PRIMARY KEY
- name: TEXT NOT NULL
- day: TEXT NOT NULL
- time: TEXT NOT NULL
- stage: TEXT NOT NULL
- description: TEXT
`;

app.post('/api/chat', async (c) => {
    try {
        const { message } = await c.req.json();
        console.log('Received message:', message);

        const sqlGen = await client.chat.complete({
            model: 'mistral-large-latest',
            messages: [
                {
                    role: 'system',
      content: `You generate only raw SQLite SQL queries with no explanation or formatting.
Use this database schema:

${schemaDescription}

Return only a complete SQL statement, nothing else. Do not say anything before or after the SQL. Do not use Markdown formatting.`},
                {role: 'user', content: `Generate a SQL query based on: ${message}`},
            ]
        });

           const generatedSQL = sqlGen.choices[0].message.content.trim();
    console.log('Generated SQL:', generatedSQL);

// Step 2: Run the SQL query
    let queryResult;

    try {
      const stmt = db.prepare(generatedSQL);
      queryResult = stmt.all(); // use .get() for single row
    } catch (queryError) {
      console.error('SQL Error:', queryError);
      return c.json({ error: 'Invalid SQL query generated.' }, 400);
    }

    wait(1000); // Simulate processing delay

    // Step 3: Convert result to natural language with Mistral
    const explanation = await client.chat.complete({
      model: 'mistral-large-latest',
      messages: [
        { role: 'system', content: 'You convert structured data into plain natural language summaries in the danish language. You always answer in complete sentences.' },
        { role: 'user', content: `Please provide information about the time and place, but also a short, one sentence introduction to the band based on the description in this response: ${JSON.stringify(queryResult, null, 2)}` },
      ],
    });

    const explanationText = explanation.choices[0].message.content.trim();
        return c.json({ response: explanationText });
        
    } catch (error) {
        console.error('Error:', error);
        return c.json({ error: 'An error occurred while processing your request.' }, 500);
    }

});

serve({
  fetch: app.fetch,
  port: port,
}, () => {
  console.log(`Server is running on port ${port}`);
})