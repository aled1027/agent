from importlib.metadata import version
import platform
import sys


PACKAGES = [
    "requests",
    "httpx",
    "beautifulsoup4",
    "lxml",
    "numpy",
    "pandas",
    "openpyxl",
    "pillow",
    "opencv-python",
    "pydantic",
    "python-dotenv",
    "pyyaml",
    "rich",
    "typer",
    "matplotlib",
]


def main() -> None:
    print("Python skill environment ready")
    print(f"Python: {sys.version.split()[0]}")
    print(f"Executable: {sys.executable}")
    print(f"Platform: {platform.platform()}")
    print("\nInstalled packages:")
    for package in PACKAGES:
        print(f"- {package}=={version(package)}")


if __name__ == "__main__":
    main()
