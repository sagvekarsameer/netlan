import os
import subprocess
import sys
from pathlib import Path


APP_NAME = "Local Files Server"
INSTALL_DIR = Path(os.environ["LOCALAPPDATA"]) / "LocalFilesServer"
DESKTOP_DIR = Path(os.environ["USERPROFILE"]) / "Desktop"
START_MENU_DIR = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / APP_NAME
STARTUP_DIR = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
SHORTCUTS = [
    STARTUP_DIR / f"{APP_NAME}.lnk",
    DESKTOP_DIR / "Start Local Files Server.lnk",
    DESKTOP_DIR / "Stop Local Files Server.lnk",
    START_MENU_DIR / "Start Local Files Server.lnk",
    START_MENU_DIR / "Stop Local Files Server.lnk",
    START_MENU_DIR / "Remove Auto Start.lnk",
]


def main():
    stop_server()

    for shortcut in SHORTCUTS:
        try:
            shortcut.unlink()
        except FileNotFoundError:
            pass

    try:
        START_MENU_DIR.rmdir()
    except OSError:
        pass

    print("Auto start and shortcuts removed.")
    print(f"Installed files are still here: {INSTALL_DIR}")
    return 0


def stop_server():
    stop_script = INSTALL_DIR / "stop_server.py"
    if not stop_script.exists():
        return

    subprocess.run(
        [sys.executable, str(stop_script)],
        cwd=str(INSTALL_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


if __name__ == "__main__":
    raise SystemExit(main())
