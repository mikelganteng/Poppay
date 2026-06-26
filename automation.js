# UG/3M-NS3 AUTO DEPOSIT SERVER (Python + Flask)
# Maintain 3M-NS3 admin session + handle webhook → create admin deposit
# VERSION: 1.0.0
#
# COOKIE IMPORT METHODS (Priority order):
# 1. cookies_ug.json - Browser extension export (recommended for quick setup)
# 2. session_ug.json - Auto-saved session from previous login
# 3. Playwright login - Manual browser login with captcha solve
#
# To use browser cookies:
# 1. Install "Cookie Editor" extension
# 2. Login to 3m-ns3-admin.com
# 3. Export cookies as JSON
# 4. Save as cookies_ug.json in same folder
# 5. Run the server - it will auto-import!

from flask import Flask, request, jsonify
import requests
import json
import base64
import time
import asyncio
import os
import re
from datetime import datetime
from threading import Thread, Lock
from queue import Queue, Empty
from urllib.parse import quote, unquote
from playwright.async_api import async_playwright

app = Flask(__name__)

# ============================================================================
# QUEUE SYSTEM FOR HIGH-VOLUME WEBHOOKS
# ============================================================================
webhook_queue = Queue()
queue_workers_started = False
queue_lock = Lock()

# Enable CORS for all routes
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    return response

# ============================================================================
# CONFIGURATION
# ============================================================================

CONFIG = {
    'BACKOFFICE_URL': 'https://3m-ns3-admin.com',
    
    # LOGIN CREDENTIALS
    'EMAIL': 'your-email@example.com',  # Change this
    'PASSWORD': 'your-password',         # Change this
    
    # Deposit Settings
    'DEPOSIT_METHOD': '7',  # 5=Bank, 6=Pulsa, 7=E-wallet, 8=Crypto, 9=QRIS
    'DEFAULT_EWALLET_ID': 'DANA*-*081133566777777*-*6a3c1e3bfa60d7216d0cc996',  # DANA-POPPAY
    'DEFAULT_SENDER_BANK': 'michael yonathan-BCA-1390883630',  # Only used for Bank method
    
    # Queue System
    'USE_QUEUE': True,
    'QUEUE_WORKERS': 5,
    
    'SESSION_REFRESH_HOURS': 20,
    'PORT': 3000
}

# ============================================================================
# SESSION MANAGER
# ============================================================================

SESSION = {
    'cookies': '',
    'csrfToken': '',
    'lastRefresh': None,
    'valid': False
}

# Activity logs
ACTIVITY_LOGS = []
MAX_LOGS = 100

# Transaction and webhook logs
TRANSACTION_LOGS = []
WEBHOOK_LOGS = []
MAX_DEBUG_LOGS = 50

def log_activity(message, level='INFO'):
    """Log activity with timestamp"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = {
        'timestamp': timestamp,
        'level': level,
        'message': message
    }
    
    with queue_lock:
        ACTIVITY_LOGS.append(log_entry)
        if len(ACTIVITY_LOGS) > MAX_LOGS:
            ACTIVITY_LOGS.pop(0)
    
    print(f'[{timestamp}] [{level}] {message}')

def log_webhook(webhook_data):
    """Log webhook data to memory and file"""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = {
        'timestamp': timestamp,
        'data': webhook_data
    }
    
    with queue_lock:
        WEBHOOK_LOGS.append(log_entry)
        if len(WEBHOOK_LOGS) > MAX_DEBUG_LOGS:
            WEBHOOK_LOGS.pop(0)
    
    # Append to webhook.txt
    try:
        with open('webhook.txt', 'a', encoding='utf-8') as f:
            f.write(f"\n{'='*70}\n")
            f.write(f"[{timestamp}] WEBHOOK RECEIVED\n")
            f.write(f"{'='*70}\n")
            f.write(json.dumps(webhook_data, indent=2))
            f.write("\n")
    except Exception as e:
        print(f'[LOG] Warning: Cannot write to webhook.txt: {str(e)}')

def log_transaction(transaction_data):
    """Log transaction data to memory and file
    
    Format: invoice_id|username|amount|paid_at|refid|status
    """
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    log_entry = {
        'timestamp': timestamp,
        'data': transaction_data
    }
    
    with queue_lock:
        TRANSACTION_LOGS.append(log_entry)
        if len(TRANSACTION_LOGS) > MAX_DEBUG_LOGS:
            TRANSACTION_LOGS.pop(0)
    
    # Append to transaction.txt in pipe-separated format
    try:
        invoice_id = transaction_data.get('invoice_id', 'N/A')
        username = transaction_data.get('username', 'N/A')
        amount = transaction_data.get('amount', 0)
        paid_at = transaction_data.get('paid_at', timestamp)
        refid = transaction_data.get('refid', 'N/A')
        status = transaction_data.get('status', 'unknown')
        
        line = f"{invoice_id}|{username}|{amount}|{paid_at}|{refid}|{status}\n"
        
        with open('transaction.txt', 'a', encoding='utf-8') as f:
            f.write(line)
            
        print(f'[LOG] ✓ Logged to transaction.txt: {invoice_id}')
    except Exception as e:
        print(f'[LOG] Warning: Cannot write to transaction.txt: {str(e)}')

def check_duplicate_refid(refid):
    """Check if refid already exists in transaction.txt
    
    Args:
        refid: Reference ID to check
        
    Returns:
        bool: True if duplicate (already exists), False if new
    """
    if not refid or refid == 'N/A':
        return False
    
    try:
        if not os.path.exists('transaction.txt'):
            return False
        
        with open('transaction.txt', 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                
                # Format: invoice_id|username|amount|paid_at|refid|status
                parts = line.split('|')
                if len(parts) >= 5:
                    existing_refid = parts[4].strip()
                    if existing_refid == refid:
                        return True
        
        return False
    except Exception as e:
        print(f'[LOG] Warning: Cannot read transaction.txt: {str(e)}')
        return False

async def playwright_login():
    """Login using Playwright (manual captcha solve)"""
    print('[PLAYWRIGHT LOGIN] Starting browser...')
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=False,
            args=['--start-maximized']
        )
        
        try:
            context = await browser.new_context(viewport=None)
            page = await context.new_page()
            
            print('[PLAYWRIGHT LOGIN] Opening login page...')
            await page.goto(f"{CONFIG['BACKOFFICE_URL']}/login", wait_until='networkidle')
            
            current_url = page.url
            if '/login' not in current_url:
                print('[PLAYWRIGHT LOGIN] Already logged in!')
            else:
                print('[PLAYWRIGHT LOGIN] Filling email & password...')
                await page.wait_for_selector('input[name="email"]', timeout=5000)
                await page.fill('input[name="email"]', CONFIG['EMAIL'])
                await page.fill('input[name="password"]', CONFIG['PASSWORD'])
                
                print('\n' + '=' * 50)
                print('  PLEASE SOLVE CAPTCHA (if any) AND CLICK LOGIN')
                print('=' * 50 + '\n')
                
                print('[PLAYWRIGHT LOGIN] Waiting for login...')
                await page.wait_for_url(lambda url: '/login' not in url, timeout=300000)
            
            print('[PLAYWRIGHT LOGIN] Login successful!')
            
            # Navigate to admin deposit page to ensure cookies are set
            print('[PLAYWRIGHT LOGIN] Navigating to admin deposit page...')
            await page.goto(f"{CONFIG['BACKOFFICE_URL']}/admin_deposit", wait_until='networkidle')
            print('[PLAYWRIGHT LOGIN] ✓ Admin deposit page loaded')
            
            await page.wait_for_timeout(2000)
            
            print(f'[PLAYWRIGHT LOGIN] Current URL: {page.url}')
            print('[PLAYWRIGHT LOGIN] Extracting cookies & CSRF token...')
            
            cookies = await context.cookies()
            print(f'[PLAYWRIGHT LOGIN] Total cookies: {len(cookies)}')
            
            # Build cookie string
            cookie_parts = []
            for c in cookies:
                cookie_parts.append(f"{c['name']}={c['value']}")
            cookie_string = '; '.join(cookie_parts)
            
            # Extract CSRF token from multiple sources
            csrf_token = None
            
            # Try 1: Meta tag csrf-token
            try:
                csrf_token = await page.eval_on_selector(
                    'meta[name="csrf-token"]',
                    'el => el.getAttribute("content")'
                )
                if csrf_token:
                    print(f'[PLAYWRIGHT LOGIN] ✓ CSRF token from <meta name="csrf-token">')
            except:
                pass
            
            # Try 2: Input hidden _token
            if not csrf_token:
                try:
                    csrf_token = await page.eval_on_selector(
                        'input[name="_token"]',
                        'el => el.value'
                    )
                    if csrf_token:
                        print(f'[PLAYWRIGHT LOGIN] ✓ CSRF token from <input name="_token">')
                except:
                    pass
            
            # Try 3: From cookies (XSRF-TOKEN)
            if not csrf_token:
                for cookie in cookies:
                    if cookie['name'] == 'XSRF-TOKEN':
                        csrf_token = unquote(cookie['value'])
                        print(f'[PLAYWRIGHT LOGIN] ✓ CSRF token from XSRF-TOKEN cookie')
                        break
            
            # Try 4: Extract from page HTML
            if not csrf_token:
                try:
                    page_content = await page.content()
                    
                    # Try meta tag in HTML
                    meta_match = re.search(r'<meta name="csrf-token" content="([^"]+)"', page_content)
                    if meta_match:
                        csrf_token = meta_match.group(1)
                        print(f'[PLAYWRIGHT LOGIN] ✓ CSRF token from HTML meta tag')
                    else:
                        # Try input hidden
                        input_match = re.search(r'<input[^>]*name="_token"[^>]*value="([^"]+)"', page_content)
                        if input_match:
                            csrf_token = input_match.group(1)
                            print(f'[PLAYWRIGHT LOGIN] ✓ CSRF token from HTML input')
                except:
                    pass
            
            if not csrf_token:
                print('[PLAYWRIGHT LOGIN] ⚠ CSRF token not found, will extract later from API calls')
                csrf_token = ''
            else:
                print(f'[PLAYWRIGHT LOGIN] ✓ CSRF Token: {csrf_token[:30]}...')
            
            print('[PLAYWRIGHT LOGIN] ✓ Cookies extracted!')
            
            await browser.close()
            
            return {
                'cookies': cookie_string,
                'csrfToken': csrf_token
            }
            
        except Exception as error:
            print(f'[PLAYWRIGHT LOGIN] ✗ Failed: {str(error)}')
            await browser.close()
            raise

def test_session_valid():
    """Test if current session is valid"""
    if not SESSION['valid']:
        return False
    
    try:
        print(f'[SESSION] Testing session validity...')
        
        response = requests.get(
            f"{CONFIG['BACKOFFICE_URL']}/admin_deposit",
            headers={
                'Cookie': SESSION['cookies'],
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': f"{CONFIG['BACKOFFICE_URL']}/",
            },
            allow_redirects=False,
            timeout=10
        )
        
        print(f'[SESSION] Response status: {response.status_code}')
        
        if response.status_code == 302:
            location = response.headers.get('Location', '')
            print(f'[SESSION] Redirect to: {location}')
            
            # Check if redirecting to login
            if 'login' in location.lower():
                print('[SESSION] ✗ Session expired (redirected to login)')
                SESSION['valid'] = False
                return False
            
            # Some sites redirect to dashboard/home, which is OK
            print('[SESSION] ✓ Redirect to non-login page (OK)')
            return True
        
        if response.status_code == 200:
            # Double check that we're not on login page
            if 'login' in response.url.lower() or '<form' in response.text and 'password' in response.text.lower():
                print('[SESSION] ✗ On login page despite 200 status')
                SESSION['valid'] = False
                return False
            
            print('[SESSION] ✓ Session is valid')
            return True
        
        if response.status_code == 403:
            print('[SESSION] 403 = Forbidden, attempting to continue...')
            return True
        
        print(f'[SESSION] Unexpected status: {response.status_code}')
        SESSION['valid'] = False
        return False
        
    except Exception as error:
        print(f'[SESSION] Test error: {str(error)}')
        SESSION['valid'] = False
        return False

def refresh_csrf_token():
    """Get fresh CSRF token from page"""
    try:
        print('[CSRF] Refreshing CSRF token...')
        
        response = requests.get(
            f"{CONFIG['BACKOFFICE_URL']}/admin_deposit",
            headers={
                'Cookie': SESSION['cookies'],
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            allow_redirects=True
        )
        
        if response.status_code != 200:
            print(f'[CSRF] ✗ Cannot get page (status {response.status_code})')
            return False
        
        page_content = response.text
        csrf_token = None
        
        # Try multiple extraction methods
        
        # 1. Meta tag csrf-token
        meta_match = re.search(r'<meta name="csrf-token" content="([^"]+)"', page_content)
        if meta_match:
            csrf_token = meta_match.group(1)
            print(f"[CSRF] ✓ Token from <meta name='csrf-token'>")
        
        # 2. Input hidden _token
        if not csrf_token:
            input_match = re.search(r'<input[^>]*name="_token"[^>]*value="([^"]+)"', page_content)
            if input_match:
                csrf_token = input_match.group(1)
                print(f"[CSRF] ✓ Token from <input name='_token'>")
        
        # 3. From Set-Cookie header (XSRF-TOKEN)
        if not csrf_token:
            set_cookie = response.headers.get('Set-Cookie', '')
            xsrf_match = re.search(r'XSRF-TOKEN=([^;]+)', set_cookie)
            if xsrf_match:
                csrf_token = unquote(xsrf_match.group(1))
                print(f"[CSRF] ✓ Token from Set-Cookie XSRF-TOKEN")
        
        if csrf_token:
            SESSION['csrfToken'] = csrf_token
            print(f"[CSRF] ✓ Token: {csrf_token[:30]}...")
            save_session_to_file(SESSION['cookies'], SESSION['csrfToken'])
            return True
        
        print('[CSRF] ⚠ Could not find CSRF token in page')
        return False
        
    except Exception as e:
        print(f'[CSRF] ✗ Error: {str(e)}')
        return False

def auto_confirm_transaction(username, amount, refid, promotion=None):
    """Auto-confirm transaction by finding it in instant transaction page
    
    Args:
        username: Member username to match
        amount: Deposit amount to match
        refid: Reference ID to match
        promotion: Promotion code (optional) - used for bonus detection
        
    Returns:
        dict: {'confirmed': bool, 'bonus_detected': bool, 'transaction_count': int}
    """
    try:
        print(f'[CONFIRM] Searching for transaction: {username} - Rp {amount:,} - Ref: {refid}')
        if promotion:
            print(f'[CONFIRM] Promotion provided: {promotion} - will check for bonus')
        
        # Wait 3 seconds for transaction to appear in system
        print('[CONFIRM] Waiting 3 seconds for transaction to appear...')
        time.sleep(3)
        
        # Fetch the instant transaction page
        print('[CONFIRM] Fetching instant transaction page...')
        response = requests.get(
            f"{CONFIG['BACKOFFICE_URL']}/transactions/new_instant_transaction/ajax?view_name=deposit_only&record_type=1",
            headers={
                'Cookie': SESSION['cookies'],
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': f"{CONFIG['BACKOFFICE_URL']}/transactions/instant_transaction/deposit_only"
            },
            timeout=15
        )
        
        if response.status_code != 200:
            print(f'[CONFIRM] ✗ Cannot fetch transaction page (status {response.status_code})')
            return False
        
        html_content = response.text
        
        # Parse HTML to find matching transaction
        # Format amount for matching (remove decimals, add commas)
        amount_formatted = f"{int(amount):,}.00"
        
        print(f'[CONFIRM] Looking for: Username={username}, Amount={amount_formatted}')
        
        # Find all transaction rows
        # Pattern: Look for username in <span id="trans_XXX">username</span> and amount in nearby td
        transactions = re.finditer(
            r'<span id="trans_([^"]+)">([^<]+)</span>.*?'
            r'<td align="right" class="amount_font td_credit">.*?'
            r'<div[^>]*>\s*([0-9,]+\.\d{2})\s*</div>',
            html_content,
            re.DOTALL
        )
        
        transaction_id = None
        user_transactions = []  # Track all transactions for this user
        
        for match in transactions:
            trans_id = match.group(1)
            found_username = match.group(2).strip()
            found_amount = match.group(3).strip()
            
            print(f'[CONFIRM] Found transaction: ID={trans_id}, User={found_username}, Amount={found_amount}')
            
            # Track all transactions for this user (for bonus detection)
            if found_username == username:
                user_transactions.append({
                    'id': trans_id,
                    'amount': found_amount,
                    'amount_raw': float(found_amount.replace(',', ''))
                })
            
            # Find exact match for main deposit
            if found_username == username and found_amount == amount_formatted:
                transaction_id = trans_id
                print(f'[CONFIRM] ✓ Match found! Transaction ID: {transaction_id}')
        
        # Bonus detection
        bonus_detected = False
        if promotion and len(user_transactions) > 1:
            print(f'[CONFIRM] ✓ Multiple transactions detected ({len(user_transactions)}) - bonus likely applied')
            bonus_detected = True
            for txn in user_transactions:
                if txn['amount'] != amount_formatted:
                    print(f'[CONFIRM] ✓ Bonus transaction found: Rp {txn["amount"]} (ID: {txn["id"]})')
        elif promotion and len(user_transactions) == 1:
            print(f'[CONFIRM] ⚠️ WARNING: Promotion "{promotion}" provided but only 1 transaction found')
            print(f'[CONFIRM] ⚠️ Promo may be invalid/expired or user does not meet requirements')
            log_activity(f"⚠️ PROMO NOT APPLIED: {username} - Code: {promotion} (invalid/expired?)", 'WARNING')
        
        if not transaction_id:
            print('[CONFIRM] ✗ Transaction not found in list')
            # Save HTML for debugging
            with open('debug_transaction_list.html', 'w', encoding='utf-8') as f:
                f.write(html_content)
            print('[CONFIRM] Saved transaction list to debug_transaction_list.html')
            return {
                'confirmed': False,
                'bonus_detected': False,
                'transaction_count': len(user_transactions)
            }
        
        # Confirm the transaction
        print(f'[CONFIRM] Confirming transaction {transaction_id}...')
        confirm_url = f"{CONFIG['BACKOFFICE_URL']}/transactions/instant_transaction/confirm/{transaction_id}"
        
        confirm_res = requests.get(
            confirm_url,
            headers={
                'Cookie': SESSION['cookies'],
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': f"{CONFIG['BACKOFFICE_URL']}/transactions/instant_transaction/deposit_only"
            },
            params={'view_redirect': 'deposit'},
            timeout=15
        )
        
        print(f'[CONFIRM] Response status: {confirm_res.status_code}')
        
        if confirm_res.status_code == 200:
            # Check response for success
            try:
                response_json = confirm_res.json()
                if response_json.get('s') == 'success':
                    print(f'[CONFIRM] ✅ Transaction confirmed! Message: {response_json.get("m")}')
                    log_activity(f"✅ AUTO-CONFIRM SUCCESS: {username} - Transaction {transaction_id}", 'SUCCESS')
                    return {
                        'confirmed': True,
                        'bonus_detected': bonus_detected,
                        'transaction_count': len(user_transactions)
                    }
                else:
                    print(f'[CONFIRM] ✗ Confirm failed: {response_json.get("m")}')
                    log_activity(f"❌ AUTO-CONFIRM FAILED: {username} - {response_json.get('m')}", 'ERROR')
                    return {
                        'confirmed': False,
                        'bonus_detected': False,
                        'transaction_count': len(user_transactions)
                    }
            except:
                # Response might not be JSON
                print('[CONFIRM] ✓ Confirm request sent (response not JSON)')
                log_activity(f"✓ AUTO-CONFIRM SENT: {username} - Transaction {transaction_id}", 'INFO')
                return {
                    'confirmed': True,
                    'bonus_detected': bonus_detected,
                    'transaction_count': len(user_transactions)
                }
        else:
            print(f'[CONFIRM] ✗ Confirm request failed with status {confirm_res.status_code}')
            return {
                'confirmed': False,
                'bonus_detected': False,
                'transaction_count': len(user_transactions)
            }
        
    except Exception as e:
        print(f'[CONFIRM] ✗ Error: {str(e)}')
        log_activity(f"❌ AUTO-CONFIRM ERROR: {username} - {str(e)}", 'ERROR')
        return False

def convert_cookies_json_to_string(cookies_json):
    """Convert cookies from JSON array format to cookie string
    
    Args:
        cookies_json: List of cookie objects from browser extension
        
    Returns:
        Cookie string in format: "name1=value1; name2=value2"
    """
    try:
        if isinstance(cookies_json, str):
            cookies_json = json.loads(cookies_json)
        
        cookie_parts = []
        for cookie in cookies_json:
            name = cookie.get('name')
            value = cookie.get('value')
            if name and value:
                cookie_parts.append(f"{name}={value}")
        
        return '; '.join(cookie_parts)
    except Exception as e:
        print(f'[COOKIE] Error converting cookies: {str(e)}')
        return None

def load_cookies_from_json_file():
    """Load cookies from cookies_ug.json (browser export format)"""
    try:
        if not os.path.exists('cookies_ug.json'):
            return None
        
        print('[SESSION] Found cookies_ug.json, loading...')
        
        with open('cookies_ug.json', 'r') as f:
            cookies_json = json.load(f)
        
        cookie_string = convert_cookies_json_to_string(cookies_json)
        if not cookie_string:
            return None
        
        # Extract CSRF token from XSRF-TOKEN cookie
        csrf_token = None
        for cookie in cookies_json:
            if cookie.get('name') == 'XSRF-TOKEN':
                # Decode URL-encoded value
                csrf_value = unquote(cookie.get('value', ''))
                csrf_token = csrf_value
                print(f'[SESSION] ✓ CSRF token extracted from XSRF-TOKEN cookie')
                break
        
        if not csrf_token:
            print('[SESSION] ⚠ XSRF-TOKEN not found in cookies, will extract from page')
        
        return {
            'cookies': cookie_string,
            'csrfToken': csrf_token
        }
        
    except Exception as e:
        print(f'[SESSION] Error loading cookies_ug.json: {str(e)}')
        return None

def load_session_from_file():
    """Load session from session_ug.json if exists and valid"""
    try:
        if not os.path.exists('session_ug.json'):
            return None
        
        with open('session_ug.json', 'r') as f:
            data = json.load(f)
        
        extracted_at = data.get('extractedAt')
        if extracted_at:
            extracted_time = datetime.fromisoformat(extracted_at)
            age = datetime.now() - extracted_time
            
            if age.total_seconds() > 20 * 3600:  # 20 hours
                print('[SESSION] ✗ Saved session too old (>20 hours)')
                return None
        
        return {
            'cookies': data.get('cookies'),
            'csrfToken': data.get('csrfToken')
        }
    except Exception as e:
        print(f'[SESSION] Warning: Cannot load session file: {str(e)}')
        return None

def save_session_to_file(cookies, csrf_token):
    """Save session to session_ug.json"""
    try:
        data = {
            'cookies': cookies,
            'csrfToken': csrf_token,
            'extractedAt': datetime.now().isoformat()
        }
        with open('session_ug.json', 'w') as f:
            json.dump(data, f, indent=2)
        print('[SESSION] ✓ Session saved to session_ug.json')
    except Exception as e:
        print(f'[SESSION] Warning: Cannot save session: {str(e)}')

def session_keeper_loop():
    """Monitor session validity and auto-refresh every 30 minutes"""
    while True:
        time.sleep(30 * 60)  # Check every 30 minutes
        
        elapsed = time.time() - SESSION['lastRefresh']
        hours = elapsed / 3600
        
        print(f"[SESSION KEEPER] Elapsed: {hours:.1f} hours")
        
        # Auto-refresh session to keep Laravel session alive
        print('[SESSION KEEPER] Auto-refreshing session...')
        try:
            refresh_response = requests.get(
                f"{CONFIG['BACKOFFICE_URL']}/admin_deposit",
                headers={
                    'Cookie': SESSION['cookies'],
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout=10
            )
            
            if refresh_response.status_code == 200:
                print('[SESSION KEEPER] ✓ Session refreshed successfully')
                log_activity('✓ Session auto-refreshed', 'INFO')
            else:
                print(f'[SESSION KEEPER] ⚠ Refresh returned status {refresh_response.status_code}')
        except Exception as e:
            print(f'[SESSION KEEPER] ⚠ Refresh error: {str(e)}')
        
        # Test session validity
        valid = test_session_valid()
        if not valid:
            print('[SESSION KEEPER] Session invalid! Need re-login.')
            print('[SESSION KEEPER] Please restart the server to re-login.')
            log_activity('❌ Session invalid - restart required', 'ERROR')
        else:
            print('[SESSION KEEPER] Session still valid')
            
            if hours >= CONFIG['SESSION_REFRESH_HOURS']:
                print('[SESSION KEEPER] ⚠️ Session approaching expiry. Consider restarting server soon.')
                log_activity('⚠️ Session approaching expiry', 'WARNING')

def start_session_keeper():
    """Initialize session and start background monitor"""
    print('[SESSION KEEPER] Starting...')
    
    # Priority 1: Try cookies_ug.json (browser export)
    print('[SESSION KEEPER] Step 1: Checking for cookies_ug.json...')
    cookies_from_json = load_cookies_from_json_file()
    
    if cookies_from_json and cookies_from_json['cookies']:
        print('[SESSION KEEPER] Found cookies from cookies_ug.json, testing validity...')
        
        SESSION['cookies'] = cookies_from_json['cookies']
        SESSION['csrfToken'] = cookies_from_json.get('csrfToken', '')
        SESSION['lastRefresh'] = time.time()
        SESSION['valid'] = True
        
        # If no CSRF token in cookies, try to get from page
        if not SESSION['csrfToken']:
            print('[SESSION] No CSRF token in cookies, extracting from page...')
            refresh_csrf_token()
        
        if test_session_valid():
            print('[SESSION] ✓ Browser cookies are VALID! Skipping login.')
            print('[SESSION] ✓ Session active and ready')
            
            # Save to session_ug.json for future use
            save_session_to_file(SESSION['cookies'], SESSION['csrfToken'])
            
            keeper_thread = Thread(target=session_keeper_loop, daemon=True)
            keeper_thread.start()
            return
        else:
            print('[SESSION] ✗ Browser cookies are invalid/expired')
    
    # Priority 2: Try session_ug.json (saved session)
    print('[SESSION KEEPER] Step 2: Checking for session_ug.json...')
    saved_session = load_session_from_file()
    
    if saved_session and saved_session['cookies'] and saved_session['csrfToken']:
        print('[SESSION KEEPER] Found saved session, testing validity...')
        
        SESSION['cookies'] = saved_session['cookies']
        SESSION['csrfToken'] = saved_session['csrfToken']
        SESSION['lastRefresh'] = time.time()
        SESSION['valid'] = True
        
        if test_session_valid():
            print('[SESSION] ✓ Saved session is VALID! Skipping login.')
            print('[SESSION] ✓ Session active and ready')
            
            keeper_thread = Thread(target=session_keeper_loop, daemon=True)
            keeper_thread.start()
            return
        else:
            print('[SESSION] ✗ Saved session is invalid/expired')
    
    # Priority 3: Browser login with Playwright
    print('[SESSION KEEPER] Step 3: Launching browser for login...')
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        result = loop.run_until_complete(playwright_login())
        
        SESSION['cookies'] = result['cookies']
        SESSION['csrfToken'] = result['csrfToken']
        SESSION['lastRefresh'] = time.time()
        SESSION['valid'] = True
        
        print('[SESSION] ✓ Cookies loaded from Playwright login')
        
        valid = test_session_valid()
        if not valid:
            print('[SESSION] ✗ Session validation failed!')
            exit(1)
        print('[SESSION] ✓ Session validated and active')
        
        save_session_to_file(result['cookies'], result['csrfToken'])
        
    except Exception as e:
        print(f'[SESSION] ✗ Login failed: {str(e)}')
        exit(1)
    finally:
        loop.close()
    
    keeper_thread = Thread(target=session_keeper_loop, daemon=True)
    keeper_thread.start()

# ============================================================================
# ADMIN DEPOSIT CREATOR
# ============================================================================

def create_admin_deposit(username, amount, payment_source='bank', auto_approve=False, invoice_id=None, refid=None, paid_at=None, promotion=None):
    """Create admin deposit in 3M-NS3 backoffice
    
    Args:
        username: Member username
        amount: Deposit amount
        payment_source: 'bank', 'pulsa', 'qris', etc.
        auto_approve: Enable auto-approve (not applicable for admin deposit)
        invoice_id: Invoice ID for reference number
        refid: Reference ID for reason
        paid_at: Payment timestamp
        promotion: Promotion code (optional)
    """
    log_activity(f"🎯 Creating admin deposit: {username} - Rp {amount:,}" + (f" | Promo: {promotion}" if promotion else ""), 'INFO')
    print(f"[DEPOSIT] Creating admin deposit: {username} - Rp {amount:,}")
    print(f"[DEPOSIT] Parameters received: invoice_id={invoice_id}, refid={refid}, paid_at={paid_at}, promotion={promotion}")
    
    if not SESSION['valid']:
        raise Exception('Session expired. Please restart server to re-login.')
    
    try:
        # Step 1: Search member and get form
        print('[DEPOSIT] Step 1: Searching member...')
        
        search_data = {
            'user_search_data': username,
            'key': 'user_name'
        }
        
        search_res = requests.post(
            f"{CONFIG['BACKOFFICE_URL']}/admin_deposit_form",
            data=search_data,
            headers={
                'Cookie': SESSION['cookies'],
                'X-CSRF-TOKEN': SESSION['csrfToken'],
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': f"{CONFIG['BACKOFFICE_URL']}/admin_deposit"
            }
        )
        
        print(f'[DEPOSIT] Response status: {search_res.status_code}')
        
        if search_res.status_code == 419:
            print('[DEPOSIT] 419 = CSRF token expired, refreshing...')
            log_activity("⚠️ CSRF token expired, auto-refreshing...", 'WARNING')
            if refresh_csrf_token():
                print('[DEPOSIT] Retrying with fresh CSRF token...')
                return create_admin_deposit(username, amount, payment_source, auto_approve, invoice_id, refid, paid_at, promotion)
            else:
                raise Exception('CSRF token expired and refresh failed. Please restart server.')
        
        if search_res.status_code != 200:
            raise Exception(f"Member search failed: HTTP {search_res.status_code}")
        
        # Debug: Save response for inspection
        print(f'[DEPOSIT] Response length: {len(search_res.text)} bytes')
        
        # Always save response for debugging
        with open('debug_member_search.html', 'w', encoding='utf-8') as f:
            f.write(search_res.text)
        
        # Check multiple "not found" indicators
        not_found_indicators = [
            'Don\'t Have Any',
            'not found',
            'No results found',
            'User not exist',
            'Member does not exist',
            'Invalid username',
            'Please enter a valid username'
        ]
        
        response_lower = search_res.text.lower()
        is_not_found = any(indicator.lower() in response_lower for indicator in not_found_indicators)
        
        # Also check if response contains form fields (indicates member found)
        has_member_form = (
            'id="agent_id"' in search_res.text or
            'name="agent_id"' in search_res.text or
            'name="deposit_amount"' in search_res.text or
            'name="user_name"' in search_res.text
        )
        
        print(f'[DEPOSIT] has_member_form: {has_member_form}')
        print(f'[DEPOSIT] is_not_found: {is_not_found}')
        
        # If form fields exist, member is found (ignore "not found" text in other parts)
        if has_member_form:
            print(f'[DEPOSIT] ✓ Member form detected, proceeding with extraction')
        elif is_not_found:
            print(f'[DEPOSIT] ✗ Member not found based on indicators')
            print(f'[DEPOSIT] Response preview:')
            preview = search_res.text[:1000] if len(search_res.text) > 1000 else search_res.text
            print(preview)
            raise Exception(f"Member {username} not found")
        
        if not has_member_form:
            print(f'[DEPOSIT] ⚠️ No form fields detected, but no "not found" message either')
            print(f'[DEPOSIT] Response might be in different format. Check debug_member_search.html')
            print(f'[DEPOSIT] Response preview:')
            preview = search_res.text[:2000] if len(search_res.text) > 2000 else search_res.text
            print(preview)
        
        # Try multiple patterns to extract agent_id (support both single and double quotes)
        agent_id = None
        
        # Pattern 1: name="agent_id" value='...' or value="..."
        agent_id_match = re.search(r'name=["\']agent_id["\']\s+value=["\']([^"\']+)["\']', search_res.text)
        if agent_id_match:
            agent_id = agent_id_match.group(1)
            print(f'[DEPOSIT] ✓ agent_id extracted: {agent_id}')
        
        # Pattern 2: value='...' name="agent_id" or value="..." name='agent_id'
        if not agent_id:
            agent_id_match = re.search(r'value=["\']([^"\']+)["\']\s+name=["\']agent_id["\']', search_res.text)
            if agent_id_match:
                agent_id = agent_id_match.group(1)
                print(f'[DEPOSIT] ✓ agent_id extracted: {agent_id}')
        
        # Pattern 3: id="agent_id" ... value='...' or value="..."
        if not agent_id:
            agent_id_match = re.search(r'id=["\']agent_id["\'][^>]*value=["\']([^"\']+)["\']', search_res.text)
            if agent_id_match:
                agent_id = agent_id_match.group(1)
                print(f'[DEPOSIT] ✓ agent_id extracted: {agent_id}')
        
        # Pattern 4: JSON response (if API returns JSON)
        if not agent_id:
            try:
                json_data = search_res.json()
                agent_id = json_data.get('agent_id') or json_data.get('data', {}).get('agent_id')
                if agent_id:
                    print(f'[DEPOSIT] ✓ agent_id from JSON: {agent_id}')
            except:
                pass
        
        if not agent_id:
            # Debug output
            print('[DEPOSIT] ✗ Cannot extract agent_id, response preview:')
            preview = search_res.text[:1000] if len(search_res.text) > 1000 else search_res.text
            print(preview)
            print('[DEPOSIT] Saving full response to debug_response.html...')
            with open('debug_response.html', 'w', encoding='utf-8') as f:
                f.write(search_res.text)
            raise Exception('Cannot extract agent_id from response. Check debug_response.html')
        
        print(f"[DEPOSIT] ✓ Member found: {username} (Agent ID: {agent_id})")
        log_activity(f"✓ Member found: {username} | Agent ID: {agent_id}", 'SUCCESS')
        
        # Step 2: Submit deposit
        print('[DEPOSIT] Step 2: Submitting admin deposit...')
        
        # Prepare deposit data based on method
        deposit_method = CONFIG['DEPOSIT_METHOD']
        deposit_data = {
            '_token': SESSION['csrfToken'],
            'user_name': username,
            'agent_id': agent_id,
            'deposit_method': deposit_method,
            'deposit_amount': str(int(amount)),
            'reference_no': invoice_id if invoice_id else f'AUTO-{int(time.time())}',
            'reason': refid if refid else 'Auto deposit from bot'
        }
        
        # Add promotion if provided
        if promotion:
            deposit_data['promotion_id'] = promotion
            deposit_data['promo_or_subsidy'] = '0'
            deposit_data['promotion_subsidi'] = '0'
            print(f"[DEPOSIT] ✓ Promotion included: {promotion}")
        
        # Add payment method specific fields
        if deposit_method == '5':  # Bank
            deposit_data['new_method_id'] = CONFIG.get('DEFAULT_BANK_ID', '')
            deposit_data['sender_bank_id'] = CONFIG.get('DEFAULT_SENDER_BANK', '')
        elif deposit_method == '7':  # E-wallet
            deposit_data['new_method_id'] = CONFIG.get('DEFAULT_EWALLET_ID', '')
        elif deposit_method == '6':  # Pulsa
            deposit_data['new_method_id'] = CONFIG.get('DEFAULT_PULSA_ID', '')
        elif deposit_method == '9':  # QRIS
            deposit_data['new_method_id'] = CONFIG.get('DEFAULT_QRIS_ID', '')
        
        deposit_res = requests.post(
            f"{CONFIG['BACKOFFICE_URL']}/save_admin_deposit",
            data=deposit_data,
            headers={
                'Cookie': SESSION['cookies'],
                'X-CSRF-TOKEN': SESSION['csrfToken'],
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0',
                'Referer': f"{CONFIG['BACKOFFICE_URL']}/admin_deposit"
            },
            allow_redirects=False
        )
        
        print(f'[DEPOSIT] Response status: {deposit_res.status_code}')
        
        if deposit_res.status_code == 500:
            print('[DEPOSIT] ✗ 500 Internal Server Error')
            print(f'[DEPOSIT] Response: {deposit_res.text[:500]}')
            raise Exception('Server error when creating deposit')
        
        if deposit_res.status_code in [200, 302]:
            print('[DEPOSIT] ✓ Admin deposit submitted!')
            log_activity(f"✅ DEPOSIT SUCCESS! {username} - Rp {amount:,}", 'SUCCESS')
            
            result = {
                'success': True,
                'username': username,
                'amount': amount,
                'agent_id': agent_id,
                'invoice_id': invoice_id,
                'refid': refid,
                'message': 'Admin deposit created successfully'
            }
            
            # Step 3: Auto-confirm the transaction
            print('[DEPOSIT] Step 3: Auto-confirming transaction...')
            confirm_result = auto_confirm_transaction(username, amount, refid, promotion)
            
            if confirm_result['confirmed']:
                result['confirmed'] = True
                result['bonus_detected'] = confirm_result['bonus_detected']
                result['transaction_count'] = confirm_result['transaction_count']
                
                if promotion and not confirm_result['bonus_detected']:
                    result['message'] = 'Admin deposit created and confirmed, but promotion may not have been applied'
                    result['promo_warning'] = f'Promotion "{promotion}" may be invalid or user does not meet requirements'
                else:
                    result['message'] = 'Admin deposit created and confirmed successfully'
                
                # Log transaction ONLY after confirmation (format: invoice_id|username|amount|paid_at|refid|status)
                log_transaction({
                    'invoice_id': invoice_id or 'N/A',
                    'username': username,
                    'amount': amount,
                    'paid_at': paid_at or datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'refid': refid or 'N/A',
                    'status': 'confirmed' + (f'_no_bonus' if promotion and not confirm_result['bonus_detected'] else '')
                })
            else:
                result['confirmed'] = False
                result['bonus_detected'] = False
                result['message'] = 'Admin deposit created but auto-confirm failed'
                
                # Log failed confirmation
                log_transaction({
                    'invoice_id': invoice_id or 'N/A',
                    'username': username,
                    'amount': amount,
                    'paid_at': paid_at or datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    'refid': refid or 'N/A',
                    'status': 'confirm_failed'
                })
            
            return result
        else:
            raise Exception(f"Unexpected response status: {deposit_res.status_code}")
        
    except Exception as error:
        print(f'[DEPOSIT] ✗ Failed: {str(error)}')
        log_activity(f"❌ DEPOSIT FAILED: {username} - {str(error)}", 'ERROR')
        raise

# ============================================================================
# QUEUE WORKER
# ============================================================================

def process_webhook_job(job_data):
    """Process a single webhook job from queue"""
    username = job_data['username']
    amount = job_data['amount']
    invoice_id = job_data.get('invoice_id')
    refid = job_data.get('refid')
    paid_at = job_data.get('paid_at')
    promotion = job_data.get('promotion')
    
    try:
        # Double-check for duplicates (in case multiple workers)
        if refid and check_duplicate_refid(refid):
            print(f'[WORKER] ⚠️ DUPLICATE DETECTED! Refid {refid} already processed, skipping...')
            log_activity(f"⚠️ DUPLICATE SKIPPED: {username} - Refid {refid}", 'WARNING')
            return False
        
        print(f'\n[WORKER] Processing: {username} - Rp {amount:,}')
        print(f'[WORKER] Invoice ID: {invoice_id}')
        print(f'[WORKER] Refid: {refid}')
        print(f'[WORKER] Paid at: {paid_at}')
        print(f'[WORKER] Promotion: {promotion if promotion else "None"}')
        log_activity(f"⚙️ Worker processing: {username} - Rp {amount:,}" + (f" | Promo: {promotion}" if promotion else ""), 'INFO')
        
        result = create_admin_deposit(
            username, 
            amount, 
            payment_source='ewallet', 
            auto_approve=True,
            invoice_id=invoice_id,
            refid=refid,
            paid_at=paid_at,
            promotion=promotion
        )
        
        print(f'[WORKER] ✅ SUCCESS: {username}')
        log_activity(f"✅ Worker success: {username}", 'SUCCESS')
        
        return True
        
    except Exception as e:
        print(f'[WORKER] ❌ FAILED: {username} - {str(e)}')
        log_activity(f"❌ Worker failed: {username} - {str(e)}", 'ERROR')
        return False

def webhook_worker(worker_id):
    """Background worker that processes webhook queue"""
    print(f'[WORKER-{worker_id}] Started')
    
    while True:
        try:
            job_data = webhook_queue.get(timeout=1)
            process_webhook_job(job_data)
            webhook_queue.task_done()
            
        except Empty:
            continue
        except Exception as e:
            print(f'[WORKER-{worker_id}] Error: {str(e)}')
            continue

def start_queue_workers(num_workers=5):
    """Start background workers to process webhook queue"""
    global queue_workers_started
    
    if queue_workers_started:
        return
    
    print(f'\n[QUEUE] Starting {num_workers} workers...')
    
    for i in range(num_workers):
        worker = Thread(target=webhook_worker, args=(i+1,), daemon=True)
        worker.start()
    
    queue_workers_started = True
    print(f'[QUEUE] ✓ {num_workers} workers started\n')

# ============================================================================
# WEBHOOK ENDPOINT
# ============================================================================

@app.route('/webhook', methods=['POST'])
def webhook():
    """Handle webhook for auto deposit"""
    data = request.get_json()
    print('\n' + '=' * 70)
    print('[WEBHOOK] Received webhook')
    print('=' * 70)
    print(f'Data: {json.dumps(data, indent=2)}')
    
    # Log webhook to file and memory
    log_webhook(data)
    
    username = data.get('username')
    amount = data.get('amount')
    
    log_activity(f"📥 Webhook: {username} - Rp {amount:,}", 'INFO')
    
    if not username or not amount:
        log_activity(f"❌ Invalid webhook payload", 'ERROR')
        return jsonify({
            'success': False,
            'error': 'Missing username or amount'
        }), 400
    
    try:
        amount = float(amount)
    except:
        log_activity(f"❌ Invalid amount format", 'ERROR')
        return jsonify({
            'success': False,
            'error': 'Invalid amount format'
        }), 400
    
    # Extract invoice_id, refid, paid_at, and promotion from webhook payload
    invoice_id = data.get('invoice_id')
    refid = data.get('refid')
    paid_at = data.get('paid_at')
    promotion = data.get('promotion')
    
    print(f'[WEBHOOK] invoice_id: {invoice_id}')
    print(f'[WEBHOOK] refid: {refid}')
    print(f'[WEBHOOK] paid_at: {paid_at}')
    print(f'[WEBHOOK] promotion: {promotion if promotion else "None"}')
    log_activity(f"📋 Ref: {invoice_id} | Reason: {refid}" + (f" | Promo: {promotion}" if promotion else ""), 'INFO')
    
    # Check for duplicate refid
    if refid and check_duplicate_refid(refid):
        print(f'[WEBHOOK] ⚠️ DUPLICATE DETECTED! Refid {refid} already processed')
        log_activity(f"⚠️ DUPLICATE SKIPPED: {username} - Refid {refid} already exists", 'WARNING')
        return jsonify({
            'success': False,
            'error': 'Duplicate transaction',
            'message': f'Refid {refid} has already been processed'
        }), 409
    
    # Queue mode or direct processing
    if CONFIG['USE_QUEUE']:
        job_data = {
            'username': username,
            'amount': amount,
            'invoice_id': invoice_id,
            'refid': refid,
            'paid_at': paid_at,
            'promotion': promotion,
            'timestamp': datetime.now().isoformat()
        }
        webhook_queue.put(job_data)
        queue_size = webhook_queue.qsize()
        
        print(f'[WEBHOOK] ✓ Added to queue (Queue size: {queue_size})')
        log_activity(f"✓ Added to queue: {username} | Queue: {queue_size}" + (f" | Promo: {promotion}" if promotion else ""), 'INFO')
        
        return jsonify({
            'success': True,
            'message': 'Added to queue',
            'queueSize': queue_size
        })
    else:
        # Direct processing (synchronous)
        try:
            result = create_admin_deposit(
                username, 
                amount, 
                payment_source='ewallet', 
                auto_approve=True,
                invoice_id=invoice_id,
                refid=refid,
                paid_at=paid_at,
                promotion=promotion
            )
            return jsonify({
                'success': True,
                'message': 'Deposit created successfully',
                'data': result
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500

# ============================================================================
# MANUAL DEPOSIT ENDPOINT
# ============================================================================

@app.route('/manual-deposit', methods=['POST'])
def manual_deposit():
    """Manual deposit creation (for testing/manual trigger)"""
    data = request.get_json()
    username = data.get('username')
    amount = data.get('amount')
    invoice_id = data.get('invoice_id')
    refid = data.get('refid')
    paid_at = data.get('paid_at')
    promotion = data.get('promotion')
    
    if not username or not amount:
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
    
    # Check for duplicate refid
    if refid and check_duplicate_refid(refid):
        print(f'[MANUAL] ⚠️ DUPLICATE DETECTED! Refid {refid} already processed')
        log_activity(f"⚠️ DUPLICATE SKIPPED: {username} - Refid {refid} already exists", 'WARNING')
        return jsonify({
            'success': False,
            'error': 'Duplicate transaction',
            'message': f'Refid {refid} has already been processed'
        }), 409
    
    try:
        result = create_admin_deposit(
            username, 
            amount, 
            payment_source='ewallet', 
            auto_approve=True,
            invoice_id=invoice_id,
            refid=refid,
            paid_at=paid_at,
            promotion=promotion
        )
        return jsonify({
            'success': True,
            'message': 'Deposit created successfully',
            'data': result
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================================
# STATUS & MONITORING ENDPOINTS
# ============================================================================

@app.route('/status', methods=['GET'])
def status():
    """Server status endpoint"""
    return jsonify({
        'status': 'running',
        'sessionValid': SESSION['valid'],
        'queueSize': webhook_queue.qsize() if CONFIG['USE_QUEUE'] else 0,
        'queueEnabled': CONFIG['USE_QUEUE'],
        'workers': CONFIG['QUEUE_WORKERS'] if CONFIG['USE_QUEUE'] else 0,
        'config': {
            'backofficeUrl': CONFIG['BACKOFFICE_URL'],
            'useQueue': CONFIG['USE_QUEUE'],
            'depositMethod': CONFIG['DEPOSIT_METHOD']
        }
    })

@app.route('/logs', methods=['GET'])
def logs():
    """Get recent activity logs"""
    limit = int(request.args.get('limit', 50))
    
    with queue_lock:
        recent_logs = ACTIVITY_LOGS[-limit:] if len(ACTIVITY_LOGS) > limit else ACTIVITY_LOGS[:]
    
    return jsonify({
        'success': True,
        'total': len(ACTIVITY_LOGS),
        'returned': len(recent_logs),
        'logs': recent_logs
    })

@app.route('/session/refresh', methods=['POST'])
def refresh_session():
    """Manually refresh CSRF token"""
    try:
        if refresh_csrf_token():
            return jsonify({
                'success': True,
                'message': 'CSRF token refreshed successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to refresh CSRF token'
            }), 500
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health():
    """Simple health check"""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/debug', methods=['GET'])
def debug():
    """Debug page to view recent webhooks and transactions"""
    limit = int(request.args.get('limit', 20))
    
    with queue_lock:
        recent_webhooks = WEBHOOK_LOGS[-limit:] if len(WEBHOOK_LOGS) > limit else WEBHOOK_LOGS[:]
        recent_transactions = TRANSACTION_LOGS[-limit:] if len(TRANSACTION_LOGS) > limit else TRANSACTION_LOGS[:]
        recent_logs = ACTIVITY_LOGS[-50:] if len(ACTIVITY_LOGS) > 50 else ACTIVITY_LOGS[:]
    
    return f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Debug - UG Auto Deposit</title>
        <meta charset="UTF-8">
        <meta http-equiv="refresh" content="10">
        <style>
            body {{
                font-family: 'Consolas', 'Monaco', monospace;
                max-width: 1400px;
                margin: 20px auto;
                padding: 20px;
                background: #1e1e1e;
                color: #d4d4d4;
            }}
            .container {{
                background: #252526;
                padding: 20px;
                border-radius: 8px;
                margin-bottom: 20px;
            }}
            h1 {{
                color: #4ec9b0;
                border-bottom: 2px solid #4ec9b0;
                padding-bottom: 10px;
            }}
            h2 {{
                color: #569cd6;
                margin-top: 30px;
            }}
            .section {{
                margin: 20px 0;
            }}
            .log-entry {{
                background: #1e1e1e;
                padding: 10px;
                margin: 10px 0;
                border-radius: 4px;
                border-left: 3px solid #4ec9b0;
            }}
            .webhook {{
                border-left-color: #ce9178;
            }}
            .transaction {{
                border-left-color: #569cd6;
            }}
            .activity {{
                border-left-color: #dcdcaa;
            }}
            .timestamp {{
                color: #608b4e;
                font-weight: bold;
            }}
            pre {{
                background: #1e1e1e;
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
                color: #ce9178;
            }}
            .stats {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
                margin: 20px 0;
            }}
            .stat-card {{
                background: #1e1e1e;
                padding: 15px;
                border-radius: 4px;
                border-left: 3px solid #4ec9b0;
            }}
            .stat-value {{
                font-size: 32px;
                font-weight: bold;
                color: #4ec9b0;
            }}
            .stat-label {{
                color: #858585;
                font-size: 12px;
            }}
            .refresh {{
                color: #858585;
                font-size: 12px;
                text-align: center;
                margin-top: 20px;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🐛 DEBUG DASHBOARD</h1>
            <div class="refresh">⟳ Auto-refresh every 10 seconds</div>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-label">TOTAL WEBHOOKS</div>
                    <div class="stat-value">{len(WEBHOOK_LOGS)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">TOTAL TRANSACTIONS</div>
                    <div class="stat-value">{len(TRANSACTION_LOGS)}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">QUEUE SIZE</div>
                    <div class="stat-value">{webhook_queue.qsize()}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">SESSION STATUS</div>
                    <div class="stat-value">{'✓' if SESSION['valid'] else '✗'}</div>
                </div>
            </div>
            
            <h2>📥 Recent Webhooks (Last {len(recent_webhooks)})</h2>
            <div class="section">
                {_render_webhooks(recent_webhooks)}
            </div>
            
            <h2>💳 Recent Transactions (Last {len(recent_transactions)})</h2>
            <div class="section">
                {_render_transactions(recent_transactions)}
            </div>
            
            <h2>📊 Recent Activity Logs (Last 50)</h2>
            <div class="section">
                {_render_logs(recent_logs)}
            </div>
        </div>
    </body>
    </html>
    '''

def _render_webhooks(webhooks):
    """Render webhook logs as HTML"""
    if not webhooks:
        return '<div class="log-entry webhook">No webhooks received yet</div>'
    
    html = []
    for log in reversed(webhooks):
        data_json = json.dumps(log['data'], indent=2)
        html.append(f'''
        <div class="log-entry webhook">
            <div class="timestamp">[{log['timestamp']}] WEBHOOK</div>
            <pre>{data_json}</pre>
        </div>
        ''')
    return ''.join(html)

def _render_transactions(transactions):
    """Render transaction logs as HTML"""
    if not transactions:
        return '<div class="log-entry transaction">No transactions processed yet</div>'
    
    html = []
    for log in reversed(transactions):
        data_lines = []
        for key, value in log['data'].items():
            data_lines.append(f"{key}: {value}")
        data_text = '\\n'.join(data_lines)
        
        html.append(f'''
        <div class="log-entry transaction">
            <div class="timestamp">[{log['timestamp']}] TRANSACTION</div>
            <pre>{data_text}</pre>
        </div>
        ''')
    return ''.join(html)

def _render_logs(logs):
    """Render activity logs as HTML"""
    if not logs:
        return '<div class="log-entry activity">No activity logs yet</div>'
    
    html = []
    for log in reversed(logs):
        html.append(f'''
        <div class="log-entry activity">
            <span class="timestamp">[{log['timestamp']}]</span> 
            <span style="color: {'#f48771' if log['level'] == 'ERROR' else '#4ec9b0' if log['level'] == 'SUCCESS' else '#dcdcaa'};">[{log['level']}]</span>
            {log['message']}
        </div>
        ''')
    return ''.join(html)

@app.route('/', methods=['GET'])
def home():
    """Dashboard endpoint"""
    return f'''
    <!DOCTYPE html>
    <html>
    <head>
        <title>UG Auto Deposit Server</title>
        <meta charset="UTF-8">
        <style>
            body {{
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                max-width: 1200px;
                margin: 40px auto;
                padding: 20px;
                background: #f5f5f5;
            }}
            .container {{
                background: white;
                padding: 30px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }}
            h1 {{
                color: #2c3e50;
                border-bottom: 3px solid #3498db;
                padding-bottom: 10px;
            }}
            .status {{
                display: inline-block;
                padding: 5px 15px;
                border-radius: 20px;
                font-weight: bold;
                margin-left: 10px;
            }}
            .status.active {{
                background: #2ecc71;
                color: white;
            }}
            .status.inactive {{
                background: #e74c3c;
                color: white;
            }}
            .info-grid {{
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 20px;
                margin: 20px 0;
            }}
            .info-card {{
                background: #ecf0f1;
                padding: 20px;
                border-radius: 8px;
                border-left: 4px solid #3498db;
            }}
            .info-card h3 {{
                margin-top: 0;
                color: #2c3e50;
                font-size: 14px;
                text-transform: uppercase;
            }}
            .info-card p {{
                margin: 10px 0 0 0;
                font-size: 24px;
                font-weight: bold;
                color: #3498db;
            }}
            .endpoint {{
                background: #2c3e50;
                color: white;
                padding: 15px;
                border-radius: 5px;
                margin: 10px 0;
                font-family: monospace;
            }}
            .endpoint code {{
                color: #2ecc71;
            }}
            pre {{
                background: #2c3e50;
                color: #ecf0f1;
                padding: 15px;
                border-radius: 5px;
                overflow-x: auto;
            }}
            .logs {{
                max-height: 400px;
                overflow-y: auto;
                background: #2c3e50;
                color: #ecf0f1;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
                font-family: monospace;
                font-size: 12px;
            }}
            .log-entry {{
                margin: 5px 0;
                padding: 5px;
                border-left: 3px solid #3498db;
                padding-left: 10px;
            }}
            .log-entry.ERROR {{
                border-left-color: #e74c3c;
            }}
            .log-entry.SUCCESS {{
                border-left-color: #2ecc71;
            }}
            .log-entry.WARNING {{
                border-left-color: #f39c12;
            }}
            button {{
                background: #3498db;
                color: white;
                border: none;
                padding: 10px 20px;
                border-radius: 5px;
                cursor: pointer;
                font-size: 14px;
                margin: 5px;
            }}
            button:hover {{
                background: #2980b9;
            }}
        </style>
    </head>
    <body>
        <div class="container">
            <h1>
                🚀 UG Auto Deposit Server
                <span class="status {'active' if SESSION['valid'] else 'inactive'}" id="sessionStatus">
                    {'🟢 ACTIVE' if SESSION['valid'] else '🔴 INACTIVE'}
                </span>
            </h1>
            
            <div class="info-grid">
                <div class="info-card">
                    <h3>Session Status</h3>
                    <p id="sessionValid">{'✓ Valid' if SESSION['valid'] else '✗ Invalid'}</p>
                </div>
                <div class="info-card">
                    <h3>Queue Size</h3>
                    <p id="queueSize">{webhook_queue.qsize()}</p>
                </div>
                <div class="info-card">
                    <h3>Queue Workers</h3>
                    <p>{CONFIG['QUEUE_WORKERS'] if CONFIG['USE_QUEUE'] else 0}</p>
                </div>
                <div class="info-card">
                    <h3>Total Logs</h3>
                    <p id="totalLogs">{len(ACTIVITY_LOGS)}</p>
                </div>
            </div>
            
            <h2>📡 API Endpoints</h2>
            
            <div class="endpoint">
                <strong>POST</strong> <code>/webhook</code> - Webhook untuk auto deposit<br>
                Payload: {{"username": "user123", "amount": 100000}}
            </div>
            
            <div class="endpoint">
                <strong>POST</strong> <code>/manual-deposit</code> - Manual deposit<br>
                Payload: {{"username": "user123", "amount": 100000}}
            </div>
            
            <div class="endpoint">
                <strong>GET</strong> <code>/status</code> - Server status
            </div>
            
            <div class="endpoint">
                <strong>GET</strong> <code>/logs?limit=50</code> - Activity logs
            </div>
            
            <div class="endpoint">
                <strong>POST</strong> <code>/session/refresh</code> - Refresh CSRF token
            </div>
            
            <h2>📊 Recent Activity</h2>
            <button onclick="refreshLogs()">🔄 Refresh Logs</button>
            <button onclick="refreshStatus()">📊 Refresh Status</button>
            <div class="logs" id="logsContainer">
                Loading logs...
            </div>
            
            <h2>🧪 Test Webhook</h2>
            <div style="background: #ecf0f1; padding: 20px; border-radius: 8px;">
                <pre>curl -X POST http://localhost:{CONFIG['PORT']}/webhook \\
  -H "Content-Type: application/json" \\
  -d '{{"username": "testuser", "amount": 50000}}'</pre>
            </div>
            
            <h2>⚙️ Configuration</h2>
            <div style="background: #ecf0f1; padding: 20px; border-radius: 8px;">
                <p><strong>Backoffice URL:</strong> {CONFIG['BACKOFFICE_URL']}</p>
                <p><strong>Queue Mode:</strong> {'Enabled' if CONFIG['USE_QUEUE'] else 'Disabled'}</p>
                <p><strong>Deposit Method:</strong> {CONFIG['DEPOSIT_METHOD']}</p>
                <p><strong>Port:</strong> {CONFIG['PORT']}</p>
            </div>
        </div>
        
        <script>
            function refreshLogs() {{
                fetch('/logs?limit=100')
                    .then(res => res.json())
                    .then(data => {{
                        const container = document.getElementById('logsContainer');
                        if (data.success && data.logs.length > 0) {{
                            container.innerHTML = data.logs.reverse().map(log => 
                                `<div class="log-entry ${{log.level}}">
                                    [${{log.timestamp}}] [${{log.level}}] ${{log.message}}
                                </div>`
                            ).join('');
                        }} else {{
                            container.innerHTML = '<div style="color: #95a5a6;">No logs available</div>';
                        }}
                        document.getElementById('totalLogs').textContent = data.total;
                    }})
                    .catch(err => {{
                        console.error('Error fetching logs:', err);
                        document.getElementById('logsContainer').innerHTML = 
                            '<div style="color: #e74c3c;">Error loading logs</div>';
                    }});
            }}
            
            function refreshStatus() {{
                fetch('/status')
                    .then(res => res.json())
                    .then(data => {{
                        document.getElementById('sessionValid').textContent = 
                            data.sessionValid ? '✓ Valid' : '✗ Invalid';
                        document.getElementById('queueSize').textContent = data.queueSize;
                        
                        const statusEl = document.getElementById('sessionStatus');
                        if (data.sessionValid) {{
                            statusEl.className = 'status active';
                            statusEl.textContent = '🟢 ACTIVE';
                        }} else {{
                            statusEl.className = 'status inactive';
                            statusEl.textContent = '🔴 INACTIVE';
                        }}
                    }})
                    .catch(err => console.error('Error fetching status:', err));
            }}
            
            // Auto refresh every 10 seconds
            setInterval(() => {{
                refreshLogs();
                refreshStatus();
            }}, 10000);
            
            // Initial load
            refreshLogs();
        </script>
    </body>
    </html>
    '''

# ============================================================================
# SERVER STARTUP
# ============================================================================

if __name__ == '__main__':
    print('\n' + '=' * 70)
    print('  UG/3M-NS3 AUTO DEPOSIT SERVER v1.0.0')
    print('  BOB RESEARCH LABS - Enterprise Security Research')
    print('=' * 70 + '\n')
    
    print('[STARTUP] Initializing session keeper...')
    start_session_keeper()
    
    if CONFIG['USE_QUEUE']:
        start_queue_workers(CONFIG['QUEUE_WORKERS'])
    
    print('\n' + '=' * 70)
    print(f'  ✓ SERVER READY ON PORT {CONFIG["PORT"]}')
    print(f'  Dashboard: http://localhost:{CONFIG["PORT"]}/')
    print(f'  Webhook: POST http://localhost:{CONFIG["PORT"]}/webhook')
    print('=' * 70 + '\n')
    
    log_activity('🚀 UG Auto Deposit Server started', 'INFO')
    
    app.run(
        host='0.0.0.0',
        port=CONFIG['PORT'],
        debug=False,
        threaded=True
    )
