import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { WebSocketServer } from 'ws';
import portfinder from 'portfinder';

export async function startServer({ desiredPort = 4399 } = {}) {
   portfinder.basePort = desiredPort;
  const port = await portfinder.getPortPromise(); // 自动找可用端口
  const app = express();
  app.use(bodyParser.json());

  // 保存 skeleton
  app.post('/skeleton/save', (req: Request, res: Response) => {
    const { id, data } = req.body;
    console.log('[SAVE]', { id, data });
    res.json({ ok: true });
  });

  app.get('/__health', (_: Request, res: Response) => res.json({ ok: true }));

//   // WebSocket server
//   const wss = new WebSocketServer({ port: port + 1 });
//   wss.on('connection', (ws) => {
//     console.log('[WS] client connected');
//     ws.on('message', (msg) => console.log('[SMARTY_WS]', msg.toString()));
//     ws.on('close', () => console.log('[WS] client disconnected'));
//   });

  return new Promise<{ port: number }>((resolve) => {
    app.listen(port, () => {
      console.log(`[SMARTY_DEVTOOLS] HTTP Server running on ${port}, WS on ${port + 1}`);
      resolve({ port });
    });
  });
}
