import { spawn } from "child_process";
import { randomBytes } from "crypto";
import express from "express";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3456;

// Load .env file
function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  const env = {};
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        env[key.trim()] = valueParts.join("=").trim();
      }
    }
  }
  return env;
}

const envConfig = loadEnvFile();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Endpoint to get env defaults (for form prefill)
app.get("/env-defaults", (req, res) => {
  res.json({
    sshUser: envConfig.SSH_USER || "",
    hasSshPassword: !!envConfig.SSH_PASSWORD,
    hasMcpAuthToken: !!envConfig.MCP_AUTH_TOKEN,
  });
});

// Endpoint to get constellationfs version from GHCR
app.get("/version-info", async (req, res) => {
  try {
    // Get anonymous bearer token for public package
    const tokenResponse = await fetch(
      "https://ghcr.io/token?scope=repository:aspects-ai/constellation-remote:pull"
    );
    const tokenData = await tokenResponse.json();
    const token = tokenData.token;

    // Fetch tags from GHCR
    const response = await fetch(
      "https://ghcr.io/v2/aspects-ai/constellation-remote/tags/list",
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!response.ok) {
      throw new Error(`GHCR API returned ${response.status}`);
    }

    const data = await response.json();
    const tags = data.tags || [];

    // Find the version tag (e.g., "v0.5.6") - prefer highest version
    const versionTags = tags
      .filter(t => /^v\d+\.\d+\.\d+$/.test(t))
      .sort((a, b) => {
        const [aMajor, aMinor, aPatch] = a.slice(1).split('.').map(Number);
        const [bMajor, bMinor, bPatch] = b.slice(1).split('.').map(Number);
        return bMajor - aMajor || bMinor - aMinor || bPatch - aPatch;
      });

    const latestVersion = versionTags[0] || null;

    res.json({
      version: latestVersion ? latestVersion.slice(1) : "unknown",
      imageTag: latestVersion || "latest",
      allTags: tags,
    });
  } catch (err) {
    res.json({ version: "unknown", imageTag: "latest", error: err.message });
  }
});

// Serve the HTML form
app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ConstellationFS Deploy Tool</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 700px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #f5f5f5;
    }
    h1 { color: #333; margin-bottom: 8px; }
    .subtitle { color: #666; margin-bottom: 32px; }
    form {
      background: white;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    fieldset {
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 20px;
    }
    legend {
      font-weight: 600;
      color: #333;
      padding: 0 8px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-group:last-child {
      margin-bottom: 0;
    }
    label {
      display: block;
      font-weight: 500;
      margin-bottom: 6px;
      color: #444;
    }
    input, select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }
    input:focus, select:focus {
      outline: none;
      border-color: #4a90d9;
      box-shadow: 0 0 0 3px rgba(74, 144, 217, 0.1);
    }
    .help-text {
      font-size: 12px;
      color: #888;
      margin-top: 4px;
    }
    .cloud-section {
      display: none;
    }
    .cloud-section.visible { display: block; }
    button {
      width: 100%;
      padding: 14px;
      background: #4a90d9;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 8px;
    }
    button:hover { background: #3a7bc8; }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }
    #output {
      margin-top: 24px;
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 16px;
      border-radius: 6px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      max-height: 400px;
      overflow-y: auto;
      display: none;
    }
    #output.visible { display: block; }
    .section-note {
      font-size: 13px;
      color: #666;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: #e8f4fd;
      border-radius: 4px;
    }
    .env-hint {
      color: #28a745;
    }
    .version-info {
      display: inline-block;
      background: #e8f4fd;
      color: #0066cc;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 13px;
      font-weight: 500;
      margin-left: 8px;
    }
    .version-info.loading {
      background: #f0f0f0;
      color: #999;
    }
  </style>
</head>
<body>
  <h1>ConstellationFS Deploy Tool <span id="versionBadge" class="version-info loading">loading...</span></h1>
  <p class="subtitle">Deploy a ConstellationFS remote backend VM</p>

  <form id="deployForm">
    <fieldset>
      <legend>Cloud Provider</legend>
      <div class="form-group">
        <label for="cloudProvider">Provider *</label>
        <select id="cloudProvider" name="cloudProvider">
          <option value="azure">Azure</option>
          <option value="gcp">Google Cloud Platform</option>
        </select>
      </div>
    </fieldset>

    <!-- Azure Configuration -->
    <div id="azureConfig" class="cloud-section">
      <fieldset>
        <legend>Azure Configuration</legend>
        <div class="form-group">
          <label for="azureSubscription">Subscription ID *</label>
          <input type="text" id="azureSubscription" name="azureSubscription" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
        </div>
        <div class="form-group">
          <label for="azureResourceGroup">Resource Group *</label>
          <input type="text" id="azureResourceGroup" name="azureResourceGroup" placeholder="my-resource-group">
        </div>
        <div class="form-group">
          <label for="azureVmName">VM Name *</label>
          <input type="text" id="azureVmName" name="azureVmName" value="constellation-remote" placeholder="constellation-remote">
        </div>
        <div class="form-group">
          <label for="azureLocation">Location</label>
          <input type="text" id="azureLocation" name="azureLocation" value="westus2" placeholder="westus2">
        </div>
        <div class="form-group">
          <label for="azureVmSize">VM Size</label>
          <input type="text" id="azureVmSize" name="azureVmSize" value="Standard_B1ms" placeholder="Standard_B1ms">
          <div class="help-text">Standard_B1s (~$8/mo), Standard_B1ms (~$15/mo), Standard_B2s (~$30/mo)</div>
        </div>
      </fieldset>
    </div>

    <!-- GCP Configuration -->
    <div id="gcpConfig" class="cloud-section">
      <fieldset>
        <legend>GCP Configuration</legend>
        <div class="form-group">
          <label for="gcpProject">GCP Project ID *</label>
          <input type="text" id="gcpProject" name="gcpProject" placeholder="my-project-id">
        </div>
        <div class="form-group">
          <label for="gcpVmName">VM Instance Name *</label>
          <input type="text" id="gcpVmName" name="gcpVmName" value="constellation-remote" placeholder="constellation-remote">
        </div>
        <div class="form-group">
          <label for="gcpZone">Zone</label>
          <input type="text" id="gcpZone" name="gcpZone" value="us-central1-a" placeholder="us-central1-a">
        </div>
        <div class="form-group">
          <label for="gcpMachineType">Machine Type</label>
          <input type="text" id="gcpMachineType" name="gcpMachineType" value="e2-medium" placeholder="e2-medium">
        </div>
      </fieldset>
    </div>

    <fieldset>
      <legend>SSH Configuration</legend>
      <div class="section-note">Configure SSH access credentials for the VM</div>
      <div class="form-group">
        <label for="sshUser">SSH Username *</label>
        <input type="text" id="sshUser" name="sshUser" value="dev" placeholder="dev">
      </div>
      <div class="form-group">
        <label for="sshPassword">SSH Password *</label>
        <input type="password" id="sshPassword" name="sshPassword" placeholder="secure-password">
        <div class="help-text env-hint" id="sshPasswordHint" style="display:none;">Using value from .env</div>
      </div>
    </fieldset>

    <fieldset>
      <legend>MCP Server Configuration</legend>
      <div class="form-group">
        <label for="mcpPort">MCP Port</label>
        <input type="text" id="mcpPort" name="mcpPort" value="3001" placeholder="3001">
      </div>
      <div class="form-group">
        <label for="mcpAuthToken">MCP Auth Token *</label>
        <input type="text" id="mcpAuthToken" name="mcpAuthToken" placeholder="(will auto-generate if empty)">
        <div class="help-text env-hint" id="mcpAuthTokenHint" style="display:none;">Using value from .env</div>
        <div class="help-text">Leave empty to auto-generate a secure token</div>
      </div>
      <div class="form-group">
        <label for="workspaceRoot">Workspace Root</label>
        <input type="text" id="workspaceRoot" name="workspaceRoot" value="/constellationfs" placeholder="/constellationfs">
        <div class="help-text">Base directory for workspaces. Must match CONSTELLATION_WORKSPACE_ROOT in your client.</div>
      </div>
    </fieldset>

    <button type="submit" id="submitBtn">Create VM</button>
  </form>

  <div id="output"></div>

  <script>
    const form = document.getElementById('deployForm');
    const output = document.getElementById('output');
    const submitBtn = document.getElementById('submitBtn');
    const cloudProvider = document.getElementById('cloudProvider');
    const azureConfig = document.getElementById('azureConfig');
    const gcpConfig = document.getElementById('gcpConfig');

    // Fields to persist (exclude sensitive fields)
    const STORAGE_KEY = 'constellation-deploy-config';
    const PERSIST_FIELDS = [
      'cloudProvider',
      'azureSubscription', 'azureResourceGroup', 'azureVmName', 'azureLocation', 'azureVmSize',
      'gcpProject', 'gcpVmName', 'gcpZone', 'gcpMachineType',
      'sshUser', 'mcpPort', 'workspaceRoot'
    ];

    // Show/hide cloud-specific sections
    function updateCloudSections() {
      const provider = cloudProvider.value;
      azureConfig.classList.toggle('visible', provider === 'azure');
      gcpConfig.classList.toggle('visible', provider === 'gcp');
    }

    // Load saved values on page load
    function loadSavedValues() {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        PERSIST_FIELDS.forEach(field => {
          const el = document.getElementById(field);
          if (el && saved[field]) {
            el.value = saved[field];
          }
        });
        updateCloudSections();
      } catch (e) {
        console.error('Failed to load saved values:', e);
      }
    }

    // Save values before submit
    function saveValues() {
      try {
        const values = {};
        PERSIST_FIELDS.forEach(field => {
          const el = document.getElementById(field);
          if (el) values[field] = el.value;
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
      } catch (e) {
        console.error('Failed to save values:', e);
      }
    }

    // Set up event listeners
    cloudProvider.addEventListener('change', updateCloudSections);

    // Load saved values after listeners are registered
    loadSavedValues();
    updateCloudSections();

    // Fetch and display constellationfs version from GHCR
    fetch('/version-info')
      .then(r => r.json())
      .then(data => {
        const badge = document.getElementById('versionBadge');
        if (data.version && data.version !== 'unknown') {
          badge.textContent = 'v' + data.version;
        } else {
          badge.textContent = data.error ? 'auth required' : 'unknown';
          console.log(data.error);
        }
        badge.classList.remove('loading');
      })
      .catch(() => {
        document.getElementById('versionBadge').textContent = 'unknown';
      });

    // Check for env defaults and show hints
    let envDefaults = {};
    fetch('/env-defaults')
      .then(r => r.json())
      .then(data => {
        envDefaults = data;
        if (data.hasSshPassword) {
          document.getElementById('sshPasswordHint').style.display = 'block';
          document.getElementById('sshPassword').placeholder = '(using .env value)';
        }
        if (data.hasMcpAuthToken) {
          document.getElementById('mcpAuthTokenHint').style.display = 'block';
          document.getElementById('mcpAuthToken').placeholder = '(using .env value)';
        }
        if (data.sshUser) {
          document.getElementById('sshUser').value = data.sshUser;
        }
      })
      .catch(() => {});

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      saveValues();

      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      // Mark if we should use env values
      data.useEnvSshPassword = envDefaults.hasSshPassword && !data.sshPassword;
      data.useEnvMcpAuthToken = envDefaults.hasMcpAuthToken && !data.mcpAuthToken;

      output.classList.add('visible');
      output.textContent = 'Starting VM creation...\\n';
      submitBtn.disabled = true;

      try {
        const response = await fetch('/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          output.textContent += text;
          output.scrollTop = output.scrollHeight;
        }
      } catch (err) {
        output.textContent += 'Error: ' + err.message + '\\n';
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>
  `);
});

// Handle deployment
app.post("/deploy", async (req, res) => {
  const {
    cloudProvider,
    // Azure
    azureSubscription,
    azureResourceGroup,
    azureVmName,
    azureLocation = "westus2",
    azureVmSize = "Standard_B1ms",
    // GCP
    gcpProject,
    gcpVmName,
    gcpZone = "us-central1-a",
    gcpMachineType = "e2-medium",
    // Common
    sshUser: formSshUser = "dev",
    sshPassword: formSshPassword,
    mcpPort = "3001",
    mcpAuthToken: formMcpAuthToken,
    workspaceRoot = "/constellationfs",
    useEnvSshPassword,
    useEnvMcpAuthToken,
  } = req.body;

  // Use env values if flagged
  const sshUser = envConfig.SSH_USER || formSshUser;
  const sshPassword = useEnvSshPassword ? envConfig.SSH_PASSWORD : formSshPassword;
  let mcpAuthToken = useEnvMcpAuthToken ? envConfig.MCP_AUTH_TOKEN : formMcpAuthToken;

  // Auto-generate MCP auth token if not provided
  if (!mcpAuthToken) {
    mcpAuthToken = randomBytes(32).toString('hex');
  }

  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Transfer-Encoding", "chunked");

  const log = (msg) => res.write(msg + "\n");
  const logError = (msg) => res.write(`[ERROR] ${msg}\n`);
  const logSuccess = (msg) => res.write(`[SUCCESS] ${msg}\n`);

  if (cloudProvider === "azure") {
    await deployAzure({
      subscription: azureSubscription,
      resourceGroup: azureResourceGroup,
      vmName: azureVmName,
      location: azureLocation,
      vmSize: azureVmSize,
      sshUser,
      sshPassword,
      mcpPort,
      mcpAuthToken,
      workspaceRoot,
      log,
      logError,
      logSuccess,
    });
  } else if (cloudProvider === "gcp") {
    await deployGCP({
      project: gcpProject,
      vmName: gcpVmName,
      zone: gcpZone,
      machineType: gcpMachineType,
      sshUser,
      sshPassword,
      mcpPort,
      mcpAuthToken,
      workspaceRoot,
      log,
      logError,
      logSuccess,
    });
  } else {
    logError(`Unknown cloud provider: ${cloudProvider}`);
  }

  res.end();
});

// Azure deployment
async function deployAzure({
  subscription,
  resourceGroup,
  vmName,
  location,
  vmSize,
  sshUser,
  sshPassword,
  mcpPort,
  mcpAuthToken,
  workspaceRoot,
  log,
  logError,
  logSuccess,
}) {
  log(`=== ConstellationFS Azure VM Deploy ===`);
  log(`Subscription: ${subscription}`);
  log(`Resource Group: ${resourceGroup}`);
  log(`VM: ${vmName} (${vmSize}) in ${location}`);
  log(`MCP Port: ${mcpPort}`);
  log(`Workspace Root: ${workspaceRoot}`);
  log(``);

  // Load and customize startup script
  log(`Preparing startup script...`);
  const startupScriptPath = path.join(__dirname, "..", "azure-vm-startup.sh");
  let startupScript;
  try {
    startupScript = readFileSync(startupScriptPath, "utf-8");
  } catch (err) {
    logError(`Failed to read startup script: ${err.message}`);
    return;
  }

  // Replace placeholders
  startupScript = startupScript
    .replace(/__MCP_AUTH_TOKEN__/g, mcpAuthToken)
    .replace(/__MCP_PORT__/g, mcpPort)
    .replace(/__SSH_USERS__/g, `${sshUser}:${sshPassword}`)
    .replace(/__WORKSPACE_ROOT__/g, workspaceRoot);

  // Write startup script to temp file
  const tempScriptPath = path.join(tmpdir(), `constellation-azure-startup-${Date.now()}.sh`);
  writeFileSync(tempScriptPath, startupScript);
  log(`Startup script written to temp file`);

  // Check if VM already exists
  log(`Checking if VM ${vmName} already exists...`);
  const existsCheck = await runCommandCapture("az", [
    "vm", "show",
    "--subscription", subscription,
    "--resource-group", resourceGroup,
    "--name", vmName,
    "--query", "name",
    "-o", "tsv",
  ]);

  if (existsCheck.trim() === vmName) {
    log(`VM ${vmName} exists. Deleting...`);
    const deleteSuccess = await runCommand("az", [
      "vm", "delete",
      "--subscription", subscription,
      "--resource-group", resourceGroup,
      "--name", vmName,
      "--yes",
    ], log);

    if (!deleteSuccess) {
      logError("Failed to delete existing VM");
      try { unlinkSync(tempScriptPath); } catch (e) { }
      return;
    }
    logSuccess(`Deleted existing VM ${vmName}`);
    log(``);
  } else {
    log(`No existing VM found, proceeding with creation...`);
  }

  log(`Creating VM ${vmName}...`);
  log(``);

  // Create VM
  const createVmArgs = [
    "vm", "create",
    "--subscription", subscription,
    "--resource-group", resourceGroup,
    "--name", vmName,
    "--location", location,
    "--size", vmSize,
    "--image", "Ubuntu2204",
    "--admin-username", "azureuser",
    "--generate-ssh-keys",
    "--public-ip-sku", "Standard",
    "--custom-data", tempScriptPath,
  ];

  const vmSuccess = await runCommand("az", createVmArgs, log);

  // Clean up temp file
  try {
    unlinkSync(tempScriptPath);
  } catch (e) {
    // Ignore cleanup errors
  }

  if (!vmSuccess) {
    logError("VM creation failed!");
    return;
  }

  logSuccess(`VM ${vmName} created!`);
  log(``);

  // Open ports for SSH (2222) and MCP in a single call
  // Use priority 900 to avoid conflict with Azure's default-allow-ssh rule at priority 1000
  log(`Opening ports 2222 (SSH) and ${mcpPort} (MCP)...`);
  await runCommand("az", [
    "vm", "open-port",
    "--subscription", subscription,
    "--resource-group", resourceGroup,
    "--name", vmName,
    "--port", `2222,${mcpPort}`,
    "--priority", "900",
  ], log);

  // Get public IP
  log(`Getting VM public IP...`);
  const ipResult = await runCommandCapture("az", [
    "vm", "show",
    "--subscription", subscription,
    "--resource-group", resourceGroup,
    "--name", vmName,
    "--show-details",
    "--query", "publicIps",
    "-o", "tsv",
  ]);

  const publicIp = ipResult.trim();
  log(`Public IP: ${publicIp}`);
  log(``);

  log(`=== Setup Complete ===`);
  log(``);
  log(`The VM is starting up and running the setup script.`);
  log(`This may take 2-3 minutes for Docker to install and start.`);
  log(``);
  log(`Once ready, connect via:`);
  log(`  SSH: ssh ${sshUser}@${publicIp} -p 2222`);
  log(`  MCP: http://${publicIp}:${mcpPort}/health`);
  log(``);
  log(`MCP Auth Token: ${mcpAuthToken}`);
  log(``);
  log(`For web-demo, set these environment variables:`);
  log(`  REMOTE_MCP_URL=http://${publicIp}:${mcpPort}`);
  log(`  REMOTE_MCP_AUTH_TOKEN=${mcpAuthToken}`);
  log(``);
}

// GCP deployment
async function deployGCP({
  project,
  vmName,
  zone,
  machineType,
  sshUser,
  sshPassword,
  mcpPort,
  mcpAuthToken,
  workspaceRoot,
  log,
  logError,
  logSuccess,
}) {
  log(`=== ConstellationFS GCP VM Deploy ===`);
  log(`Project: ${project}`);
  log(`VM: ${vmName} (${machineType}) in ${zone}`);
  log(`MCP Port: ${mcpPort}`);
  log(`Workspace Root: ${workspaceRoot}`);
  log(``);

  // Load and customize startup script
  log(`Preparing startup script...`);
  const startupScriptPath = path.join(__dirname, "..", "gcp-vm-startup.sh");
  let startupScript;
  try {
    startupScript = readFileSync(startupScriptPath, "utf-8");
  } catch (err) {
    logError(`Failed to read startup script: ${err.message}`);
    return;
  }

  // Replace placeholders
  startupScript = startupScript
    .replace(/__MCP_AUTH_TOKEN__/g, mcpAuthToken)
    .replace(/__MCP_PORT__/g, mcpPort)
    .replace(/__SSH_USERS__/g, `${sshUser}:${sshPassword}`)
    .replace(/__WORKSPACE_ROOT__/g, workspaceRoot);

  // Write startup script to temp file
  const tempScriptPath = path.join(tmpdir(), `constellation-gcp-startup-${Date.now()}.sh`);
  writeFileSync(tempScriptPath, startupScript);
  log(`Startup script written to temp file`);

  // Check if VM already exists
  log(`Checking if VM ${vmName} already exists...`);
  const existsCheck = await runCommandCapture("gcloud", [
    "compute", "instances", "describe",
    vmName,
    "--zone", zone,
    "--project", project,
    "--format", "value(name)",
  ]);

  if (existsCheck.trim() === vmName) {
    log(`VM ${vmName} exists. Deleting...`);
    const deleteSuccess = await runCommand("gcloud", [
      "compute", "instances", "delete",
      vmName,
      "--zone", zone,
      "--project", project,
      "--quiet",
    ], log);

    if (!deleteSuccess) {
      logError("Failed to delete existing VM");
      try { unlinkSync(tempScriptPath); } catch (e) { }
      return;
    }
    logSuccess(`Deleted existing VM ${vmName}`);
    log(``);
  } else {
    log(`No existing VM found, proceeding with creation...`);
  }

  log(`Creating VM ${vmName}...`);
  log(``);

  // Create VM
  const createVmArgs = [
    "compute", "instances", "create",
    vmName,
    "--project", project,
    "--zone", zone,
    "--machine-type", machineType,
    "--image-family", "ubuntu-2204-lts",
    "--image-project", "ubuntu-os-cloud",
    "--boot-disk-size", "20GB",
    "--tags", "constellation-ssh,constellation-mcp",
    "--scopes", "storage-full",
    "--metadata-from-file", `startup-script=${tempScriptPath}`,
  ];

  const vmSuccess = await runCommand("gcloud", createVmArgs, log);

  // Clean up temp file
  try {
    unlinkSync(tempScriptPath);
  } catch (e) {
    // Ignore cleanup errors
  }

  if (!vmSuccess) {
    logError("VM creation failed!");
    return;
  }

  logSuccess(`VM ${vmName} created!`);
  log(``);

  // Get external IP
  log(`Getting VM external IP...`);
  const ipResult = await runCommandCapture("gcloud", [
    "compute", "instances", "describe",
    vmName,
    "--zone", zone,
    "--project", project,
    "--format", "get(networkInterfaces[0].accessConfigs[0].natIP)",
  ]);

  const externalIp = ipResult.trim();
  log(`External IP: ${externalIp}`);
  log(``);

  log(`=== Setup Complete ===`);
  log(``);
  log(`The VM is starting up and running the setup script.`);
  log(`This may take 2-3 minutes for Docker to install and start.`);
  log(``);
  log(`Once ready, connect via:`);
  log(`  SSH: ssh ${sshUser}@${externalIp} -p 2222`);
  log(`  MCP: http://${externalIp}:${mcpPort}/health`);
  log(``);
  log(`MCP Auth Token: ${mcpAuthToken}`);
  log(``);
  log(`If ports are blocked, create firewall rules:`);
  log(`  gcloud compute firewall-rules create allow-constellation-ssh \\`);
  log(`    --allow tcp:2222 --target-tags constellation-ssh --project ${project}`);
  log(`  gcloud compute firewall-rules create allow-constellation-mcp \\`);
  log(`    --allow tcp:${mcpPort} --target-tags constellation-mcp --project ${project}`);
  log(``);
  log(`For web-demo, set these environment variables:`);
  log(`  REMOTE_MCP_URL=http://${externalIp}:${mcpPort}`);
  log(`  REMOTE_MCP_AUTH_TOKEN=${mcpAuthToken}`);
  log(``);
}

// Helper to run a command and stream output
function runCommand(cmd, args, log) {
  return new Promise((resolve) => {
    log(`> ${cmd} ${args.slice(0, 8).join(" ")}${args.length > 8 ? ' ...' : ''}`);
    log(``);

    // Source shell config to get PATH
    const fullCommand = `${cmd} ${args.map((a) => `'${a}'`).join(" ")}`;
    const wrappedCommand = `source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null; ${fullCommand}`;
    const proc = spawn(wrappedCommand, [], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.env.SHELL || "/bin/bash",
    });

    proc.stdout.on("data", (data) => log(data.toString()));
    proc.stderr.on("data", (data) => log(data.toString()));

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", (err) => {
      log(`Failed to start process: ${err.message}`);
      resolve(false);
    });
  });
}

// Helper to run a command and capture output
function runCommandCapture(cmd, args) {
  return new Promise((resolve) => {
    const fullCommand = `${cmd} ${args.map((a) => `'${a}'`).join(" ")}`;
    const wrappedCommand = `source ~/.zshrc 2>/dev/null || source ~/.bashrc 2>/dev/null; ${fullCommand}`;

    let output = "";
    const proc = spawn(wrappedCommand, [], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.env.SHELL || "/bin/bash",
    });

    proc.stdout.on("data", (data) => {
      output += data.toString();
    });

    proc.on("close", () => {
      resolve(output);
    });

    proc.on("error", () => {
      resolve("");
    });
  });
}

app.listen(PORT, () => {
  console.log(`\n🚀 ConstellationFS Deploy Tool`);
  console.log(`   Open http://localhost:${PORT} in your browser\n`);
});
