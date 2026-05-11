const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { URL } = require("url");
const { pipeline } = require("stream/promises");

const PORT = Number(process.env.PORT || getArg("--port") || 8080);
const HOST = "0.0.0.0";
const ROOT_ARG = getArg("--root") || getRootArg();
const THIS_PC = process.argv.includes("--this-pc") || !ROOT_ARG || ["this-pc", "pc"].includes(String(ROOT_ARG).toLowerCase());
const ROOT = THIS_PC ? "" : path.resolve(ROOT_ARG);
const PUBLIC_DIR = path.join(__dirname, "public");
const STATE_FILE = path.join(__dirname, "server_state.json");
const LOG_FILES = [
  { name: "Server", path: path.join(__dirname, "server.log") },
  { name: "Server errors", path: path.join(__dirname, "server.err.log") },
  { name: "Watchdog", path: path.join(__dirname, "watchdog.log") }
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".flac": "audio/flac"
};

const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".flac"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".avif", ".svg"]);
const PDF_EXTENSIONS = new Set([".pdf"]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (isRoute(url, "/") || isRoute(url, "/browse")) {
      return sendHtml(res);
    }

    if (url.pathname === "/icon.svg" || url.pathname === "/favicon.svg") {
      return sendAppIcon(res);
    }

    if (url.pathname === "/manifest.webmanifest") {
      return sendManifest(res);
    }

    if (isRoute(url, "/assets")) {
      return sendPublicAsset(url, res);
    }

    if (isRoute(url, "/api/list")) {
      return sendDirectoryList(url, res);
    }

    if (url.pathname === "/api/places") {
      return sendPlaces(res);
    }

    if (isRoute(url, "/api/upload")) {
      return sendUpload(url, req, res);
    }

    if (isRoute(url, "/api/copy")) {
      return sendCopy(url, req, res);
    }

    if (isRoute(url, "/api/properties")) {
      return sendProperties(url, req, res);
    }

    if (url.pathname === "/api/logs") {
      return sendLogs(url, req, res);
    }

    if (isRoute(url, "/file")) {
      return sendFile(url, req, res);
    }

    sendText(res, 404, "Not found");
  } catch (error) {
    sendText(res, 500, error.message || "Server error");
  }
});

server.listen(PORT, HOST, () => {
  const urls = getLocalUrls(PORT);
  console.log(`Sharing: ${THIS_PC ? "This PC" : ROOT}`);
  console.log(`Open on this PC: http://localhost:${PORT}`);
  for (const url of urls) {
    console.log(`Open on phone:   ${url}`);
  }
});

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

function getRootArg() {
  let skipNext = false;

  for (const arg of process.argv.slice(2)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (arg === "--this-pc") continue;
    if (arg === "--port" || arg === "--root") {
      skipNext = true;
      continue;
    }
    if (arg.startsWith("--")) continue;

    return arg;
  }

  return "";
}

function isRoute(url, routePath) {
  if (routePath === "/") {
    return url.pathname === "/";
  }

  return url.pathname === routePath || url.pathname.startsWith(`${routePath}/`);
}

function getRoutePath(url, routePath) {
  const queryPath = url.searchParams.get("path");
  if (queryPath !== null) {
    return queryPath;
  }

  const prefix = `${routePath}/`;
  if (!url.pathname.startsWith(prefix)) {
    return "";
  }

  try {
    return decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    throw new Error("Invalid route path.");
  }
}

function getSafePath(relativePath = "") {
  if (THIS_PC) {
    const decoded = String(relativePath).replace(/\//g, path.sep);

    if (!/^[a-zA-Z]:($|[\\\/])/.test(decoded)) {
      throw new Error("Choose a drive first.");
    }

    const driveRoot = decoded.slice(0, 2).toUpperCase() + path.sep;
    const target = path.resolve(decoded);
    const targetUpper = target.toUpperCase();
    const allowed = targetUpper === driveRoot || targetUpper.startsWith(driveRoot);

    if (!allowed) {
      throw new Error("Path is outside this drive.");
    }

    return target;
  }

  const decoded = String(relativePath).replace(/^[/\\]+/, "");
  const target = path.resolve(ROOT, decoded);
  const allowed = target === ROOT || target.startsWith(ROOT + path.sep);

  if (!allowed) {
    throw new Error("Path is outside shared folder.");
  }

  return target;
}

async function sendPublicAsset(url, res) {
  const rel = getRoutePath(url, "/assets");
  const assetPath = path.resolve(PUBLIC_DIR, rel);
  const allowed = assetPath === PUBLIC_DIR || assetPath.startsWith(PUBLIC_DIR + path.sep);

  if (!allowed) {
    return sendText(res, 403, "Asset path is not allowed.");
  }

  return sendStaticFile(res, assetPath, "no-store");
}

async function sendStaticFile(res, filePath, cacheControl = "no-store") {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      return sendText(res, 404, "Not found");
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": cacheControl
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function sendDirectoryList(url, res) {
  const rel = getRoutePath(url, "/api/list");

  if (THIS_PC && !rel) {
    return sendJson(res, {
      root: "This PC",
      path: "",
      parent: "",
      items: getDrives().map((drive) => ({
        name: drive,
        path: `${drive}/`,
        directory: true,
        size: 0,
        modified: 0,
        video: false,
        audio: false,
        image: false,
        pdf: false,
        type: "drive"
      }))
    });
  }

  const dirPath = getSafePath(rel);
  const stat = await fs.promises.stat(dirPath);

  if (!stat.isDirectory()) {
    return sendText(res, 400, "Path is not a folder.");
  }

  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    try {
      const fullPath = path.join(dirPath, entry.name);
      const itemStat = await fs.promises.stat(fullPath);
      const ext = path.extname(entry.name).toLowerCase();
      const relative = getClientPath(fullPath);

      items.push({
        name: entry.name,
        path: relative,
        directory: entry.isDirectory(),
        size: itemStat.size,
        modified: itemStat.mtimeMs,
        video: VIDEO_EXTENSIONS.has(ext),
        audio: AUDIO_EXTENSIONS.has(ext),
        image: IMAGE_EXTENSIONS.has(ext),
        pdf: PDF_EXTENSIONS.has(ext),
        type: MIME[ext] || "application/octet-stream"
      });
    } catch {
      items.push({
        name: entry.name,
        path: getClientPath(path.join(dirPath, entry.name)),
        directory: entry.isDirectory(),
        size: 0,
        modified: 0,
        video: false,
        audio: false,
        image: false,
        pdf: false,
        type: "blocked"
      });
    }
  }

  items.sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });

  sendJson(res, {
    root: THIS_PC ? "This PC" : ROOT,
    path: getClientPath(dirPath),
    parent: getParentClientPath(dirPath),
    items
  });
}

function sendPlaces(res) {
  if (!THIS_PC) {
    return sendJson(res, {
      places: [
        {
          name: path.basename(ROOT) || ROOT,
          path: "",
          type: "folder"
        }
      ]
    });
  }

  const home = os.homedir();
  const common = [
    ["Desktop", path.join(home, "Desktop")],
    ["Downloads", path.join(home, "Downloads")],
    ["Documents", path.join(home, "Documents")],
    ["Pictures", path.join(home, "Pictures")],
    ["Videos", path.join(home, "Videos")],
    ["Music", path.join(home, "Music")]
  ];

  const places = [
    { name: "This PC", path: "", type: "pc" },
    ...common
      .filter(([, fullPath]) => fs.existsSync(fullPath))
      .map(([name, fullPath]) => ({
        name,
        path: getClientPath(fullPath),
        type: "folder"
      })),
    ...getDrives().map((drive) => ({
      name: `${drive} Drive`,
      path: `${drive}/`,
      type: "drive"
    }))
  ];

  sendJson(res, { places });
}

async function sendUpload(url, req, res) {
  if (req.method !== "POST") {
    return sendText(res, 405, "Upload requires POST.");
  }

  const rel = getRoutePath(url, "/api/upload");
  const requestedName = url.searchParams.get("name") || "upload";
  const target = await getUploadTarget(rel, requestedName);
  const writer = fs.createWriteStream(target.fullPath, { flags: "wx" });

  try {
    await pipeline(req, writer);
  } catch (error) {
    writer.destroy();
    try {
      await fs.promises.unlink(target.fullPath);
    } catch {
      // Ignore partial upload cleanup failures.
    }
    throw error;
  }

  const stat = await fs.promises.stat(target.fullPath);
  console.log(`Uploaded ${getClientPath(target.fullPath)} (${stat.size} bytes)`);
  sendJson(res, {
    name: path.basename(target.fullPath),
    path: getClientPath(target.fullPath),
    size: stat.size,
    modified: stat.mtimeMs
  });
}

async function getUploadTarget(relativePath, requestedName) {
  if (THIS_PC && !relativePath) {
    throw new Error("Open a folder before uploading.");
  }

  const dirPath = getSafePath(relativePath);
  const dirStat = await fs.promises.stat(dirPath);
  if (!dirStat.isDirectory()) {
    throw new Error("Upload target is not a folder.");
  }

  const fileName = safeFileName(requestedName);
  const target = path.resolve(dirPath, fileName);
  const relativeTarget = path.relative(dirPath, target);
  const allowed = relativeTarget && !relativeTarget.startsWith("..") && !path.isAbsolute(relativeTarget);
  if (!allowed) {
    throw new Error("Upload file name is not allowed.");
  }

  return { fullPath: await getAvailablePath(target) };
}

async function sendCopy(url, req, res) {
  if (req.method !== "POST") {
    return sendText(res, 405, "Copy requires POST.");
  }

  const rel = getRoutePath(url, "/api/copy");
  if (THIS_PC && !rel) {
    throw new Error("Open a folder before pasting.");
  }

  const dirPath = getSafePath(rel);
  const dirStat = await fs.promises.stat(dirPath);
  if (!dirStat.isDirectory()) {
    throw new Error("Paste target is not a folder.");
  }

  const body = await readJsonBody(req);
  const sources = Array.isArray(body.sources) ? body.sources.filter(Boolean) : [];
  if (!sources.length) {
    throw new Error("Choose something to copy first.");
  }

  const copied = [];
  for (const source of sources) {
    copied.push(await copyOne(source, dirPath));
  }

  console.log(`Copied ${copied.length} item${copied.length === 1 ? "" : "s"} to ${getClientPath(dirPath) || "shared root"}`);
  sendJson(res, { copied });
}

async function copyOne(sourceRel, dirPath) {
  const sourcePath = getSafePath(sourceRel);
  const sourceStat = await fs.promises.stat(sourcePath);

  if (sourceStat.isDirectory() && path.resolve(sourcePath) === path.resolve(path.parse(sourcePath).root)) {
    throw new Error("Copy a folder inside the drive, not the whole drive.");
  }

  const baseName = path.basename(sourcePath) || "copy";
  const targetPath = await getAvailablePath(path.join(dirPath, baseName));

  if (sourceStat.isDirectory() && isSameOrInside(targetPath, sourcePath)) {
    throw new Error("Cannot copy a folder into itself.");
  }

  if (sourceStat.isDirectory()) {
    await fs.promises.cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false
    });
  } else {
    await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  }

  const targetStat = await fs.promises.stat(targetPath);
  return {
    name: path.basename(targetPath),
    path: getClientPath(targetPath),
    directory: targetStat.isDirectory(),
    size: targetStat.size,
    modified: targetStat.mtimeMs
  };
}

function isSameOrInside(targetPath, parentPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sendProperties(url, req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 405, "Properties requires GET.");
  }

  const rel = getRoutePath(url, "/api/properties");
  if (THIS_PC && !rel) {
    throw new Error("Choose a file or folder first.");
  }

  const filePath = getSafePath(rel);
  const stat = await fs.promises.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const isDirectory = stat.isDirectory();
  let children = null;

  if (isDirectory) {
    children = await countChildren(filePath);
  }

  sendJson(res, {
    name: path.basename(filePath) || filePath,
    path: getClientPath(filePath),
    directory: isDirectory,
    file: stat.isFile(),
    size: stat.size,
    created: stat.birthtimeMs,
    modified: stat.mtimeMs,
    accessed: stat.atimeMs,
    extension: ext,
    type: isDirectory ? "Folder" : MIME[ext] || "File",
    children
  });
}

async function countChildren(dirPath) {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    let files = 0;
    let folders = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        folders += 1;
      } else {
        files += 1;
      }
    }

    return { total: entries.length, files, folders, inaccessible: false };
  } catch {
    return { total: 0, files: 0, folders: 0, inaccessible: true };
  }
}

async function sendLogs(url, req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 405, "Logs requires GET.");
  }

  const requestedLines = Number(url.searchParams.get("lines"));
  const lines = Math.min(Math.max(Number.isFinite(requestedLines) ? requestedLines : 160, 20), 500);
  const [state, ...logs] = await Promise.all([
    readServerState(),
    ...LOG_FILES.map((log) => tailFile(log, lines))
  ]);

  sendJson(res, {
    updatedAt: Date.now(),
    state,
    logs
  });
}

async function readServerState() {
  try {
    return JSON.parse(await fs.promises.readFile(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function tailFile(log, maxLines) {
  try {
    const text = await fs.promises.readFile(log.path, "utf8");
    const lines = text.split(/\r?\n/);
    return {
      name: log.name,
      exists: true,
      lineCount: lines.filter(Boolean).length,
      content: lines.slice(-maxLines).join("\n").trimEnd()
    };
  } catch (error) {
    return {
      name: log.name,
      exists: false,
      lineCount: 0,
      content: "",
      error: error.code === "ENOENT" ? "No log file yet." : error.message
    };
  }
}

function readJsonBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let done = false;

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (done) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxBytes) {
        done = true;
        reject(new Error("Request is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (done) return;
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", (error) => {
      if (!done) reject(error);
    });
  });
}

function safeFileName(name) {
  const base = path.basename(String(name || "upload")).replace(/[<>:"|?*\x00-\x1f]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base : "upload";
}

async function getAvailablePath(target) {
  const parsed = path.parse(target);
  let candidate = target;
  let count = 1;

  while (true) {
    try {
      await fs.promises.access(candidate);
      candidate = path.join(parsed.dir, `${parsed.name} (${count})${parsed.ext}`);
      count += 1;
    } catch {
      return candidate;
    }
  }
}

async function sendFile(url, req, res) {
  const rel = getRoutePath(url, "/file");
  const filePath = getSafePath(rel);
  const stat = await fs.promises.stat(filePath);

  if (!stat.isFile()) {
    return sendText(res, 400, "Path is not a file.");
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  const range = req.headers.range;

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(path.basename(filePath))}"`);

  if (!range) {
    res.writeHead(200, { "Content-Length": stat.size });
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(filePath).pipe(res);
  }

  const match = range.match(/bytes=(\d*)-(\d*)/);
  if (!match) {
    res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
    return res.end();
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : stat.size - 1;

  if (start >= stat.size || end >= stat.size || start > end) {
    res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
    return res.end();
  }

  res.writeHead(206, {
    "Content-Length": end - start + 1,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`
  });

  if (req.method === "HEAD") return res.end();
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

function sendHtml(res) {
  return sendStaticFile(res, path.join(PUBLIC_DIR, "index.html"), "no-store");
}

function sendAppIcon(res) {
  res.writeHead(200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=86400"
  });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="108" fill="#171b1f"/>
  <rect x="118" y="124" width="276" height="264" rx="42" fill="#4da3ff"/>
  <path d="M162 206h188M162 256h188M162 306h118" stroke="#111" stroke-width="34" stroke-linecap="round"/>
  <circle cx="346" cy="316" r="22" fill="#111"/>
</svg>`);
}

function sendManifest(res) {
  sendJson(res, {
    name: "Local Files",
    short_name: "Files",
    start_url: "/",
    display: "standalone",
    background_color: "#101315",
    theme_color: "#171b1f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable"
      }
    ]
  });
}

function appMarkSvg() {
  return '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="13" width="36" height="38" rx="7" fill="currentColor"/><path d="M22 27h20M22 35h20M22 43h12" stroke="#4da3ff" stroke-width="5" stroke-linecap="round"/><circle cx="43" cy="43" r="4" fill="#4da3ff"/></svg>';
}

function sendJson(res, data) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function getClientPath(fullPath) {
  if (THIS_PC) {
    return fullPath.replace(/\\/g, "/");
  }

  return path.relative(ROOT, fullPath).split(path.sep).join("/");
}

function getParentClientPath(fullPath) {
  if (THIS_PC) {
    const parsed = path.parse(fullPath);
    if (path.resolve(fullPath) === path.resolve(parsed.root)) {
      return "";
    }

    return getClientPath(path.dirname(fullPath));
  }

  return fullPath === ROOT ? "" : path.relative(ROOT, path.dirname(fullPath)).split(path.sep).join("/");
}

function getDrives() {
  if (process.platform !== "win32") {
    return ["/"];
  }

  const drives = [];

  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:`;
    try {
      if (fs.existsSync(`${drive}\\`)) {
        drives.push(drive);
      }
    } catch {
      // Ignore drives that Windows reports but cannot open.
    }
  }

  return drives;
}

function getLocalUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();

  for (const devices of Object.values(interfaces)) {
    for (const device of devices || []) {
      if (device.family === "IPv4" && !device.internal) {
        urls.push(`http://${device.address}:${port}`);
      }
    }
  }

  return urls;
}
