import os
import sys
import json
import time
import requests
import threading

# Ensure backend folder is in path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import telegram_parser

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'telegram_config.json')

def load_config():
    if not os.path.exists(CONFIG_PATH):
        return None
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Telegram Bot: Error loading config: {e}")
        return None

def save_config(config):
    try:
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"Telegram Bot: Error saving config: {e}")
        return False

def load_auth_token():
    # Read database.json in parent folder to get the password_hash
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'database.json')
    try:
        with open(db_path, 'r', encoding='utf-8') as f:
            db = json.load(f)
        return db.get('password_hash')
    except Exception as e:
        print(f"Telegram Bot: Error loading auth token: {e}")
        return None

def convert_number_to_words(number):
    if number == 0:
        return 'Không đồng'
    if number >= 1000000000:
        billion = number // 1000000000
        million = (number % 1000000000) // 1000000
        return f"Khoảng {billion} tỷ {f'{million} triệu ' if million > 0 else ''}đồng"
    elif number >= 1000000:
        million = number // 1000000
        thousand = (number % 1000000) // 1000
        return f"Khoảng {million} triệu {f'{thousand} nghìn ' if thousand > 0 else ''}đồng"
    elif number >= 1000:
        thousand = number // 1000
        hundred = (number % 1000)
        return f"{thousand} nghìn {f'{hundred} đồng' if hundred > 0 else 'đồng'}"
    return f"{number} đồng"

def send_message(url, chat_id, text, reply_markup=None):
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        requests.post(url + "sendMessage", json=payload, timeout=10)
    except Exception as e:
        print(f"Telegram Bot: Error sending message: {e}")

def edit_message_text(url, chat_id, message_id, text):
    payload = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        requests.post(url + "editMessageText", json=payload, timeout=10)
    except Exception as e:
        print(f"Telegram Bot: Error editing message: {e}")

def handle_callback(url, callback, pending_txs):
    callback_id = callback["id"]
    chat_id = callback["message"]["chat"]["id"]
    message_id = callback["message"]["message_id"]
    data = callback.get("data")
    
    # Acknowledge the callback query
    try:
        requests.post(url + "answerCallbackQuery", json={"callback_query_id": callback_id}, timeout=5)
    except Exception:
        pass
    
    if data == "confirm":
        tx = pending_txs.get(chat_id)
        if not tx:
            edit_message_text(url, chat_id, message_id, "❌ Không tìm thấy giao dịch chờ xác nhận.")
            return
            
        token = load_auth_token()
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
            
        try:
            api_url = "http://localhost:8000/api/transaction"
            res = requests.post(api_url, json=tx, headers=headers, timeout=10)
            if res.status_code == 200:
                amount_formatted = f"{tx['amount']:,.0f}".replace(",", ".")
                edit_message_text(url, chat_id, message_id, 
                    f"✅ <b>Đã lưu giao dịch thành công!</b>\n"
                    f"• Nội dung: <b>{tx['item']}</b>\n"
                    f"• Số tiền: <b>{amount_formatted} đ</b>\n"
                    f"• Nhóm: {tx['group']} / {tx['category']}\n"
                    f"• Ngày: {tx['date']}"
                )
                
                # Play Sound Notifier
                import subprocess
                try:
                    subprocess.run(["/Users/ckiucuaha/.gemini/antigravity/scratch/agent_sound_notifier/notify.sh", "success"])
                except Exception:
                    pass
                
                # Send macOS notification banner
                try:
                    import os
                    os.system(f"osascript -e 'display notification \"Đã thêm {tx['item']}: {amount_formatted}đ\" with title \"ZenFinance - Telegram\"'")
                except Exception:
                    pass
                
                # Clear pending
                if chat_id in pending_txs:
                    del pending_txs[chat_id]
            else:
                try:
                    err_msg = res.json().get('message', 'Không xác định')
                except Exception:
                    err_msg = res.text
                edit_message_text(url, chat_id, message_id, f"❌ Lỗi lưu giao dịch từ API: {err_msg}")
        except Exception as e:
            edit_message_text(url, chat_id, message_id, f"❌ Không thể kết nối đến API Server: {e}")
            
    elif data == "cancel":
        if chat_id in pending_txs:
            del pending_txs[chat_id]
        edit_message_text(url, chat_id, message_id, "❌ Đã hủy yêu cầu thêm giao dịch.")

def handle_command(url, chat_id, text):
    if text.startswith('/start') or text.startswith('/help'):
        help_text = (
            f"<b>Chào mừng bạn đến với ZenFinance Bot!</b>\n\n"
            f"Bot này giúp bạn nhập giao dịch cực nhanh bằng tin nhắn.\n\n"
            f"<b>Cú pháp mẫu:</b>\n"
            f"• <code>Mua quẩy 15k</code> (Ăn uống)\n"
            f"• <code>a Hoà bếp trả nợ 43k</code> (Nợ trả, tự động khớp đối tác)\n"
            f"• <code>Thuốc nhỏ mắt 40k</code> (Phát sinh)\n"
            f"• <code>Tôi mới nhận thêm 50k từ Tiểu đoàn</code> (Nhận tiền D)\n"
            f"• <code>Bún 35</code> (Tự động nhân thành 35.000 đ)\n\n"
            f"Sau khi gửi tin nhắn, bạn chỉ cần nhấn nút <b>[Xác nhận]</b> để lưu giao dịch."
        )
        send_message(url, chat_id, help_text)

def handle_transaction_text(url, chat_id, text, pending_txs):
    # Load historical transactions for parsing context
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'database.json')
    try:
        with open(db_path, 'r', encoding='utf-8') as f:
            db = json.load(f)
        transactions = db.get('transactions', [])
    except Exception:
        transactions = []
        
    tx = telegram_parser.parse_transaction(text, transactions)
    if not tx:
        send_message(url, chat_id, "Không tìm thấy số tiền hợp lệ. Cú pháp mẫu:\n• <code>Mua quẩy 15k</code>\n• <code>a Hoà bếp trả nợ 43k</code>")
        return
        
    # Store pending transaction in memory
    pending_txs[chat_id] = tx
    
    amount_formatted = f"{tx['amount']:,.0f}".replace(",", ".")
    amount_words = convert_number_to_words(tx['amount'])
    partner_info = f"\n• Đối tác: <b>{tx['partner']}</b>" if 'partner' in tx else ""
    
    confirm_text = (
        f"❓ <b>Xác nhận lưu giao dịch?</b>\n\n"
        f"• Nội dung: <b>{tx['item']}</b>\n"
        f"• Số tiền: <b>{amount_formatted} đ</b>\n"
        f"  <i>({amount_words})</i>\n"
        f"• Phân loại: {tx['group']} / {tx['category']}"
        f"{partner_info}\n"
        f"• Ngày ghi: {tx['date']}"
    )
    
    reply_markup = {
        "inline_keyboard": [
            [
                {"text": "Xác nhận ✅", "callback_data": "confirm"},
                {"text": "Hủy bỏ ❌", "callback_data": "cancel"}
            ]
        ]
    }
    
    send_message(url, chat_id, confirm_text, reply_markup=reply_markup)

def main_loop():
    config = load_config()
    if not config or not config.get('bot_token'):
        print("Telegram Bot: Bot token not configured. Exiting.")
        return
        
    bot_token = config['bot_token']
    url = f"https://api.telegram.org/bot{bot_token}/"
    offset = 0
    pending_txs = {}
    
    print("Telegram Bot: Daemon service started successfully.")
    
    while True:
        try:
            response = requests.get(url + "getUpdates", params={"offset": offset, "timeout": 30}, timeout=35)
            if response.status_code != 200:
                print(f"Telegram Bot: Error response code {response.status_code}")
                time.sleep(5)
                continue
                
            data = response.json()
            if not data.get("ok"):
                print(f"Telegram Bot: API error: {data}")
                time.sleep(5)
                continue
                
            updates = data.get("result", [])
            for update in updates:
                offset = update["update_id"] + 1
                
                # Callback Queries (Inline buttons)
                if "callback_query" in update:
                    handle_callback(url, update["callback_query"], pending_txs)
                    continue
                    
                if "message" not in update:
                    continue
                    
                msg = update["message"]
                chat_id = msg["chat"]["id"]
                
                # Check authorization
                config = load_config()
                allowed_ids = config.get("allowed_chat_ids", [])
                
                # Bind first chat ID to bot if list is empty
                if not allowed_ids:
                    allowed_ids.append(chat_id)
                    config["allowed_chat_ids"] = allowed_ids
                    save_config(config)
                    send_message(url, chat_id, "<b>Liên kết thành công!</b>\nTừ nay bot chỉ chấp nhận các giao dịch gửi từ tài khoản Telegram này của bạn.")
                    continue
                    
                if chat_id not in allowed_ids:
                    send_message(url, chat_id, f"Bạn không có quyền truy cập bot này. ID của bạn: <code>{chat_id}</code>")
                    continue
                    
                if "text" not in msg:
                    continue
                    
                text = msg["text"].strip()
                if text.startswith('/'):
                    handle_command(url, chat_id, text)
                else:
                    handle_transaction_text(url, chat_id, text, pending_txs)
                    
        except requests.exceptions.ConnectionError:
            print("Telegram Bot: Connection error, retrying in 5 seconds...")
            time.sleep(5)
        except Exception as e:
            print(f"Telegram Bot: Loop error: {e}")
            time.sleep(5)

def start_bot_thread():
    thread = threading.Thread(target=main_loop, daemon=True)
    thread.start()
    return thread

if __name__ == '__main__':
    # Start bot directly if executed as script
    main_loop()
