import express from 'express';
import cors from 'cors';
import { spawn, spawnSync } from 'child_process';
import vm from 'vm';

const app = express();
const port = 3001;
app.use(cors());
app.use(express.json());

app.get('/deploy', async (req, res) => {
  try {
    const wif = req.query.wif;
    const clean = req.query.clean === 'true'; // Convert string to boolean

    // Validate inputs
    if (!wif) {
      return res.status(400).json({ status: false, error: 'WIF parameter is required' });
    }

    // Prepare npm run deploy command with arguments
    const args = ['run', 'deploy'];
    process.env.WIF = wif
    process.env.CLEAN = clean
    // Spawn npm process
    const npmProcess = spawnSync('npm', args, {
      env: { ...process.env },
      shell: true,
      cwd: process.cwd(), // Run in project directory
    });
    const stdout = npmProcess.stdout?.toString().trim();
    const stderr = npmProcess.stderr?.toString().trim();
    const status = npmProcess.status;
    let jsonObj = {};
    if (status !== 0) {
      console.error('NPM command failed:');
      if (stderr) console.error(stderr);
    } else {
      console.log('NPM command succeeded:');
      if (stdout) console.log(stdout);
      // Extract the JSON-like object using a regex
      const match = stdout.match(/\{[\s\S]*?\}/);
      if (match) {
        try {
          // Use Node's VM to safely evaluate the object-like string
          jsonObj = vm.runInNewContext(`(${match[0]})`);
          console.log('Extracted JSON:', jsonObj);
        } catch (e) {
          console.error('Failed to parse output:', e);
        }
      } else {
        console.error('No JSON found in output');
      }
    }

    // Return the JSON response
    res.json({ status: true, addresses: jsonObj});
  } catch (err) {
    console.error('Endpoint error:', err);
    res.status(500).json({ status: false, error: err.message });
  }
});

// Increase server timeout to handle long-running deployments
const server = app.listen(port, () => {
  console.log(`Deploy server running at http://localhost:${port}`);
});
server.setTimeout(600000); // 10 minutes