import json
import sys
import os
import uuid

def main():
    if len(sys.argv) < 6:
        print("Usage: python3 add_tx_json.py <date> <group> <category> <item> <amount>")
        sys.exit(1)
        
    date_str = sys.argv[1] # YYYY-MM-DD
    group = sys.argv[2]
    category = sys.argv[3]
    item = sys.argv[4]
    amount = float(sys.argv[5])
    
    db_path = 'database.json'
    if os.path.exists(db_path):
        with open(db_path, 'r', encoding='utf-8') as f:
            db = json.load(f)
    else:
        db = {"fi_target": 4500000000.0, "transactions": []}
        
    # Find the sheet name of the last transaction to keep it consistent
    sheet_name = 'QUẢN LÝ APP'
    if db['transactions']:
        sheet_name = db['transactions'][-1].get('sheet', 'QUẢN LÝ APP')
        
    tx = {
        "id": "tx_" + str(uuid.uuid4())[:8],
        "seq": len(db['transactions']) + 1,
        "date": date_str,
        "group": group,
        "category": category,
        "item": item,
        "amount": amount,
        "sheet": sheet_name
    }
    
    db['transactions'].append(tx)
    
    with open(db_path, 'w', encoding='utf-8') as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
        
    print(f"Successfully added to database.json as seq {tx['seq']}: {item} - {amount} VND")

if __name__ == '__main__':
    main()
