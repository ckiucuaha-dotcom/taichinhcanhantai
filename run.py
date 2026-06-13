import threading
import time
import webbrowser
import os
import sys
import subprocess
import re

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from backend import server

def open_browser():
    if os.environ.get('ZENFINANCE_NO_BROWSER') == '1':
        print("Background service mode: skipping browser auto-open.")
        return
    time.sleep(1.2)
    url = f"http://localhost:{server.PORT}/frontend/index.html"
    print(f"Opening browser at {url}...")
    webbrowser.open(url)

def start_ssh_tunnel():
    cmd = ["ssh", "-o", "StrictHostKeyChecking=no", "-R", "zenfinance-ckiucuaha:80:localhost:8000", "serveo.net"]
    import atexit
    
    while True:
        print("Starting SSH tunnel to serveo.net in background...")
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            
            # Register atexit handler for the new process
            def cleanup_proc(p=proc):
                try:
                    p.terminate()
                except Exception:
                    pass
            atexit.register(cleanup_proc)
            
            # Read stdout line by line
            for line in iter(proc.stdout.readline, ''):
                print(f"[SSH Tunnel] {line.strip()}")
                # Match Serveo URL patterns (excluding console.serveo.net)
                match = re.search(r'(https://(?!console)[a-zA-Z0-9.-]+\.serveo\.net|https://[a-zA-Z0-9.-]+\.serveousercontent\.com)', line)
                if match:
                    url = match.group(1)
                    link_file_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ZenFinance_Mobile_Link.txt")
                    
                    # Write to file
                    with open(link_file_path, "w", encoding="utf-8") as f:
                        f.write(f"ZenFinance Mobile Link (Dùng 4G/5G khi ra ngoài):\n{url}\n\nĐường dẫn được cập nhật lúc: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
                    
                    print("==================================================")
                    print(f"  ZenFinance Mobile URL: {url}")
                    print(f"  Link saved to: {link_file_path}")
                    print("==================================================")
                    
                    
                    # Send macOS Notification Banner
                    try:
                        os.system(f"osascript -e 'display notification \"Link 4G/5G: {url}\" with title \"ZenFinance - Kết nối từ xa\"'")
                    except Exception:
                        pass
            
            # If the stdout loop ends, the process exited
            ret = proc.wait()
            print(f"[SSH Tunnel] Process exited with code {ret}. Re-establishing tunnel in 5 seconds...")
        except Exception as e:
            print(f"[SSH Tunnel] Failed to run SSH tunnel: {e}. Retrying in 5 seconds...")
        
        time.sleep(5)

def start_telegram_bot():
    try:
        from backend import telegram_bot
        config = telegram_bot.load_config()
        if config and config.get('bot_token'):
            print("==================================================")
            print("Starting Telegram Bot service...")
            print("==================================================")
            telegram_bot.start_bot_thread()
        else:
            print("[Telegram Bot] Config not found or token missing. Telegram integration disabled.")
    except Exception as e:
        print(f"[Telegram Bot] Failed to start: {e}")

if __name__ == '__main__':
    print("==================================================")
    print("      ZenFinance Dashboard - Startup Script       ")
    print("==================================================")
    
    # Start Telegram Bot in background
    start_telegram_bot()
    
    # Start thread to open browser after server initialization delay
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Start thread to run SSH tunnel
    threading.Thread(target=start_ssh_tunnel, daemon=True).start()
    
    # Start web server on main thread
    server.run_server()
