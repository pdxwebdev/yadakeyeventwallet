import express from "express";
import cors from "cors";
import { spawn, spawnSync } from "child_process";
import vm from "vm";
import fs from "fs/promises";
import path from "path";

const app = express();
const port = 3001;
app.use(cors());
app.use(express.json());

app.post("/deploy", async (req, res) => {
  try {
    const { deployEnv, wif1, wif2, wif3, cprkh, ctprkh, clean } = req.body;

    // Validate inputs
    if (!wif1 || !wif2 || !wif3) {
      return res.status(400).json({
        status: false,
        error: "All WIF parameters (wif1, wif2, wif3) are required",
      });
    }
    if (!cprkh || !ctprkh) {
      return res.status(400).json({
        status: false,
        error: "cprkh and ctprkh parameters are required",
      });
    }

    // Prepare npm run deploy command with arguments
    const args = ["run", deployEnv];
    const env = {
      ...process.env,
      WIF: wif1,
      WIF2: wif2,
      WIF3: wif3,
      CPRKH: cprkh,
      CTPRKH: ctprkh,
      CLEAN: clean ? "true" : "false",
    };
    console.log(env);

    // Spawn npm process
    const npmProcess = spawnSync("npm", args, {
      env,
      shell: true,
      cwd: process.cwd(),
    });

    const stdout = npmProcess.stdout?.toString().trim();
    const stderr = npmProcess.stderr?.toString().trim();
    const status = npmProcess.status;
    let jsonObj = {};

    if (status !== 0) {
      console.error("NPM command failed:", stderr);
      return res
        .status(500)
        .json({ status: false, error: stderr || "NPM command failed" });
    }

    console.log("NPM command succeeded:", stdout);
    // Extract the JSON-like object using a regex
    const match = stdout.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        // Use Node's VM to safely evaluate the object-like string
        jsonObj = vm.runInNewContext(`(${match[0]})`);
        console.log("Extracted JSON:", jsonObj);
      } catch (e) {
        console.error("Failed to parse output:", e);
        return res
          .status(500)
          .json({ status: false, error: "Failed to parse deployment output" });
      }
    } else {
      console.error("No JSON found in output");
      return res
        .status(500)
        .json({ status: false, error: "No JSON found in deployment output" });
    }

    // Return the JSON response
    res.json({ status: true, addresses: jsonObj });
  } catch (err) {
    console.error("Endpoint error:", err);
    res.status(500).json({ status: false, error: err.message });
  }
});
const DEPLOYMENTS_FILE = path.join(process.cwd(), "deployments.json");
// New /check-deployment endpoint
app.post("/check-deployment", async (req, res) => {
  try {
    // Check if deployments.json file exists
    try {
      const fileContent = await fs.readFile(DEPLOYMENTS_FILE, "utf-8");
      const deployments = JSON.parse(fileContent);

      // Validate that the file contains expected contract addresses
      if (deployments && deployments.keyLogRegistryAddress) {
        return res.json({
          status: true,
          deployed: true,
          addresses: deployments,
          message: "Deployment found in deployments.json",
        });
      } else {
        return res.json({
          status: true,
          deployed: false,
          message:
            "deployments.json exists but does not contain valid contract addresses",
        });
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        // File does not exist
        return res.json({
          status: true,
          deployed: false,
          message: "No deployment found (deployments.json does not exist)",
        });
      }
      console.error("Error reading deployments.json:", error);
      return res.status(500).json({
        status: false,
        error: "Failed to read deployments.json: " + error.message,
      });
    }
  } catch (err) {
    console.error("Check-deployment error:", err);
    res.status(500).json({ status: false, error: err.message });
  }
});

app.post("/upgrade", async (req, res) => {
  try {
    const {
      upgradeEnv,
      bridgeProxyAddress,
      keyLogRegistryProxyAddress,
      wrappedTokenProxyAddresses,
      wif,
    } = req.body;

    // Prepare npm run deploy command with arguments
    const args = ["run", upgradeEnv];
    const env = {
      ...process.env,
      BRIDGE_PROXY_ADDRESS: bridgeProxyAddress,
      KEY_LOG_REGISTRY_PROXY_ADDRESS: keyLogRegistryProxyAddress,
      WRAPPED_TOKEN_PROXY_ADDRESSES: wrappedTokenProxyAddresses,
      WIF: wif,
    };
    console.log(env);

    // Spawn npm process
    const npmProcess = spawnSync("npm", args, {
      env,
      shell: true,
      cwd: process.cwd(),
    });

    const stdout = npmProcess.stdout?.toString().trim();
    const stderr = npmProcess.stderr?.toString().trim();
    const status = npmProcess.status;
    let jsonObj = {};

    if (status !== 0) {
      console.error("NPM command failed:", stderr);
      return res
        .status(500)
        .json({ status: false, error: stderr || "NPM command failed" });
    }

    console.log("NPM command succeeded:", stdout);
    // Extract the JSON-like object using a regex
    const extracted = extractFirstJsonLike(stdout);
    if (extracted) {
      try {
        // Use Node's VM to safely evaluate the object-like string
        jsonObj = vm.runInNewContext(`(${extracted})`);
        console.log("Extracted JSON:", jsonObj);
      } catch (e) {
        console.error("Failed to parse output:", e);
        return res
          .status(500)
          .json({ status: false, error: "Failed to parse deployment output" });
      }
    } else {
      console.error("No JSON found in output");
      return res
        .status(500)
        .json({ status: false, error: "No JSON found in deployment output" });
    }

    // Return the JSON response
    res.json({ status: true, addresses: jsonObj });
  } catch (err) {
    console.error("Endpoint error:", err);
    res.status(500).json({ status: false, error: err.message });
  }
});
function extractFirstJsonLike(str) {
  const start = str.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") depth--;

    if (depth === 0) {
      return str.slice(start, i + 1);
    }
  }
  return null;
}
// Increase server timeout to handle long-running deployments
const server = app.listen(port, () => {
  console.log(`Deploy server running at http://localhost:${port}`);
});
server.setTimeout(600000); // 10 minutes
