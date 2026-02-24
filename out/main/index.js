"use strict";
const electron = require("electron");
const path = require("node:path");
const node_url = require("node:url");
const os = require("node:os");
const node_child_process = require("node:child_process");
const util = require("node:util");
const __dirname$1 = path.dirname(node_url.fileURLToPath(require("url").pathToFileURL(__filename).href));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
path.join(process.env.APP_ROOT, "out/main");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "out/renderer");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new electron.BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    width: 1e3,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    // Mac-native hidden title bar
    vibrancy: "under-window",
    // Mac-native blur effect
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(process.env.APP_ROOT, "out/preload/index.js"),
      sandbox: false,
      // Required for deep filesystem access later
      contextIsolation: true
    }
  });
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
    win = null;
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
electron.app.whenReady().then(createWindow);
const execAsync = util.promisify(node_child_process.exec);
electron.ipcMain.handle("scan-system-junk", async (event, args) => {
  try {
    const scriptPath = path.join(process.env.APP_ROOT, "agents", "sys_purge_inquisitor.py");
    const { stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, {
      timeout: 12e4,
      maxBuffer: 50 * 1024 * 1024
      // 50MB max buffer
    });
    if (stderr && !stderr.includes("Error")) {
      console.warn("Python Stderr:", stderr);
    }
    const result = JSON.parse(stdout);
    return result;
  } catch (error) {
    console.error("Agent Execution Error:", error);
    return {
      status: "error",
      message: error.message || "Failed to scan system junk",
      code: error.code || "UNKNOWN"
    };
  }
});
electron.ipcMain.handle("scan-app-telemetry", async (event, args) => {
  try {
    const scriptPath = path.join(process.env.APP_ROOT, "agents", "app_telemetry_auditor.py");
    const { stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, {
      timeout: 12e4,
      maxBuffer: 100 * 1024 * 1024
      // 100MB max buffer
    });
    if (stderr && !stderr.includes("Error")) {
      console.warn("Python Stderr:", stderr);
    }
    const result = JSON.parse(stdout);
    return result;
  } catch (error) {
    console.error("App Telemetry Error:", error);
    return {
      status: "error",
      message: error.message || "Failed to scan application telemetry",
      code: error.code || "UNKNOWN"
    };
  }
});
electron.ipcMain.handle("execute-cleanup", async (event, targetPaths) => {
  try {
    if (!Array.isArray(targetPaths)) {
      return { status: "error", message: "targetPaths must be an array" };
    }
    if (targetPaths.length > 100) {
      return { status: "error", message: "Too many paths (max 100)" };
    }
    if (!targetPaths.every((p) => typeof p === "string")) {
      return { status: "error", message: "All paths must be strings" };
    }
    const scriptPath = path.join(process.env.APP_ROOT, "agents", "safe_purge_executor.py");
    const child = require("child_process").spawn("python3", [scriptPath]);
    let outputData = "";
    child.stdout.on("data", (data) => {
      outputData += data.toString();
    });
    child.stdin.write(JSON.stringify({ target_paths: targetPaths }));
    child.stdin.end();
    await new Promise((resolve) => {
      child.on("close", resolve);
    });
    const pythonResult = JSON.parse(outputData);
    if (pythonResult.status === "success" && pythonResult.script_path) {
      const { response } = await require("electron").dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Cancel", "Confirm Deletion"],
        defaultId: 1,
        cancelId: 0,
        title: "Confirm System Purge",
        message: `Are you sure you want to permanently delete these ${pythonResult.paths_to_delete} items?`,
        detail: `This action will run the generated script at ${pythonResult.script_path} and cannot be undone.`
      });
      if (response === 1) {
        const expectedDir = path.join(os.homedir(), ".mac_optimizer_purge_");
        if (!pythonResult.script_path.startsWith(expectedDir)) {
          throw new Error("Invalid script path: outside expected directory");
        }
        if (!pythonResult.script_path.endsWith(".sh")) {
          throw new Error("Invalid script path: must be .sh file");
        }
        await execAsync(`bash "${pythonResult.script_path}"`);
        return { status: "success", message: "Cleanup complete." };
      } else {
        return { status: "cancelled", message: "User cancelled." };
      }
    }
    return pythonResult;
  } catch (error) {
    console.error("Cleanup Execution Error:", error);
    return { status: "error", message: error.message };
  }
});
