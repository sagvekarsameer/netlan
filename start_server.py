import json
import os
import base64
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
SERVER_JS = APP_DIR / "server.js"
STATE_FILE = APP_DIR / "server_state.json"
LOG_FILE = APP_DIR / "server.log"
ERROR_LOG_FILE = APP_DIR / "server.err.log"
WATCHDOG_LOG_FILE = APP_DIR / "watchdog.log"
PORT = int(os.environ.get("PORT", "8080"))
CHECK_SECONDS = int(os.environ.get("WATCHDOG_CHECK_SECONDS", "5"))
HEALTH_FAILURE_LIMIT = int(os.environ.get("WATCHDOG_FAILURE_LIMIT", "3"))
AUTH_USER = os.environ.get("AUTH_USER", "admin")
AUTH_PASSWORD = os.environ.get("AUTH_PASSWORD", "")


def main():
    if "--watchdog" in sys.argv:
        return run_watchdog()

    if not SERVER_JS.exists():
        pause(f"Cannot find {SERVER_JS}")
        return 1

    existing_watchdog = get_running_watchdog_pid()
    existing_server = get_running_pid()

    if existing_watchdog:
        show_urls(existing_server, existing_watchdog)
        return 0

    node = find_node()
    if not node:
        pause("Node.js was not found. Install Node.js first.")
        return 1

    watchdog = start_watchdog()

    for _ in range(20):
        time.sleep(0.5)
        server_pid = get_running_pid()
        if server_pid and is_http_healthy():
            show_urls(server_pid, watchdog.pid)
            return 0

        if watchdog.poll() is not None:
            pause(f"Watchdog failed to start. Check {WATCHDOG_LOG_FILE}")
            return 1

    show_urls(get_running_pid(), watchdog.pid)
    return 0


def run_watchdog():
    if not SERVER_JS.exists():
        log_watchdog(f"Missing server.js at {SERVER_JS}")
        return 1

    node = find_node()
    if not node:
        log_watchdog("Node.js was not found.")
        return 1

    failures = 0
    restarts = int(read_state().get("restarts") or 0)
    log_watchdog(f"Watchdog started on port {PORT}.")

    while True:
        server_pid = get_running_pid()

        if server_pid and is_http_healthy():
            failures = 0
            save_state(server_pid, os.getpid(), restarts)
            time.sleep(CHECK_SECONDS)
            continue

        if server_pid:
            failures += 1
            save_state(server_pid, os.getpid(), restarts)
            log_watchdog(f"Health check failed for PID {server_pid} ({failures}/{HEALTH_FAILURE_LIMIT}).")

            if failures < HEALTH_FAILURE_LIMIT:
                time.sleep(CHECK_SECONDS)
                continue

            log_watchdog(f"Stopping unhealthy server PID {server_pid}.")
            stop_pid(server_pid)
            failures = 0
            time.sleep(1)

        process = start_server_process(node)
        restarts += 1
        save_state(process.pid, os.getpid(), restarts)
        log_watchdog(f"Started server PID {process.pid}. Restart count: {restarts}.")

        for _ in range(16):
            time.sleep(0.5)
            if process.poll() is not None:
                log_watchdog(f"Server PID {process.pid} exited with code {process.returncode}.")
                break
            if is_http_healthy():
                break

        time.sleep(CHECK_SECONDS)


def start_watchdog():
    command = watchdog_command()
    with WATCHDOG_LOG_FILE.open("a", encoding="utf-8") as out:
        return subprocess.Popen(
            command,
            cwd=str(APP_DIR),
            stdout=out,
            stderr=out,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )


def watchdog_command():
    if getattr(sys, "frozen", False):
        return [str(sys.executable), "--watchdog"]

    return [str(sys.executable), str(Path(__file__).resolve()), "--watchdog"]


def start_server_process(node):
    with LOG_FILE.open("a", encoding="utf-8") as out, ERROR_LOG_FILE.open("a", encoding="utf-8") as err:
        return subprocess.Popen(
            [node, str(SERVER_JS), "--this-pc", "--port", str(PORT)],
            cwd=str(APP_DIR),
            stdout=out,
            stderr=err,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )


def is_http_healthy():
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{PORT}/api/places",
            headers=health_headers(),
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def health_headers():
    if not AUTH_PASSWORD:
        return {}

    token = base64.b64encode(f"{AUTH_USER}:{AUTH_PASSWORD}".encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {token}"}


def find_node():
    candidates = [
        "node.exe",
        "node",
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
    ]

    for candidate in candidates:
        try:
            result = subprocess.run(
                [candidate, "--version"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if result.returncode == 0:
                return candidate
        except OSError:
            continue

    return ""


def get_running_pid():
    state = read_state()
    pid = int(state.get("pid") or 0)

    if pid and is_server_process(pid):
        return pid

    pid = find_server_pid()
    if pid:
        save_state(pid, get_running_watchdog_pid(), int(state.get("restarts") or 0))
        return pid

    return 0


def get_running_watchdog_pid():
    state = read_state()
    pid = int(state.get("watchdog_pid") or 0)

    if pid and is_watchdog_process(pid):
        return pid

    return find_watchdog_pid()


def find_server_pid():
    if os.name != "nt":
        return 0

    port_pid = find_pid_on_port(PORT)
    if port_pid and is_server_process(port_pid):
        return port_pid

    return 0


def find_watchdog_pid():
    if os.name != "nt":
        return 0

    command = (
        "Get-CimInstance Win32_Process | "
        "Where-Object { ($_.Name -in @('python.exe','pythonw.exe','StartLocalFiles.exe')) -and "
        "$_.CommandLine -like '*--watchdog*' -and "
        "($_.CommandLine -like '*start_server.py*' -or $_.CommandLine -like '*StartLocalFiles*') } | "
        "Select-Object -First 1 -ExpandProperty ProcessId"
    )

    result = run_powershell(command)
    text = result.stdout.strip()
    return int(text) if text.isdigit() else 0


def is_server_process(pid):
    if os.name != "nt":
        return is_pid_alive(pid)

    result = run_powershell(
        f"(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\" | Select-Object -ExpandProperty CommandLine)"
    )
    command_line = result.stdout.lower()
    return "node" in command_line and "server.js" in command_line


def is_watchdog_process(pid):
    if os.name != "nt":
        return is_pid_alive(pid)

    result = run_powershell(
        f"(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\" | Select-Object Name,CommandLine | ConvertTo-Json -Compress)"
    )
    process_info = result.stdout.lower()
    is_python_or_exe = "python.exe" in process_info or "pythonw.exe" in process_info or "startlocalfiles.exe" in process_info
    return is_python_or_exe and "--watchdog" in process_info and ("start_server" in process_info or "startlocalfiles" in process_info)


def is_pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def find_pid_on_port(port):
    result = run_powershell(
        f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | "
        "Select-Object -First 1 -ExpandProperty OwningProcess"
    )

    text = result.stdout.strip()
    return int(text) if text.isdigit() else 0


def stop_pid(pid):
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    else:
        try:
            os.kill(pid, 15)
        except OSError:
            pass


def run_powershell(command):
    return subprocess.run(
        ["powershell", "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        check=False,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


def read_state():
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_state(pid, watchdog_pid=0, restarts=0):
    data = {
        "pid": int(pid or 0),
        "watchdog_pid": int(watchdog_pid or 0),
        "port": PORT,
        "restarts": int(restarts or 0),
        "updated_at": int(time.time()),
    }
    STATE_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")


def log_watchdog(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with WATCHDOG_LOG_FILE.open("a", encoding="utf-8") as log:
        log.write(f"[{timestamp}] {message}\n")


def local_ips():
    ips = []
    hostname = socket.gethostname()

    try:
        for _, _, _, _, sockaddr in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = sockaddr[0]
            if ip != "127.0.0.1" and ip not in ips:
                ips.append(ip)
    except socket.gaierror:
        pass

    return ips


def show_urls(server_pid, watchdog_pid=0):
    state = read_state()
    restarts = int(state.get("restarts") or 0)
    port = int(state.get("port") or PORT)
    print(f"Local Files server is running. PID: {server_pid or 'starting'}")
    if watchdog_pid:
        print(f"Watchdog PID: {watchdog_pid}")
    print(f"Restarts: {restarts}")
    print(f"PC:    http://localhost:{port}")
    for ip in local_ips():
        print(f"Phone: http://{ip}:{port}")


def pause(message):
    print(message)
    if sys.stdout.isatty():
        input("Press Enter to close...")


if __name__ == "__main__":
    raise SystemExit(main())
