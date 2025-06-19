import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';
dotenv.config();

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

app.post('/api/chat', async (c) => {
    try {
        const { message } = await c.req.json();
        console.log('Received message:', message);
        const chatResponse = await client.chat.complete({
            model: 'mistral-large-latest',
            messages: [{role: 'user', content: message}],
        });
        return c.json({ response: chatResponse.choices[0].message.content });
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