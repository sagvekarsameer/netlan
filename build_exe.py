import subprocess
import sys
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
DIST_DIR = APP_DIR / "dist"
DATA_FILES = [
    "server.js",
    "package.json",
    "README.md",
    "public",
    "start_server.py",
    "stop_server.py",
    "uninstall_autostart.py",
]


def main():
    ensure_pyinstaller()
    build("StartLocalFiles", "start_server.py", windowed=True)
    build("StopLocalFiles", "stop_server.py", windowed=True)
    build("UninstallLocalFiles", "uninstall_autostart.py", windowed=False)
    build("InstallLocalFiles", "install_autostart.py", windowed=False, include_data=True)

    print("Done. EXE files are in:")
    print(DIST_DIR)
    return 0


def ensure_pyinstaller():
    try:
        import PyInstaller.__main__  # noqa: F401
    except ImportError:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--user", "pyinstaller"],
            check=True,
        )


def build(name, script, windowed, include_data=False):
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onefile",
        "--name",
        name,
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(APP_DIR / "build"),
        "--specpath",
        str(APP_DIR / "build"),
    ]

    command.append("--windowed" if windowed else "--console")

    if include_data:
        for file_name in DATA_FILES:
            source = APP_DIR / file_name
            destination = file_name if source.is_dir() else "."
            command.extend(["--add-data", f"{source};{destination}"])

    command.append(str(APP_DIR / script))
    subprocess.run(command, check=True)


if __name__ == "__main__":
    raise SystemExit(main())
