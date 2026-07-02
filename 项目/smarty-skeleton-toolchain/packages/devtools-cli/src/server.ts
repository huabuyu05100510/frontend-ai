import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import portfinder from 'portfinder';

export async function startServer(desiredPort = 4399) {
  portfinder.basePort = desiredPort;
  const port = await portfinder.getPortPromise();

  const app = express();
  app.use(bodyParser.json());

  // 保存 skeleton
  app.post('/skeleton/save', (req: Request, res: Response) => {
    const { id, data } = req.body;
    console.log('[SAVE]', { id, data });
    res.json({ ok: true });
  });

  app.get('/__health', (_: Request, res: Response) => res.json({ ok: true }));


  app.listen(port, () => {
    console.log(`[SMARTY_DEVTOOLS] HTTP Server running on ${port}, WS on ${port + 1}`);
  });

  return port;
}
