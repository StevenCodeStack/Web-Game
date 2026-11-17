import type { IncomingMessage, ServerResponse } from 'node:http';

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      ok: true,
      runtime: 'vercel-serverless',
      note: 'Configure VITE_API_URL and VITE_WS_URL to point to your stateful Cannon.js + WebSocket game server.',
    }),
  );
}
