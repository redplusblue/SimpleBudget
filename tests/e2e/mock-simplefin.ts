import http from "node:http";
import type { AddressInfo } from "node:net";
import { loadAllFixtures, mockBank, NOW } from "../helpers/simplefin-mock";

/** Serves the fixture accounts over HTTP like a SimpleFIN Bridge, with timestamps shifted to "now". */
export async function startMockSimpleFin(port: number) {
  const shift = Math.floor(Date.now() / 1000) - NOW;
  const bank = mockBank(loadAllFixtures(shift));
  const server = http.createServer(async (req, res) => {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Basic ${Buffer.from("e2e:secret").toString("base64")}`) {
      res.writeHead(403).end();
      return;
    }
    const upstream = await bank.fetch(`http://127.0.0.1:${port}${req.url}`);
    res.writeHead(upstream.status, { "content-type": "application/json" }).end(await upstream.text());
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    accessUrl: `http://e2e:secret@127.0.0.1:${(server.address() as AddressInfo).port}/simplefin`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
