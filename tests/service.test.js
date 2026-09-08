const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { app } = require("../app");

describe("OCR Service", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.on("listening", resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      server.close();
      await new Promise((resolve) => server.on("close", resolve));
    }
  });

  it("health check returns ok", async () => {
    const res = await new Promise((resolve, reject) => {
      http.get(`${baseUrl}/health`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(JSON.parse(data)));
      }).on("error", reject);
    });
    assert.strictEqual(res.status, "ok");
  });
});
