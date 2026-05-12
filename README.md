# Local File Streamer

Simple local server for opening PC files from your phone on the same Wi-Fi.

## Use

Install Node.js if you do not have it, then run:

```powershell
npm start
```

This starts a watchdog that keeps the webapp running and automatically restarts
the Node server if it crashes or stops responding. It shows your PC drives
first, like `C:` and `D:`.

You can also start whole-PC mode with:

```powershell
npm run server
```

To share only one folder:

```powershell
node server.js "D:\Videos"
```

To stop the watchdog and server:

```powershell
npm run stop
```

The terminal will show a phone URL like:

```text
http://192.168.1.10:8080
```

Open that link on your phone browser.

### Optional login

To require a shared username and password before the file browser opens, set:

```powershell
$env:AUTH_USER="admin"
$env:AUTH_PASSWORD="choose-a-strong-password"
npm start
```

If you use `node server.js ...` directly, the same environment variables work
there too. `AUTH_USER` defaults to `admin`, and setting `AUTH_PASSWORD` turns
login on.

### Cheapest remote access

For access from outside your home Wi-Fi without exposing the port publicly,
use Tailscale on the PC and on the phone:

1. Install Tailscale on the Windows PC that runs this server.
2. Install Tailscale on your phone.
3. Sign in on both devices with the same Tailscale account.
4. Leave this server running with `AUTH_PASSWORD` set.
5. Open the server from your phone using the PC's Tailscale IP, for example:

```text
http://100.x.y.z:8080
```

If MagicDNS is enabled on your tailnet, you can also use the device name
instead of the IP address.

This is usually the lowest-cost safe option because Tailscale's Personal plan is
free for personal use, and it gives your devices a private network without
opening inbound ports.

## Notes

- Your phone and PC must be on the same Wi-Fi.
- Keep the PC awake while watching.
- If Windows Firewall asks, allow Node.js on private networks.
- If you expose the server outside your home network, keep the password on and
  use a tunnel or VPN rather than opening the port directly.
- For best mobile playback, MP4 files work best.
- Use `Grid` for previews or `Details` for a file-list view.
- Images and PDFs can be opened with the `Preview` button.
- Use `Upload` to copy files from your phone to the currently open folder.
- Use `Text` or paste clipboard text to save mobile text as a file.
- Use `Copy` on a file or folder, then `Paste` to duplicate it in the current folder.
- Use `Info` to view file/folder properties.
- Use `Logs` to watch live server and watchdog logs from the browser.
- Use the theme button to switch between light and dark mode.
- This is safest on your local network or behind a tunnel/VPN.
- Tailscale is the recommended low-cost remote-access option for this project.
- Whole-PC mode can only open folders your Windows user is allowed to read.

## Options

```powershell
node server.js "D:\Movies" --port 9090
```

For watchdog mode on a different port:

```powershell
$env:PORT=9090; npm start
```

## Auto Recovery

`start_server.py` runs a hidden watchdog process. Every few seconds it checks
the local webapp health endpoint. If the Node server crashes, exits, or stops
answering, the watchdog stops the bad process and starts a fresh one.

Logs are written next to the app:

- `watchdog.log` records restarts and health check failures.
- `server.log` records normal server output.
- `server.err.log` records server errors.

## Routes

- `/` opens the file browser.
- `/browse/<encoded-path>` opens a folder directly.
- `/api/places` returns quick places and drives.
- `/api/list` returns the current root folder or This PC drives.
- `/api/list/<encoded-path>` returns a folder listing.
- `POST /api/upload/<encoded-path>?name=<file-name>` uploads to a folder.
- `POST /api/copy/<encoded-path>` copies selected files/folders into a folder.
- `/api/properties/<encoded-path>` returns file/folder properties.
- `/api/logs` returns recent server and watchdog logs.
- `/file/<encoded-path>` streams a file with range support for video/audio.

Legacy query routes still work:

```text
/api/list?path=C%3A%2FUsers
/file?path=C%3A%2FUsers%2FPublic%2Fvideo.mp4
```

## State Management

The browser UI uses a small vanilla JavaScript store inside `public/app.js`.
It keeps folder state, loaded items, quick places, search, loading/error state,
view mode, copy/paste clipboard state, and back/forward stacks in one place.
UI rendering reads from that store, so navigation, search, and route changes
stay in sync.

## Web App Files

The frontend lives in `public/`:

- `public/index.html` is the app shell.
- `public/styles.css` contains the responsive professional UI.
- `public/app.js` contains state, routing, previews, upload, and paste handling.

## Install on Windows

To install it once and make it start automatically with Windows, run either:

```powershell
.\dist\InstallLocalFiles.exe
```

Or:

```powershell
python install_autostart.py
```

The installer automatically copies all needed files to:

```text
%LOCALAPPDATA%\LocalFilesServer
```

It also creates desktop shortcuts:

```text
Start Local Files Server
Stop Local Files Server
```

To remove auto start and shortcuts:

```powershell
python uninstall_autostart.py
```

## Build EXE Files

To recreate the EXE files:

```powershell
python build_exe.py
```

The EXE files will be created in `dist`.
