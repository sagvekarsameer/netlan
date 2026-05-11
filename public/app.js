const store = createStore({
  currentPath: "",
  parentPath: "",
  items: [],
  places: [],
  viewMode: localStorage.getItem("viewMode") || "grid",
  themeMode: localStorage.getItem("themeMode") || "light",
  searchTerm: "",
  loading: false,
  error: "",
  statusMessage: "",
  statusType: "",
  clipboardItems: loadClipboardItems(),
  backStack: [],
  forwardStack: []
});

let activeLoadId = 0;
let logsTimer = 0;

const placesEl = document.getElementById("places");
const listWrap = document.getElementById("listWrap");
const breadcrumb = document.getElementById("breadcrumb");
const content = document.querySelector(".content");
const themeMeta = document.querySelector('meta[name="theme-color"]');
const backButton = document.getElementById("backButton");
const forwardButton = document.getElementById("forwardButton");
const rootButton = document.getElementById("rootButton");
const upButton = document.getElementById("upButton");
const search = document.getElementById("search");
const fileInput = document.getElementById("fileInput");
const uploadButton = document.getElementById("uploadButton");
const pasteTextButton = document.getElementById("pasteTextButton");
const pasteFilesButton = document.getElementById("pasteFilesButton");
const logsButton = document.getElementById("logsButton");
const themeSwitch = document.getElementById("themeSwitch");
const gridMode = document.getElementById("gridMode");
const detailsMode = document.getElementById("detailsMode");
const summaryTitle = document.getElementById("summaryTitle");
const summaryCount = document.getElementById("summaryCount");
const statusLeft = document.getElementById("statusLeft");
const statusRight = document.getElementById("statusRight");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalOpen = document.getElementById("modalOpen");
const modalClose = document.getElementById("modalClose");
const textModal = document.getElementById("textModal");
const textForm = document.getElementById("textForm");
const textFileName = document.getElementById("textFileName");
const textContent = document.getElementById("textContent");
const textModalClose = document.getElementById("textModalClose");
const propertiesModal = document.getElementById("propertiesModal");
const propertiesTitle = document.getElementById("propertiesTitle");
const propertiesBody = document.getElementById("propertiesBody");
const propertiesClose = document.getElementById("propertiesClose");
const logsModal = document.getElementById("logsModal");
const logsBody = document.getElementById("logsBody");
const logsClose = document.getElementById("logsClose");
const refreshLogsButton = document.getElementById("refreshLogsButton");

store.subscribe(renderApp);

backButton.addEventListener("click", goBack);
forwardButton.addEventListener("click", goForward);
rootButton.addEventListener("click", () => navigate(""));
upButton.addEventListener("click", () => navigate(store.getState().parentPath));
search.addEventListener("input", () => store.setState({ searchTerm: search.value }));
uploadButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  uploadFiles([...fileInput.files]);
  fileInput.value = "";
});
pasteTextButton.addEventListener("click", () => openTextModal());
pasteFilesButton.addEventListener("click", pasteCopiedItems);
logsButton.addEventListener("click", openLogsModal);
themeSwitch.addEventListener("change", () => setThemeMode(themeSwitch.checked ? "dark" : "light"));
gridMode.addEventListener("click", () => setViewMode("grid"));
detailsMode.addEventListener("click", () => setViewMode("details"));
modalClose.addEventListener("click", closePreview);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closePreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePreview();
    closeTextModal();
    closeProperties();
    closeLogsModal();
  }
});
document.addEventListener("paste", handlePaste);
content.addEventListener("dragover", (event) => {
  event.preventDefault();
  content.classList.add("drop-active");
});
content.addEventListener("dragleave", () => content.classList.remove("drop-active"));
content.addEventListener("drop", (event) => {
  event.preventDefault();
  content.classList.remove("drop-active");
  uploadFiles([...event.dataTransfer.files]);
});
textModalClose.addEventListener("click", closeTextModal);
textModal.addEventListener("click", (event) => {
  if (event.target === textModal) closeTextModal();
});
textForm.addEventListener("submit", saveTextFile);
propertiesClose.addEventListener("click", closeProperties);
propertiesModal.addEventListener("click", (event) => {
  if (event.target === propertiesModal) closeProperties();
});
logsClose.addEventListener("click", closeLogsModal);
logsModal.addEventListener("click", (event) => {
  if (event.target === logsModal) closeLogsModal();
});
refreshLogsButton.addEventListener("click", loadLogs);
window.addEventListener("popstate", () => {
  load(routePathFromLocation(), { history: false, route: false });
});

start();

function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    setState(update) {
      const patch = typeof update === "function" ? update(state) : update;
      state = { ...state, ...patch };
      for (const listener of listeners) {
        listener(state);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    }
  };
}

async function start() {
  await loadPlaces();
  await load(routePathFromLocation(), { history: false, route: "replace" });
}

async function loadPlaces() {
  try {
    const response = await fetch("/api/places");
    const data = await response.json();
    store.setState({ places: data.places || [] });
  } catch {
    store.setState({ places: [{ name: "This PC", path: "", type: "pc" }] });
  }
}

function navigate(folderPath) {
  return load(folderPath, { history: true });
}

function goBack() {
  const { backStack, forwardStack, currentPath } = store.getState();
  if (!backStack.length) return;

  const previous = backStack[backStack.length - 1];
  store.setState({
    backStack: backStack.slice(0, -1),
    forwardStack: [...forwardStack, currentPath]
  });
  load(previous, { history: false, route: "replace" });
}

function goForward() {
  const { backStack, forwardStack, currentPath } = store.getState();
  if (!forwardStack.length) return;

  const next = forwardStack[forwardStack.length - 1];
  store.setState({
    backStack: [...backStack, currentPath],
    forwardStack: forwardStack.slice(0, -1)
  });
  load(next, { history: false, route: "replace" });
}

async function load(folderPath, options = {}) {
  const loadId = ++activeLoadId;
  const nextPath = folderPath || "";
  const previousState = store.getState();

  store.setState({ loading: true, error: "", statusMessage: "", statusType: "" });
  closePreview();

  try {
    const response = await fetch(listUrl(nextPath));
    if (!response.ok) throw new Error(await response.text());

    const data = await response.json();
    if (loadId !== activeLoadId) return;

    const nextCurrentPath = data.path || "";
    if (options.route !== false) {
      updateRoute(nextCurrentPath, options.route || (options.history ? "push" : "replace"));
    }

    store.setState(() => {
      const nextState = {
        currentPath: nextCurrentPath,
        parentPath: data.parent || "",
        items: data.items || [],
        searchTerm: "",
        loading: false,
        error: ""
      };

      if (options.history && nextCurrentPath !== previousState.currentPath) {
        nextState.backStack = [...previousState.backStack, previousState.currentPath];
        nextState.forwardStack = [];
      }

      return nextState;
    });
  } catch (error) {
    if (loadId !== activeLoadId) return;
    store.setState({
      loading: false,
      error: error.message || "Open failed"
    });
  }
}

function setViewMode(mode) {
  localStorage.setItem("viewMode", mode);
  store.setState({ viewMode: mode });
}

function setThemeMode(mode) {
  localStorage.setItem("themeMode", mode);
  store.setState({ themeMode: mode });
}

async function uploadFiles(files) {
  const uploadable = files.filter(Boolean);
  if (!uploadable.length) return;

  const { currentPath } = store.getState();
  store.setState({
    loading: true,
    error: "",
    statusMessage: `Uploading ${uploadable.length} item${uploadable.length === 1 ? "" : "s"}`,
    statusType: "loading"
  });

  try {
    for (const file of uploadable) {
      await uploadBlob(file, file.name || "upload");
    }

    await load(currentPath, { history: false, route: false });
    store.setState({
      statusMessage: `Uploaded ${uploadable.length} item${uploadable.length === 1 ? "" : "s"}`,
      statusType: "success"
    });
  } catch (error) {
    store.setState({
      loading: false,
      statusMessage: error.message || "Upload failed",
      statusType: "error"
    });
  }
}

async function uploadBlob(blob, fileName) {
  const { currentPath } = store.getState();
  const response = await fetch(uploadUrl(currentPath, fileName), {
    method: "POST",
    body: blob
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

function openTextModal(initialText = "") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  textFileName.value = `mobile-note-${stamp}.txt`;
  textContent.value = initialText;
  textModal.hidden = false;
  syncModalOpenClass();
  window.setTimeout(() => textContent.focus(), 0);
}

function closeTextModal() {
  textModal.hidden = true;
  syncModalOpenClass();
}

async function saveTextFile(event) {
  event.preventDefault();
  const text = textContent.value;
  const fileName = textFileName.value.trim() || "mobile-note.txt";

  try {
    store.setState({
      loading: true,
      error: "",
      statusMessage: "Saving text",
      statusType: "loading"
    });
    await uploadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), fileName);
    closeTextModal();
    await load(store.getState().currentPath, { history: false, route: false });
    store.setState({ statusMessage: "Text saved", statusType: "success" });
  } catch (error) {
    store.setState({
      loading: false,
      statusMessage: error.message || "Text save failed",
      statusType: "error"
    });
  }
}

function copyItem(item) {
  const clipboardItems = [{
    name: item.name,
    path: item.path,
    directory: item.directory
  }];

  localStorage.setItem("clipboardItems", JSON.stringify(clipboardItems));
  store.setState({
    clipboardItems,
    statusMessage: `Copied ${item.name}`,
    statusType: "success"
  });
}

async function pasteCopiedItems() {
  const { clipboardItems, currentPath } = store.getState();
  if (!clipboardItems.length) return;

  store.setState({
    loading: true,
    error: "",
    statusMessage: `Pasting ${clipboardItems.length} item${clipboardItems.length === 1 ? "" : "s"}`,
    statusType: "loading"
  });

  try {
    const response = await fetch(copyUrl(currentPath), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: clipboardItems.map((item) => item.path) })
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    const count = data.copied ? data.copied.length : clipboardItems.length;
    await load(currentPath, { history: false, route: false });
    store.setState({
      statusMessage: `Pasted ${count} item${count === 1 ? "" : "s"}`,
      statusType: "success"
    });
  } catch (error) {
    store.setState({
      loading: false,
      statusMessage: error.message || "Paste failed",
      statusType: "error"
    });
  }
}

function loadClipboardItems() {
  try {
    const items = JSON.parse(localStorage.getItem("clipboardItems") || "[]");
    if (!Array.isArray(items)) return [];
    return items.filter((item) => item && item.path);
  } catch {
    return [];
  }
}

function handlePaste(event) {
  if (
    isEditable(event.target) ||
    textModal.hidden === false ||
    modal.hidden === false ||
    propertiesModal.hidden === false ||
    logsModal.hidden === false
  ) {
    return;
  }

  const files = [...(event.clipboardData && event.clipboardData.files ? event.clipboardData.files : [])];
  if (files.length) {
    event.preventDefault();
    uploadFiles(files);
    return;
  }

  const text = event.clipboardData ? event.clipboardData.getData("text") : "";
  if (text) {
    event.preventDefault();
    openTextModal(text);
  }
}

function isEditable(element) {
  return element && (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.isContentEditable
  );
}

function renderApp(appState) {
  if (search.value !== appState.searchTerm) {
    search.value = appState.searchTerm;
  }

  renderTheme(appState);
  renderNav(appState);
  renderPlaces(appState);
  renderBreadcrumb(appState);
  renderList(appState);
}

function renderTheme(appState) {
  const isDark = appState.themeMode === "dark";
  document.documentElement.dataset.theme = appState.themeMode;
  if (themeMeta) {
    themeMeta.setAttribute("content", isDark ? "#0b0f14" : "#151a21");
  }
  themeSwitch.checked = isDark;
  themeSwitch.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  themeSwitch.closest(".ui-switch").title = isDark ? "Light mode" : "Dark mode";
}

function renderNav(appState) {
  const { backStack, clipboardItems, forwardStack, currentPath } = appState;
  backButton.disabled = !backStack.length;
  forwardButton.disabled = !forwardStack.length;
  upButton.disabled = !currentPath;
  pasteFilesButton.disabled = !clipboardItems.length;
  pasteFilesButton.title = clipboardItems.length
    ? `Paste ${clipboardItems.length} copied item${clipboardItems.length === 1 ? "" : "s"} here`
    : "Copy a file or folder first";
  pasteFilesButton.querySelector("span").textContent = clipboardItems.length
    ? `Paste ${clipboardItems.length}`
    : "Paste";
}

function renderPlaces(appState) {
  const { currentPath, places } = appState;
  placesEl.innerHTML = "";

  for (const place of places) {
    const button = document.createElement("button");
    button.className = "place";
    button.classList.toggle("active", place.path === currentPath || (!place.path && !currentPath));
    button.type = "button";
    button.innerHTML = iconSvg(place.type === "drive" ? "drive" : place.type === "pc" ? "pc" : "folder") + "<span></span>";
    button.querySelector("span").textContent = place.name;
    button.addEventListener("click", () => navigate(place.path));
    placesEl.appendChild(button);
  }
}

function renderBreadcrumb(appState) {
  const { currentPath } = appState;
  breadcrumb.innerHTML = "";
  addCrumb("This PC", "");

  if (!currentPath) {
    summaryTitle.textContent = "This PC";
    return;
  }

  const parts = currentPath.split("/").filter(Boolean);
  let built = "";

  for (const part of parts) {
    built = built ? `${built}/${part}` : `${part}/`;
    addSeparator();
    addCrumb(part, built);
  }

  summaryTitle.textContent = parts[parts.length - 1] || currentPath;
}

function addCrumb(label, targetPath) {
  const button = document.createElement("button");
  button.className = "crumb";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => navigate(targetPath));
  breadcrumb.appendChild(button);
}

function addSeparator() {
  const span = document.createElement("span");
  span.className = "crumb-separator";
  span.textContent = "/";
  breadcrumb.appendChild(span);
}

function renderList(appState) {
  const { currentPath, error, items, loading, searchTerm, statusMessage, statusType, viewMode } = appState;
  gridMode.classList.toggle("active", viewMode === "grid");
  detailsMode.classList.toggle("active", viewMode === "details");
  statusLeft.textContent = loading ? (statusMessage || "Loading") : error || statusMessage || "Ready";
  statusLeft.className = `status-pill${loading || statusType === "loading" ? " loading" : ""}${error || statusType === "error" ? " error" : ""}`;
  statusRight.textContent = currentPath || "This PC";

  if (error) {
    listWrap.innerHTML = '<div class="empty">Could not open this folder.</div>';
    summaryTitle.textContent = "Could not open";
    summaryCount.textContent = "";
    return;
  }

  if (loading) {
    listWrap.innerHTML = '<div class="empty">Loading...</div>';
    summaryCount.textContent = "";
    return;
  }

  const term = searchTerm.trim().toLowerCase();
  const visibleItems = term
    ? items.filter((item) => item.name.toLowerCase().includes(term))
    : items;

  summaryCount.textContent = `${visibleItems.length} item${visibleItems.length === 1 ? "" : "s"}`;

  if (!visibleItems.length) {
    listWrap.innerHTML = '<div class="empty">Nothing here.</div>';
    return;
  }

  listWrap.innerHTML = "";

  if (viewMode === "details") {
    const header = document.createElement("div");
    header.className = "details-header";
    header.innerHTML = "<span>Name</span><span>Type</span><span>Size</span><span>Modified</span><span></span>";
    listWrap.appendChild(header);
  }

  const list = document.createElement("div");
  list.className = `list ${viewMode}`;

  for (const item of visibleItems) {
    list.appendChild(renderItem(item, viewMode));
  }

  listWrap.appendChild(list);
}

function renderItem(item, viewMode) {
  const row = document.createElement("div");
  row.className = "item";
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-label", item.name);

  row.appendChild(nameCell(item, viewMode));
  row.appendChild(cell(typeLabel(item), "type-cell"));
  row.appendChild(cell(item.directory ? "" : formatSize(item.size), "size-cell"));
  row.appendChild(cell(formatModified(item.modified), "date-cell"));
  row.appendChild(actionsCell(item));

  row.addEventListener("click", (event) => {
    if (event.target.closest("button,a")) return;
    openItem(item);
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openItem(item);
    }
  });

  return row;
}

function nameCell(item, viewMode) {
  const wrap = document.createElement("div");
  wrap.className = "name-cell";
  wrap.appendChild(thumbnail(item));

  const text = document.createElement("div");
  const name = document.createElement("div");
  name.className = "file-name";
  name.textContent = item.name;
  const meta = document.createElement("div");
  meta.className = "file-meta";
  meta.textContent = viewMode === "grid" ? typeLabel(item) : item.path;
  text.appendChild(name);
  text.appendChild(meta);
  wrap.appendChild(text);
  return wrap;
}

function thumbnail(item) {
  const thumb = document.createElement("div");
  thumb.className = "thumb";

  if (item.image) {
    const image = document.createElement("img");
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = "";
    image.src = fileUrl(item.path);
    image.addEventListener("error", () => {
      thumb.innerHTML = iconSvg("image");
    });
    thumb.appendChild(image);
    return thumb;
  }

  thumb.innerHTML = iconSvg(iconType(item));
  return thumb;
}

function cell(text, className) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}

function actionsCell(item) {
  const actions = document.createElement("div");
  actions.className = "actions";

  if (canPreview(item)) {
    actions.appendChild(actionButton(
      item.video || item.audio ? "play" : "preview",
      item.video || item.audio ? "Play" : "Preview",
      () => previewFile(item),
      true
    ));
  }

  if (!item.directory) {
    actions.appendChild(actionButton("open", "Open", () => window.open(fileUrl(item.path), "_blank", "noreferrer")));
  }

  actions.appendChild(actionButton("copy", "Copy", () => copyItem(item)));
  actions.appendChild(actionButton("info", "Info", () => openProperties(item)));
  return actions;
}

function actionButton(icon, label, onClick, primary = false) {
  const button = document.createElement("button");
  button.className = `action-button${primary ? " primary" : ""}`;
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `${actionIcon(icon)}<span>${label}</span>`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function actionIcon(type) {
  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>',
    preview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7"></path><path d="M10 14L21 3"></path><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"></path></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 10v6"></path><path d="M12 7h.01"></path></svg>'
  };

  return icons[type] || icons.info;
}

function openItem(item) {
  if (item.directory) {
    navigate(item.path);
    return;
  }

  if (canPreview(item)) {
    previewFile(item);
    return;
  }

  window.open(fileUrl(item.path), "_blank", "noreferrer");
}

function canPreview(item) {
  return item.image || item.video || item.audio || item.pdf;
}

function previewFile(item) {
  const src = fileUrl(item.path);
  modalTitle.textContent = item.name;
  modalOpen.href = src;
  modalBody.innerHTML = "";
  modalBody.classList.toggle("media-on-light", item.image || item.pdf);

  let element;

  if (item.audio) {
    element = document.createElement("audio");
    element.controls = true;
    element.autoplay = true;
    element.src = src;
  } else if (item.image) {
    element = document.createElement("img");
    element.className = "loading";
    element.alt = item.name;
    const loading = document.createElement("div");
    loading.className = "preview-loading";
    loading.textContent = "Loading image...";
    modalBody.appendChild(loading);
    const imageTimeout = window.setTimeout(() => {
      if (element.classList.contains("loading")) {
        showPreviewError("This image is taking too long to open here. Use Open to view it directly.");
      }
    }, 8000);
    element.addEventListener("load", () => {
      window.clearTimeout(imageTimeout);
      element.classList.remove("loading");
      loading.remove();
    });
    element.addEventListener("error", () => {
      window.clearTimeout(imageTimeout);
      showPreviewError("This image could not be opened in the browser. Use Open to view it directly.");
    });
    element.src = src;
  } else if (item.pdf) {
    element = document.createElement("iframe");
    element.src = src;
    element.title = item.name;
  } else {
    element = document.createElement("video");
    element.controls = true;
    element.autoplay = true;
    element.playsInline = true;
    element.preload = "metadata";
    element.src = src;
    element.addEventListener("error", () => showPreviewError("This video format may not be supported by this browser."));
  }

  modalBody.appendChild(element);
  modal.hidden = false;
  syncModalOpenClass();
}

function showPreviewError(message) {
  modalBody.innerHTML = "";
  const box = document.createElement("div");
  box.className = "preview-error";
  box.textContent = message;
  modalBody.appendChild(box);
}

function closePreview() {
  modal.hidden = true;
  modalBody.innerHTML = "";
  modalBody.classList.remove("media-on-light");
  syncModalOpenClass();
}

async function openProperties(item) {
  propertiesTitle.textContent = `${item.name} properties`;
  propertiesBody.innerHTML = '<div class="empty">Loading properties...</div>';
  propertiesModal.hidden = false;
  syncModalOpenClass();

  try {
    const response = await fetch(propertiesUrl(item.path), { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    renderProperties(await response.json());
  } catch (error) {
    propertiesBody.innerHTML = "";
    const message = document.createElement("div");
    message.className = "preview-error";
    message.textContent = error.message || "Could not load properties.";
    propertiesBody.appendChild(message);
  }
}

function renderProperties(data) {
  propertiesBody.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "property-grid";

  const rows = [
    ["Name", data.name],
    ["Type", data.type],
    ["Location", data.path || "This PC"],
    ["Size", data.directory ? "Folder" : formatSize(data.size)],
    ["Created", formatDateTime(data.created)],
    ["Modified", formatDateTime(data.modified)],
    ["Accessed", formatDateTime(data.accessed)]
  ];

  if (data.extension) {
    rows.splice(3, 0, ["Extension", data.extension]);
  }

  if (data.children) {
    rows.push(["Contents", data.children.inaccessible
      ? "Not readable"
      : `${data.children.total} item${data.children.total === 1 ? "" : "s"} (${data.children.folders} folders, ${data.children.files} files)`]);
  }

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "property-row";

    const key = document.createElement("span");
    key.textContent = label;

    const detail = document.createElement("strong");
    detail.textContent = value || "-";

    row.appendChild(key);
    row.appendChild(detail);
    grid.appendChild(row);
  }

  propertiesBody.appendChild(grid);
}

function closeProperties() {
  propertiesModal.hidden = true;
  propertiesBody.innerHTML = "";
  syncModalOpenClass();
}

function openLogsModal() {
  logsModal.hidden = false;
  logsBody.innerHTML = '<div class="empty">Loading logs...</div>';
  syncModalOpenClass();
  loadLogs();

  if (logsTimer) {
    window.clearInterval(logsTimer);
  }
  logsTimer = window.setInterval(loadLogs, 2500);
}

function closeLogsModal() {
  logsModal.hidden = true;
  logsBody.innerHTML = "";
  if (logsTimer) {
    window.clearInterval(logsTimer);
    logsTimer = 0;
  }
  syncModalOpenClass();
}

async function loadLogs() {
  if (logsModal.hidden) return;

  try {
    const response = await fetch("/api/logs?lines=180", { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    renderLogs(await response.json());
  } catch (error) {
    logsBody.innerHTML = "";
    const message = document.createElement("div");
    message.className = "preview-error";
    message.textContent = error.message || "Could not load logs.";
    logsBody.appendChild(message);
  }
}

function renderLogs(data) {
  logsBody.innerHTML = "";

  const state = document.createElement("div");
  state.className = "logs-meta";
  state.textContent = data.state
    ? `Port ${data.state.port || "-"} | Server PID ${data.state.pid || "-"} | Watchdog PID ${data.state.watchdog_pid || "-"} | Restarts ${data.state.restarts || 0} | Updated ${formatDateTime(data.updatedAt)}`
    : `Updated ${formatDateTime(data.updatedAt)}`;
  logsBody.appendChild(state);

  for (const log of data.logs || []) {
    const panel = document.createElement("section");
    panel.className = "log-panel";

    const header = document.createElement("div");
    header.className = "log-header";
    const title = document.createElement("strong");
    title.textContent = log.name;
    const meta = document.createElement("span");
    meta.textContent = log.exists ? `${log.lineCount} lines` : log.error || "Not available";
    header.appendChild(title);
    header.appendChild(meta);

    const output = document.createElement("pre");
    output.className = "log-output";
    output.textContent = log.content || "No log lines yet.";

    panel.appendChild(header);
    panel.appendChild(output);
    logsBody.appendChild(panel);
  }
}

function syncModalOpenClass() {
  document.body.classList.toggle(
    "modal-open",
    !modal.hidden || !textModal.hidden || !propertiesModal.hidden || !logsModal.hidden
  );
}

function routePathFromLocation() {
  const pathName = window.location.pathname;
  if (pathName === "/browse") return "";
  if (pathName.startsWith("/browse/")) {
    return decodeRoutePath(pathName.slice("/browse/".length));
  }

  return new URLSearchParams(window.location.search).get("path") || "";
}

function decodeRoutePath(value) {
  try {
    return decodeURIComponent(value || "");
  } catch {
    return "";
  }
}

function updateRoute(folderPath, mode) {
  const nextUrl = browseUrl(folderPath);
  const currentUrl = window.location.pathname + window.location.search;
  if (currentUrl === nextUrl) return;

  if (mode === "replace") {
    window.history.replaceState({ path: folderPath || "" }, "", nextUrl);
    return;
  }

  window.history.pushState({ path: folderPath || "" }, "", nextUrl);
}

function browseUrl(folderPath) {
  return folderPath ? `/browse/${encodeURIComponent(folderPath)}` : "/";
}

function listUrl(folderPath) {
  return folderPath ? `/api/list/${encodeURIComponent(folderPath)}` : "/api/list";
}

function uploadUrl(folderPath, fileName) {
  const route = folderPath ? `/api/upload/${encodeURIComponent(folderPath)}` : "/api/upload";
  return `${route}?name=${encodeURIComponent(fileName)}`;
}

function copyUrl(folderPath) {
  return folderPath ? `/api/copy/${encodeURIComponent(folderPath)}` : "/api/copy";
}

function propertiesUrl(filePath) {
  return `/api/properties/${encodeURIComponent(filePath)}`;
}

function fileUrl(filePath) {
  return `/file/${encodeURIComponent(filePath)}`;
}

function iconType(item) {
  if (item.directory) return item.type === "drive" ? "drive" : "folder";
  if (item.pdf) return "pdf";
  if (item.video) return "video";
  if (item.audio) return "audio";
  if (item.image) return "image";
  return "file";
}

function typeLabel(item) {
  if (item.type === "drive") return "Drive";
  if (item.directory) return "Folder";
  if (item.pdf) return "PDF";
  if (item.video) return "Video";
  if (item.audio) return "Audio";
  if (item.image) return "Image";
  return item.type || "File";
}

function iconSvg(type) {
  const icons = {
    pc: '<svg class="file-icon" viewBox="0 0 64 64" aria-hidden="true"><rect x="10" y="13" width="44" height="30" rx="6" fill="#dbeafe"/><rect x="14" y="17" width="36" height="22" rx="3" fill="#2563eb"/><path d="M24 51h16M29 43v8M35 43v8" stroke="#334155" stroke-width="4" stroke-linecap="round"/></svg>',
    drive: '<svg class="file-icon" viewBox="0 0 64 64" aria-hidden="true"><rect x="10" y="17" width="44" height="34" rx="7" fill="#e0f2fe"/><path d="M17 37h30" stroke="#0369a1" stroke-width="4" stroke-linecap="round"/><circle cx="45" cy="44" r="3" fill="#0369a1"/><circle cx="37" cy="44" r="3" fill="#0369a1"/><path d="M18 17h28l8 16H10z" fill="#bae6fd"/></svg>',
    folder: '<svg class="file-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 20a7 7 0 0 1 7-7h12l6 7h16a7 7 0 0 1 7 7v3H8z" fill="#fde68a"/><path d="M8 27h48v18a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8z" fill="#f59e0b"/><path d="M15 34h34" stroke="#92400e" stroke-width="4" stroke-linecap="round" opacity=".45"/></svg>',
    file: '<svg class="file-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M18 6h24l10 10v42H18z" fill="#f8fafc"/><path d="M42 6v12h10" fill="#cbd5e1"/><path d="M25 33h14M25 42h20" stroke="#64748b" stroke-width="4" stroke-linecap="round"/></svg>',
    image: '<svg class="file-icon" viewBox="0 0 64 64" aria-hidden="true"><rect x="10" y="12" width="44" height="40" rx="8" fill="#dcfce7"/><circle cx="25" cy="25" r="5" fill="#16a34a"/><path d="M16 46l13-14 8 8 6-6 7 12z" fill="#15803d"/></svg>',
    video: '<svg class="file-icon" viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="14" width="46" height="36" rx="8" fill="#ede9fe"/><path d="M28 24l15 8-15 8z" fill="#7c3aed"/><path d="M18 14v36M46 14v36" stroke="#7c3aed" stroke-opacity=".35" stroke-width="4"/></svg>',
    audio: '<svg class="file-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M25 40V17l22-5v25" fill="none" stroke="#0f766e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="18" cy="43" rx="9" ry="7" fill="#14b8a6"/><ellipse cx="40" cy="39" rx="9" ry="7" fill="#14b8a6"/></svg>',
    pdf: '<svg class="file-icon" viewBox="0 0 64 64" aria-hidden="true"><path d="M18 6h24l10 10v42H18z" fill="#fff1f2"/><path d="M42 6v12h10" fill="#fecdd3"/><rect x="13" y="31" width="38" height="18" rx="4" fill="#e11d48"/><text x="32" y="45" text-anchor="middle" font-size="13" font-family="Arial" font-weight="700" fill="#fff">PDF</text></svg>'
  };

  return icons[type] || icons.file;
}

function formatSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatModified(value) {
  return formatDateTime(value);
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
