import os
import shutil
import subprocess
import sys
from pathlib import Path


APP_NAME = "Local Files Server"
SOURCE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
RUN_DIR = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
INSTALL_DIR = Path(os.environ["LOCALAPPDATA"]) / "LocalFilesServer"
DESKTOP_DIR = Path(os.environ["USERPROFILE"]) / "Desktop"
START_MENU_DIR = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / APP_NAME
STARTUP_DIR = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
STARTUP_SHORTCUT = STARTUP_DIR / f"{APP_NAME}.lnk"
FILES_TO_INSTALL = [
    "server.js",
    "package.json",
    "README.md",
    "public",
    "start_server.py",
    "stop_server.py",
    "uninstall_autostart.py",
]
OPTIONAL_EXES = [
    "StartLocalFiles.exe",
    "StopLocalFiles.exe",
    "UninstallLocalFiles.exe",
]


def main():
    missing = [name for name in FILES_TO_INSTALL if not (SOURCE_DIR / name).exists()]
    if missing:
        pause("Missing files: " + ", ".join(missing))
        return 1

    stop_source_server()
    copy_files()
    create_shortcuts()
    start_installed_server()

    print("Installed successfully.")
    print(f"Installed path: {INSTALL_DIR}")
    print("It will start automatically when Windows starts.")
    print("Use the desktop shortcut 'Stop Local Files Server' to stop it.")
    return 0


def copy_files():
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)

    for name in FILES_TO_INSTALL:
        source = SOURCE_DIR / name
        destination = INSTALL_DIR / name

        if source.is_dir():
            if destination.exists():
                shutil.rmtree(destination)
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)

    for name in OPTIONAL_EXES:
        source = RUN_DIR / name
        if source.exists():
            shutil.copy2(source, INSTALL_DIR / name)


def create_shortcuts():
    START_MENU_DIR.mkdir(parents=True, exist_ok=True)
    STARTUP_DIR.mkdir(parents=True, exist_ok=True)

    start_script = INSTALL_DIR / "start_server.py"
    stop_script = INSTALL_DIR / "stop_server.py"
    uninstall_script = INSTALL_DIR / "uninstall_autostart.py"
    start_target, start_args = command_for(INSTALL_DIR / "StartLocalFiles.exe", start_script)
    stop_target, stop_args = command_for(INSTALL_DIR / "StopLocalFiles.exe", stop_script)
    uninstall_target, uninstall_args = command_for(INSTALL_DIR / "UninstallLocalFiles.exe", uninstall_script)

    create_shortcut(
        STARTUP_SHORTCUT,
        start_target,
        start_args,
        INSTALL_DIR,
        "Start Local Files automatically",
    )
    create_shortcut(
        DESKTOP_DIR / "Start Local Files Server.lnk",
        start_target,
        start_args,
        INSTALL_DIR,
        "Start Local Files Server",
    )
    create_shortcut(
        DESKTOP_DIR / "Stop Local Files Server.lnk",
        stop_target,
        stop_args,
        INSTALL_DIR,
        "Stop Local Files Server",
    )
    create_shortcut(
        START_MENU_DIR / "Start Local Files Server.lnk",
        start_target,
        start_args,
        INSTALL_DIR,
        "Start Local Files Server",
    )
    create_shortcut(
        START_MENU_DIR / "Stop Local Files Server.lnk",
        stop_target,
        stop_args,
        INSTALL_DIR,
        "Stop Local Files Server",
    )
    create_shortcut(
        START_MENU_DIR / "Remove Auto Start.lnk",
        uninstall_target,
        uninstall_args,
        INSTALL_DIR,
        "Remove Local Files auto start",
    )


def create_shortcut(shortcut_path, target, arguments, working_dir, description):
    ps = f"""
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut('{escape(shortcut_path)}')
    $shortcut.TargetPath = '{escape(target)}'
    $shortcut.Arguments = '{escape(arguments)}'
    $shortcut.WorkingDirectory = '{escape(working_dir)}'
    $shortcut.Description = '{escape(description)}'
    $shortcut.IconLocation = '{escape(target)},0'
    $shortcut.Save()
    """
    subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
        check=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


def start_installed_server():
    target, args = command_for(INSTALL_DIR / "StartLocalFiles.exe", INSTALL_DIR / "start_server.py")
    command = [target]
    if args:
        command.append(args.strip('"'))

    subprocess.Popen(
        command,
        cwd=str(INSTALL_DIR),
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


def stop_source_server():
    stop_script = RUN_DIR / "stop_server.py"
    if not stop_script.exists():
        return

    subprocess.run(
        [sys.executable, str(stop_script)],
        cwd=str(SOURCE_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


def find_pythonw():
    python_exe = Path(sys.executable)
    pythonw = python_exe.with_name("pythonw.exe")
    return str(pythonw if pythonw.exists() else python_exe)


def command_for(exe_path, script_path):
    if exe_path.exists():
        return str(exe_path), ""

    return find_pythonw(), f'"{script_path}"'


def escape(value):
    return str(value).replace("'", "''")


def pause(message):
    print(message)
    if sys.stdout.isatty():
        input("Press Enter to close...")


if __name__ == "__main__":
    raise SystemExit(main())
