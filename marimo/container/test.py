import marimo

__generated_with = "0.13.2"

app = marimo.App(
    width="full",
    auto_download=["ipynb", "html"],
    app_title="System Test Notebook",
)

@app.cell
def _():
    import os
    import platform
    import shutil
    import subprocess

    print ("================ .env ===============")
    # Clickhouse
    clickhouse_token = os.environ.get("CLICKHOUSE_TOKEN")
    if clickhouse_token:
        print(f'CLICKHOUSE_TOKEN: {clickhouse_token}')
    else:
        print("CLICKHOUSE_TOKEN is not set.")

    # R2
    r2_token = os.environ.get("R2_TOKEN")
    if r2_token:
        print(f'R2_TOKEN: {r2_token}')
    else:
        print("R2_TOKEN is not set.")

    # ENV
    print("ENV:")
    print(os.environ)

    # Get CPU usage
    print ("================ CPU ================")
    cpu_count = os.cpu_count()
    print(f"Logical CPUs: {cpu_count}")
    load1, load5, load15 = os.getloadavg()
    print(f"Load averages: {load1}, {load5}, {load15}")

    # Get memory usage
    print ("============== Memory ===============")
    if platform.system() == "Linux":
        # Parse /proc/meminfo for total and free memory (in kB)
        meminfo = {}
        try:
            with open("/proc/meminfo", "r") as f:
                for line in f:
                    key, val = line.split(":", 1)
                    meminfo[key] = int(val.strip().split()[0])
            total_kb = meminfo.get("MemTotal", 0)
            free_kb = meminfo.get("MemFree", 0) + meminfo.get("Buffers", 0) + meminfo.get("Cached", 0)
            print(f"Total RAM: {total_kb/1024:.1f} MB")
            print(f"Available RAM: {free_kb/1024:.1f} MB")
        except FileNotFoundError:
            print("/proc/meminfo not found — are you on Linux?")
        except Exception as e:
            print("Error reading memory info:", e)
    else:
        # Fallback for non-Linux
        try:
            out = subprocess.check_output(["sysctl", "-n", "hw.memsize"])
            total_bytes = int(out.strip())
            print(f"Total RAM: {total_bytes/1024**3:.2f} GB")
        except Exception:
            print("Memory info: unavailable on this platform")

    # Get disk usage
    print ("================ Disk ===============")
    total, used, free = shutil.disk_usage("/")
    print(f"Total: {(total // (2**30))} GB")
    print(f"Used:  {(used // (2**30))} GB")
    print(f"Free:  {(free // (2**30))} GB")

    # Get GPU usage
    print ("================ GPU ================")
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader"],
            capture_output=True, text=True, check=True
        )
        usages = [int(x.split()[0]) for x in result.stdout.splitlines()]
        print("GPU utilization (%):", usages)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("nvidia-smi not found or no NVIDIA GPU")


if __name__ == "__main__":
    app.run()
