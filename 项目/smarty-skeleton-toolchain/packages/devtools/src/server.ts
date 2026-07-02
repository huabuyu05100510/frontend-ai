import express from "express";
import path from "path";
import fs from "fs-extra";
import cors from "cors";
import getPort from "get-port";

const app = express();
app.use(express.json());
app.use(cors({ origin: "*", credentials: true }));

const SKELETON_DIR = path.resolve(process.cwd(), "src/skeletons");

app.post("/save", async (req, res) => {
  try {
    const { skeletons } = req.body;
    if (!skeletons) {
      return res.status(400).json({ success: false, error: "Missing parameters" });
    }

    await fs.ensureDir(SKELETON_DIR);

    const saved: Record<string, string> = {};

    for (const id of Object.keys(skeletons)) {
      const filePath = path.join(SKELETON_DIR, `${id}.bin`);

      // skeletons[id] 必须是原始 Uint8Array 或 Buffer
      // let buffer: Buffer;
      // if (skeletons[id] instanceof Uint8Array || skeletons[id] instanceof ArrayBuffer) {
      //   buffer = Buffer.from(skeletons[id]);
      // } else if (Buffer.isBuffer(skeletons[id])) {
      //   buffer = Buffer.from(skeletons[id]);
      // } else {
      //   // 如果不是二进制，就抛错，避免保存成 JSON
      //   throw new Error(`Skeleton ${id} is not binary`);
      // }
      let buffer = Buffer.from(skeletons[id], "base64"); // decode base64
      await fs.writeFile(filePath, buffer);
      saved[id] = filePath;
    }

    res.json({ success: true, saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err });
  }
});



app.get("/preview", async (req, res) => {
  try {
    const route = (req.query.route as string) || "defaultRoute";
    const routeDir = path.join(SKELETON_DIR, route);
    const files = await fs.readdir(routeDir);
    const lastFile = files.sort().reverse()[0];
    if (!lastFile) return res.json({});
    const content = await fs.readFile(path.join(routeDir, lastFile), "utf-8");
    res.json(JSON.parse(content));
  } catch {
    res.json({});
  }
});

export async function startServer(preferredPort = 3001) {
  const port = await getPort({ port: preferredPort });
  app.listen(port, () => {
    console.log(`DevTools API server running at http://localhost:${port}`);
  });
  return port;
}  