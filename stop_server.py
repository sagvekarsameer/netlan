import json
import os
import subprocess
import sys
from pathlib import Path


APP_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
STATE_FILE = APP_DIR / "server_state.json"
PORT = int(os.environ.get("PORT", "8080"))


def main():
    pids = read_state_pids()
    watchdog_pid = find_watchdog_pid()
    server_pid = find_server_pid()

    if watchdog_pid and watchdog_pid not in pids["watchdogs"]:
        pids["watchdogs"].append(watchdog_pid)

    if server_pid and server_pid not in pids["servers"]:
        pids["servers"].append(server_pid)

    if not pids["watchdogs"] and not pids["servers"]:
        print("Local Files server is not running.")
        return 0

    for pid in pids["watchdogs"]:
        stop_pid(pid)

    for pid in pids["servers"]:
        stop_pid(pid)

    try:
        STATE_FILE.unlink()
    except OSError:
        pass

    print("Local Files server stopped.")
    return 0


def read_state_pids():
    pids = {"servers": [], "watchdogs": []}

    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return pids

    server_pid = int(data.get("pid") or 0)
    watchdog_pid = int(data.get("watchdog_pid") or 0)

    if server_pid:
        pids["servers"].append(server_pid)
    if watchdog_pid:
        pids["watchdogs"].append(watchdog_pid)

    return pids


def find_server_pid():
    if os.name != "nt":
        return 0

    port_pid = find_pid_on_port(PORT)
    if port_pid and is_node_server(port_pid):
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


def find_pid_on_port(port):
    result = run_powershell(
        f"Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | "
        "Select-Object -First 1 -ExpandProperty OwningProcess"
    )

    text = result.stdout.strip()
    return int(text) if text.isdigit() else 0


def is_node_server(pid):
    result = run_powershell(
        f"(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\" | Select-Object -ExpandProperty CommandLine)"
    )

    command_line = result.stdout.lower()
    return "node" in command_line and "server.js" in command_line


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


if __name__ == "__main__":
    raise SystemExit(main())
