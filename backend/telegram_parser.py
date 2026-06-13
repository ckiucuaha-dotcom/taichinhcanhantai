import re
import unicodedata

def strip_accents(text):
    if not text:
        return ""
    # Normalize to NFD to separate base characters from combining diacritics
    nfd_normalized = unicodedata.normalize('NFD', text)
    stripped = ''.join(c for c in nfd_normalized if unicodedata.category(c) != 'Mn')
    return stripped.replace('đ', 'd').replace('Đ', 'd').lower().strip()

def parse_amount(text):
    # Match patterns like: 43k, 12.45tr, 1tr, 50k, 850k, 1.5 triệu, 43
    # Pattern looks for a number (with optional decimal point or comma) followed by an optional multiplier suffix
    pattern = r'(?i)\b(\d+(?:[.,]\d+)?)\s*(k|tr|tỷ|triệu|nghìn|ngàn|củ|đ|d|vnd|vnđ)?\b'
    matches = list(re.finditer(pattern, text))
    
    if not matches:
        return None, text
        
    # We take the first matched amount (usually there's only one, or it's the primary one)
    match = matches[0]
    num_str = match.group(1).replace(',', '.') # Convert comma decimal separator to dot
    suffix = match.group(2)
    
    try:
        val = float(num_str)
    except ValueError:
        return None, text
        
    # Determine multiplier
    multiplier = 1
    if suffix:
        suffix_lower = suffix.lower()
        if suffix_lower in ['k', 'nghìn', 'ngàn']:
            multiplier = 1000
        elif suffix_lower in ['tr', 'triệu', 'củ']:
            multiplier = 1000000
        elif suffix_lower == 'tỷ':
            multiplier = 1000000000
        elif suffix_lower in ['đ', 'd', 'vnd', 'vnđ']:
            multiplier = 1
    else:
        # If no suffix is specified and the amount is less than 1000, we treat it as thousands (e.g. 43 -> 43000)
        # This is extremely common in quick personal logging
        if val < 1000:
            multiplier = 1000
            
    amount = int(val * multiplier)
    
    # Remove the matched amount from the original text to get the cleaned description
    start, end = match.span()
    cleaned_text = text[:start] + text[end:]
    # Clean up multiple spaces
    cleaned_text = re.sub(r'\s+', ' ', cleaned_text).strip()
    
    return amount, cleaned_text

def get_unique_partners(transactions):
    partners = set()
    for tx in transactions:
        p = tx.get('partner')
        if p:
            partners.add(p.strip())
    return sorted(list(partners), key=len, reverse=True)

def find_matching_partner(cleaned_desc, transactions):
    partners = get_unique_partners(transactions)
    stripped_desc = strip_accents(cleaned_desc)
    
    # Remove common verbs to isolate partner name
    verbs = ['tra no', 'thu no', 'doi no', 'tra', 'no', 'vay', 'muon', 'gui', 'nho', 'nhan', 'cho', 'tien', 'tu']
    cleaned_desc_for_partner = stripped_desc
    for v in verbs:
        cleaned_desc_for_partner = re.sub(r'\b' + re.escape(v) + r'\b', '', cleaned_desc_for_partner)
    cleaned_desc_for_partner = re.sub(r'\s+', ' ', cleaned_desc_for_partner).strip()
    
    if not cleaned_desc_for_partner:
        return None
        
    best_partner = None
    best_score = 0
    
    for partner in partners:
        sp = strip_accents(partner)
        # Exact match or substring matches
        if sp == cleaned_desc_for_partner:
            return partner
            
        if sp in cleaned_desc_for_partner or cleaned_desc_for_partner in sp:
            score = min(len(sp), len(cleaned_desc_for_partner))
            if score > best_score:
                best_score = score
                best_partner = partner
                
    if best_score >= 3:
        return best_partner
    return None

def find_historical_match(cleaned_desc, transactions):
    stripped_desc = strip_accents(cleaned_desc)
    if not stripped_desc:
        return None
        
    best_tx = None
    best_score = 0
    
    for tx in transactions:
        item = tx.get('item', '')
        sp_item = strip_accents(item)
        if not sp_item:
            continue
            
        if sp_item == stripped_desc:
            return tx
            
        if stripped_desc in sp_item or sp_item in stripped_desc:
            score = min(len(stripped_desc), len(sp_item))
            if score > best_score:
                best_score = score
                best_tx = tx
                
    if best_score >= 3:
        return best_tx
    return None

# Fallback keyword rules if historical lookup does not match
KEYWORDS = {
    ('KHOẢN CHI', 'Ăn uống'): ['an', 'uong', 'quay', 'bun', 'pho', 'mi', 'com', 'nuoc', 'bia', 'cafe', 'ca phe', 'tra', 'sua', 'banh', 'keo', 'hoa qua', 'trai cay', 'lau', 'nuong', 'nhau'],
    ('KHOẢN CHI', 'Nhu yếu phẩm'): ['xa phong', 'dau goi', 'kem danh rang', 'ban chai', 've sinh', 'giay', 'khan', 'tam', 'giat'],
    ('KHOẢN CHI', 'Mua sắm'): ['mua sam', 'quan ao', 'giay', 'dep', 'ao', 'quan', 'mu', 'kinh', 'dong ho', 'tui', 'balo'],
    ('KHOẢN CHI', 'Thư giãn'): ['game', 'phim', 'net', 'choi', 'giai tri', 'massage', 'spa'],
    ('KHOẢN CHI', 'Phát sinh'): ['thuoc', 'benh', 'vien', 'sua xe', 'xang', 'di lai', 've', 'taxi', 'grab', 'do xang', 'nho mat'],
    ('KHOẢN CHI', 'Cấp tiền TG'): ['cap tien tg', 'tien tg', 'tg'],
    ('KHOẢN CHI', 'Mua đồ d'): ['mua do d', 'do d'],
    ('KHOẢN THU', 'Lương'): ['luong', 'phu cap', 'salary'],
    ('KHOẢN THU', 'Buôn bán'): ['ban', 'buon', 'sua rua mat', 'kem duong', 'my pham', 'thanh ly'],
    ('KHOẢN THU', 'Nhận tiền D'): ['tieu doan', 'd', 'td'],
    ('DOANH THU ĐẦU TƯ', 'Doanh thu đầu tư'): ['co phieu', 'fpt', 'ssb', 'vang', 'dau tu', 'lai', 'co tuc', 'crypto', 'bitcoin']
}

def get_normalized_partner_local(item, group, category):
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

def is_partner_match(p1, p2):
    if not p1 or not p2:
        return False
    sp1 = strip_accents(p1)
    sp2 = strip_accents(p2)
    return sp1 in sp2 or sp2 in sp1

def parse_transaction(message_text, transactions):
    """
    Parses a transaction message and returns a dict with details:
    {
      "date": "YYYY-MM-DD",
      "group": "...",
      "category": "...",
      "item": "...",
      "amount": ...,
      "partner": "..." (optional)
    }
    """
    import datetime
    
    # 1. NFC normalize input message
    message_text = unicodedata.normalize('NFC', message_text).strip()
    
    # 2. Extract amount
    amount, cleaned_desc = parse_amount(message_text)
    if amount is None:
        return None
        
    # 3. Find partner
    partner = find_matching_partner(cleaned_desc, transactions)
    
    # 4. Check for Debt / Repayment / Lending keywords
    stripped_desc = strip_accents(cleaned_desc)
    
    group = None
    category = None
    item = cleaned_desc
    
    # Rule 1: Paying back debt (e.g. "a Hoà bếp trả nợ", "Hoà trả", "trả nợ")
    if 'tra' in stripped_desc or 'thu no' in stripped_desc:
        group = 'KHOẢN THU'
        category = 'Nợ trả'
        if partner:
            item = f"{partner} trả"
        else:
            item = cleaned_desc if cleaned_desc else "Trả nợ"
            
    # Rule 2: Lending money to someone (e.g. "Cho Chiến bTT vay", "Hoàng bếp mượn")
    elif 'cho' in stripped_desc and ('vay' in stripped_desc or 'muon' in stripped_desc):
        group = 'ĐÒI NỢ'
        category = 'Đòi nợ'
        if partner:
            item = partner
        else:
            item = cleaned_desc
            
    # Rule 3: Borrowing money from someone (e.g. "Vay DCCD", "Mượn Điện TG")
    elif 'vay' in stripped_desc or 'muon' in stripped_desc:
        group = 'KHOẢN NỢ'
        category = 'Khoản nợ'
        if partner:
            item = partner
        else:
            item = cleaned_desc
            
    # Rule 4: Match historical transaction for item or partner
    if not group:
        hist_match = find_historical_match(cleaned_desc, transactions)
        if hist_match:
            group = hist_match.get('group')
            category = hist_match.get('category')
            item = hist_match.get('item')
            if 'partner' in hist_match:
                partner = hist_match.get('partner')
                
    # Rule 5: Fallback to keyword rules
    if not group:
        words = stripped_desc.split()
        for (g, c), kw_list in KEYWORDS.items():
            if any(kw in stripped_desc for kw in kw_list):
                group = g
                category = c
                break
                
    # Rule 6: Absolute default
    if not group:
        group = 'KHOẢN CHI'
        category = 'Phát sinh'
        
    # Post-processing: For Repayments, try to find an existing "Nợ trả" transaction for the same partner to copy the item name (e.g. "a Hoà trả")
    if group == 'KHOẢN THU' and category == 'Nợ trả' and partner:
        for tx in transactions:
            if tx.get('group') == 'KHOẢN THU' and tx.get('category') == 'Nợ trả':
                tx_partner = tx.get('partner')
                if not tx_partner:
                    tx_partner = get_normalized_partner_local(tx.get('item', ''), tx.get('group', ''), tx.get('category', ''))
                if tx_partner and is_partner_match(tx_partner, partner):
                    item = tx.get('item')
                    break

    # Set date to today
    date_str = datetime.date.today().strftime('%Y-%m-%d')
    
    res = {
        "date": date_str,
        "group": group,
        "category": category,
        "item": item,
        "amount": amount
    }
    if partner:
        res["partner"] = partner
        
    return res

