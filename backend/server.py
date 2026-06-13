import http.server
import socketserver
import json
import os
import sys
import socket
import threading
import hashlib
import re
from urllib.parse import urlparse

PORT = 8000
DB_PATH = 'database.json'

DB_LOCK = threading.Lock()

def load_db():
    if not os.path.exists(DB_PATH):
        default_db = {
            "fi_target": 4500000000,
            "transactions": []
        }
        save_db(default_db)
        return default_db
    
    try:
        with open(DB_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading database.json: {e}")
        return {
            "fi_target": 4500000000,
            "transactions": []
        }

def git_push_database():
    def task():
        try:
            print("[Git Sync] Starting git push database to GitHub...")
            workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            
            import subprocess
            import time
            
            # Step 1: Add frontend/database.json
            subprocess.run(["git", "add", "frontend/database.json"], cwd=workspace_root, check=True)
            
            # Step 2: Check status to see if there are any changes
            status = subprocess.run(["git", "status", "--porcelain", "frontend/database.json"], cwd=workspace_root, capture_output=True, text=True)
            if status.stdout.strip():
                # We have changes to commit
                commit_msg = f"Update transaction database [bot] - {time.strftime('%Y-%m-%d %H:%M:%S')}"
                subprocess.run(["git", "commit", "-m", commit_msg], cwd=workspace_root, check=True)
                
                # Step 3: Push main branch
                subprocess.run(["git", "push", "origin", "main"], cwd=workspace_root, check=True)
                
                # Step 4: Push gh-pages branch (split prefix)
                print("[Git Sync] Running git subtree push to gh-pages...")
                subprocess.run(["git", "subtree", "push", "--prefix", "frontend", "origin", "gh-pages"], cwd=workspace_root, check=True)
                print("[Git Sync] Git push completed successfully!")
            else:
                print("[Git Sync] No database changes to commit/push.")
        except Exception as e:
            print(f"[Git Sync] Error during git push: {e}")
            
    threading.Thread(target=task, daemon=True).start()

def save_db(data):
    try:
        # Save master database in root directory
        with open(DB_PATH, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        # Save sanitized database for public frontend deployment
        sanitized_data = {
            "fi_target": data.get("fi_target", 4500000000),
            "transactions": data.get("transactions", [])
        }
        frontend_db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend', 'database.json')
        try:
            with open(frontend_db_path, 'w', encoding='utf-8') as f:
                json.dump(sanitized_data, f, ensure_ascii=False, indent=2)
        except Exception as fe:
            print(f"Error saving frontend/database.json: {fe}")
            
        # Trigger Git push to sync with web
        git_push_database()
        
        return True
    except Exception as e:
        print(f"Error saving database.json: {e}")
        return False

def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def verify_auth(headers, db):
    saved_hash = db.get('password_hash')
    if not saved_hash:
        return 'SETUP_REQUIRED'
        
    auth_header = headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return 'UNAUTHORIZED'
        
    token = auth_header.split(' ')[1]
    if token == saved_hash:
        return 'AUTHORIZED'
    return 'UNAUTHORIZED'

def get_normalized_partner(item, group, category):
    if not item:
        return None
        
    is_debt = group == 'KHOẢN NỢ'
    is_receivable = group == 'ĐÒI NỢ'
    is_repayment = group == 'KHOẢN THU' and category == 'Nợ trả'
    is_payment = group == 'KHOẢN CHI' and (item.lower().startswith('trả nợ') or item.lower().startswith('trả '))
    
    if is_debt or is_receivable or is_repayment or is_payment:
        name = item.strip()
        words_to_remove = ['trả nợ', 'thu nợ', 'đòi nợ', 'trả', 'nợ', 'vay', 'mượn', 'gửi', 'nhờ', 'tiền']
        for word in words_to_remove:
            name = re.sub(r'(?i)\b' + re.escape(word) + r'\b', '', name)
            name = re.sub(r'(?i)' + re.escape(word) + r'\s*', '', name)
        name = re.sub(r'\s+', ' ', name).strip()
        return name if name else item
    return None

def migrate_database():
    with DB_LOCK:
        db = load_db()
        updated = False
        for tx in db.get('transactions', []):
            if 'partner' not in tx:
                partner = get_normalized_partner(tx.get('item', ''), tx.get('group', ''), tx.get('category', ''))
                if partner:
                    tx['partner'] = partner
                    updated = True
        if updated:
            save_db(db)
            print("Database migration: Added 'partner' field where needed.")

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # doesn't even have to be reachable
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

class ZenFinanceHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

    def check_authorization(self, db):
        auth_status = verify_auth(self.headers, db)
        if auth_status == 'SETUP_REQUIRED':
            self.send_json_response(401, {'status': 'setup_required', 'message': 'Password setup is required'})
            return False
        elif auth_status == 'UNAUTHORIZED':
            self.send_json_response(401, {'status': 'error', 'message': 'Unauthorized'})
            return False
        return True

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path

        if path == '/' or path == '':
            self.send_response(301)
            self.send_header('Location', '/frontend/index.html')
            self.end_headers()
            return

        if path == '/api/data':
            with DB_LOCK:
                try:
                    db = load_db()
                    if not self.check_authorization(db):
                        return
                        
                    response_data = {
                        'fi_target': db.get('fi_target', 4500000000),
                        'transactions': db.get('transactions', []),
                        'local_ip': get_local_ip()
                    }
                    self.send_json_response(200, response_data)
                except Exception as e:
                    self.send_error_json(500, f"Error reading database: {str(e)}")
            return

        # Serve static files
        super().do_GET()

    def do_POST(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path

        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else "{}"
        
        try:
            req_data = json.loads(post_data) if post_data else {}
        except Exception:
            req_data = {}

        if path == '/api/setup-auth':
            with DB_LOCK:
                try:
                    password = req_data.get('password')
                    if not password:
                        self.send_error_json(400, "Missing password parameter")
                        return
                        
                    db = load_db()
                    if db.get('password_hash'):
                        self.send_error_json(400, "Authentication already configured")
                        return
                        
                    p_hash = hash_password(password)
                    db['password_hash'] = p_hash
                    save_db(db)
                    self.send_json_response(200, {'status': 'success', 'token': p_hash})
                except Exception as e:
                    self.send_error_json(500, f"Error setting up authentication: {str(e)}")
            return

        elif path == '/api/login':
            with DB_LOCK:
                try:
                    password = req_data.get('password')
                    if not password:
                        self.send_error_json(400, "Missing password parameter")
                        return
                        
                    db = load_db()
                    saved_hash = db.get('password_hash')
                    if not saved_hash:
                        self.send_json_response(401, {'status': 'setup_required', 'message': 'Password setup is required'})
                        return
                        
                    p_hash = hash_password(password)
                    if p_hash == saved_hash:
                        self.send_json_response(200, {'status': 'success', 'token': p_hash})
                    else:
                        self.send_json_response(401, {'status': 'error', 'message': 'Incorrect password'})
                except Exception as e:
                    self.send_error_json(500, f"Error during login: {str(e)}")
            return

        elif path == '/api/transaction':
            with DB_LOCK:
                try:
                    db = load_db()
                    if not self.check_authorization(db):
                        return
                        
                    # Validation
                    required = ['date', 'group', 'category', 'item', 'amount']
                    for field in required:
                        if field not in req_data or req_data[field] is None:
                            self.send_error_json(400, f"Missing required field: {field}")
                            return
                    
                    # Assign sequential and unique properties
                    if 'id' not in req_data or not req_data['id']:
                        import uuid
                        req_data['id'] = 'tx_' + str(uuid.uuid4())[:8]
                    
                    req_data['seq'] = len(db['transactions']) + 1
                    if 'sheet' not in req_data or not req_data['sheet']:
                        req_data['sheet'] = 'QUẢN LÝ WEB'
                        
                    # Auto normalize partner on backend
                    partner = get_normalized_partner(req_data.get('item', ''), req_data.get('group', ''), req_data.get('category', ''))
                    if partner:
                        req_data['partner'] = partner
                    
                    db['transactions'].append(req_data)
                    save_db(db)
                    
                    response_data = {
                        'status': 'success',
                        'fi_target': db['fi_target'],
                        'transactions': db['transactions']
                    }
                    self.send_json_response(200, response_data)
                except Exception as e:
                    self.send_error_json(500, f"Error saving transaction: {str(e)}")
            return

        elif path == '/api/delete':
            with DB_LOCK:
                try:
                    db = load_db()
                    if not self.check_authorization(db):
                        return
                        
                    tx_id = req_data.get('id')
                    if not tx_id:
                        self.send_error_json(400, "Missing required field: id")
                        return
                    
                    original_len = len(db['transactions'])
                    db['transactions'] = [t for t in db['transactions'] if t.get('id') != tx_id]
                    
                    if len(db['transactions']) == original_len:
                        self.send_error_json(404, f"Transaction with ID {tx_id} not found")
                        return
                    
                    save_db(db)
                    response_data = {
                        'status': 'success',
                        'fi_target': db['fi_target'],
                        'transactions': db['transactions']
                    }
                    self.send_json_response(200, response_data)
                except Exception as e:
                    self.send_error_json(500, f"Error deleting transaction: {str(e)}")
            return

        elif path == '/api/goal':
            with DB_LOCK:
                try:
                    db = load_db()
                    if not self.check_authorization(db):
                        return
                        
                    new_goal = req_data.get('fi_target')
                    if new_goal is None:
                        self.send_error_json(400, "Missing required field: fi_target")
                        return
                    
                    db['fi_target'] = float(new_goal)
                    save_db(db)
                    
                    response_data = {
                        'status': 'success',
                        'fi_target': db['fi_target'],
                        'transactions': db['transactions']
                    }
                    self.send_json_response(200, response_data)
                except Exception as e:
                    self.send_error_json(500, f"Error saving goal target: {str(e)}")
            return

        elif path == '/api/sync':
            with DB_LOCK:
                try:
                    db = load_db()
                    if not self.check_authorization(db):
                        return
                        
                    txs = req_data.get('transactions', [])
                    fi_target = req_data.get('fi_target')
                    
                    # Overwrite or merge
                    if txs:
                        db['transactions'] = txs
                    if fi_target is not None:
                        db['fi_target'] = float(fi_target)
                    
                    # Retroactively normalize partner on sync
                    for tx in db.get('transactions', []):
                        if 'partner' not in tx:
                            partner = get_normalized_partner(tx.get('item', ''), tx.get('group', ''), tx.get('category', ''))
                            if partner:
                                tx['partner'] = partner
                    
                    save_db(db)
                    response_data = {
                        'status': 'success',
                        'fi_target': db['fi_target'],
                        'transactions': db['transactions']
                    }
                    self.send_json_response(200, response_data)
                except Exception as e:
                    self.send_error_json(500, f"Error syncing database: {str(e)}")
            return

        elif path == '/api/reset':
            with DB_LOCK:
                try:
                    db = load_db()
                    if not self.check_authorization(db):
                        return
                        
                    # Maintain the password_hash when resetting transactions/goals
                    saved_hash = db.get('password_hash')
                    default_db = {
                        "fi_target": 4500000000,
                        "transactions": []
                    }
                    if saved_hash:
                        default_db['password_hash'] = saved_hash
                        
                    save_db(default_db)
                    response_data = {
                        'status': 'success',
                        'fi_target': default_db['fi_target'],
                        'transactions': default_db['transactions']
                    }
                    self.send_json_response(200, response_data)
                except Exception as e:
                    self.send_error_json(500, f"Error resetting database: {str(e)}")
            return

        self.send_error_json(404, "Endpoint not found")

    def send_json_response(self, status_code, data):
        response_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(response_bytes))
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.end_headers()
        self.wfile.write(response_bytes)

    def send_error_json(self, status_code, message):
        response_data = {
            'status': 'error',
            'message': message
        }
        self.send_json_response(status_code, response_data)

def run_server():
    # Set CWD to workspace root to resolve static files correctly
    workspace_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(workspace_root)
    print(f"Server working directory: {workspace_root}")
    
    # Run migrations
    migrate_database()
    
    # Try ThreadingHTTPServer for non-blocking requests if available
    if hasattr(http.server, 'ThreadingHTTPServer'):
        server_class = http.server.ThreadingHTTPServer
    else:
        server_class = socketserver.TCPServer
        server_class.allow_reuse_address = True
        
    handler = ZenFinanceHTTPRequestHandler
    with server_class(("", PORT), handler) as httpd:
        print(f"ZenFinance API Server running on port {PORT}")
        print(f"Open on this Mac: http://localhost:{PORT}/frontend/index.html")
        print(f"Open on your mobile phone: http://{get_local_ip()}:{PORT}/frontend/index.html")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == '__main__':
    run_server()
