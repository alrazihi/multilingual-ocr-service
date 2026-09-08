const { describe, it } = require("node:test");
const assert = require("node:assert");
const http = require("http");

describe("OCR Service", () => {
  it("health check returns ok", async () => {
    const res = await new Promise((resolve, reject) => {
      http.get("http://localhost:5000/health", (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(JSON.parse(data)));
      }).on("error", reject);
    });
    assert.strictEqual(res.status, "ok");
  });
});
