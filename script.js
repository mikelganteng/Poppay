// ============================================================================
// UG QRIS POPPAY INJECTION - Full Production
// BOB RESEARCH LABS - v2.0.0
// ============================================================================

(function() {
    'use strict';
    
    console.log('🚀 [UG-QRIS] Starting v2.0.0...');
    
    // ========================================================================
    // Configuration
    // ========================================================================
    const CONFIG = {
        MIN_AMOUNT: 10000,
        MAX_RETRIES: 15,
        RETRY_DELAY: 500
    };
    
    // ========================================================================
    // Get Username
    // ========================================================================
    async function getUsername() {
        try {
            // Method 1: DOM extraction (UG specific)
            const allDivs = document.querySelectorAll('div[class*="mb-2"]');
            for (const div of allDivs) {
                const text = div.textContent.trim();
                if (text.length >= 3 && text.length <= 20 && /^[a-zA-Z0-9_]+$/.test(text)) {
                    console.log(`✅ [UG-QRIS] Username: ${text}`);
                    return text;
                }
            }
            
            // Method 2: Storage
            const storageKeys = ['username', 'user', 'userData'];
            for (const key of storageKeys) {
                const value = localStorage.getItem(key) || sessionStorage.getItem(key);
                if (value) {
                    try {
                        const parsed = JSON.parse(value);
                        if (parsed.username) return parsed.username;
                    } catch {
                        if (value.length >= 3 && value.length <= 20) return value;
                    }
                }
            }
            
            return 'GUEST-' + Date.now();
        } catch (error) {
            return 'GUEST-' + Date.now();
        }
    }
    
    // ========================================================================
    // Find QRIS Element (from user's HTML)
    // ========================================================================
    function findQRISElement() {
        // Method 1: Find by text "Qris"
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
            const text = div.textContent.trim().toLowerCase();
            if (text === 'qris' || text === 'qrisoke') {
                // Find parent container with specific classes
                const container = div.closest('div[class*="hvpgtl"]') || 
                                div.closest('div[class*="root"]') ||
                                div.closest('li');
                
                if (container) {
                    console.log('✅ [UG-QRIS] QRIS element found (text match)');
                    return container;
                }
            }
        }
        
        // Method 2: Find by image alt
        const qrisImages = Array.from(document.querySelectorAll('img')).filter(img => 
            img.alt && (img.alt.toLowerCase().includes('qris') || 
                       img.src && img.src.includes('qris'))
        );
        
        if (qrisImages.length > 0) {
            const container = qrisImages[0].closest('div[class*="hvpgtl"]') ||
                            qrisImages[0].closest('div[class*="root"]') ||
                            qrisImages[0].closest('li') ||
                            qrisImages[0].parentElement.parentElement;
            
            if (container) {
                console.log('✅ [UG-QRIS] QRIS element found (image match)');
                return container;
            }
        }
        
        console.log('⚠️ [UG-QRIS] QRIS element not found');
        return null;
    }
    
    // ========================================================================
    // Replace QRIS with Poppay Form
    // ========================================================================
    function replaceQRIS() {
        const qrisElement = findQRISElement();
        
        if (!qrisElement) {
            return false;
        }
        
        // Check if already replaced
        if (document.getElementById('ug-poppay-qris')) {
            console.log('ℹ️ [UG-QRIS] Already replaced');
            return true;
        }
        
        console.log('🔄 [UG-QRIS] Replacing with Poppay form...');
        
        // Create replacement
        const newElement = document.createElement('div');
        newElement.id = 'ug-poppay-qris';
        newElement.className = qrisElement.className; // Inherit UG styles
        newElement.innerHTML = `
            <style>
                #ug-poppay-container {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border-radius: 16px;
                    padding: 24px;
                    color: white;
                    box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
                }
                
                #ug-poppay-header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 20px;
                }
                
                #ug-poppay-header h3 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 600;
                }
                
                .ug-badge {
                    background: rgba(255,255,255,0.2);
                    padding: 4px 12px;
                    border-radius: 12px;
                    font-size: 12px;
                    margin-left: auto;
                    font-weight: 500;
                }
                
                #ug-form-container {
                    display: block;
                }
                
                #ug-form-container input {
                    width: 100%;
                    padding: 14px 16px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-radius: 12px;
                    background: rgba(255,255,255,0.1);
                    color: white;
                    font-size: 16px;
                    margin-bottom: 16px;
                    transition: all 0.3s;
                }
                
                #ug-form-container input:focus {
                    outline: none;
                    border-color: rgba(255,255,255,0.6);
                    background: rgba(255,255,255,0.15);
                }
                
                #ug-form-container input::placeholder {
                    color: rgba(255,255,255,0.6);
                }
                
                #ug-submit-btn {
                    width: 100%;
                    padding: 16px;
                    background: white;
                    color: #667eea;
                    border: none;
                    border-radius: 12px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                }
                
                #ug-submit-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                }
                
                #ug-submit-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                    transform: none;
                }
                
                #ug-result-container {
                    display: none;
                    margin-top: 20px;
                }
                
                .ug-success {
                    background: rgba(255,255,255,0.2);
                    padding: 16px;
                    border-radius: 12px;
                    text-align: center;
                }
                
                .ug-success h4 {
                    margin: 0 0 8px 0;
                    font-size: 18px;
                }
                
                .ug-success p {
                    margin: 0;
                    font-size: 14px;
                    opacity: 0.9;
                }
            </style>
            
            <div id="ug-poppay-container">
                <div id="ug-poppay-header">
                    <h3>💳 QRIS Auto Deposit</h3>
                    <span class="ug-badge">⚡ Instant</span>
                </div>
                
                <div id="ug-form-container">
                    <input 
                        type="number" 
                        id="ug-amount" 
                        placeholder="Jumlah (Min. Rp ${CONFIG.MIN_AMOUNT.toLocaleString('id-ID')})"
                        min="${CONFIG.MIN_AMOUNT}"
                        step="1000"
                    >
                    <button id="ug-submit-btn">
                        <span>🚀</span>
                        <span id="ug-btn-text">Generate QRIS</span>
                    </button>
                </div>
                
                <div id="ug-result-container"></div>
            </div>
        `;
        
        // Replace
        qrisElement.replaceWith(newElement);
        
        console.log('✅ [UG-QRIS] Replaced successfully');
        
        // Initialize form
        initializeForm();
        
        return true;
    }
    
    // ========================================================================
    // Initialize Form
    // ========================================================================
    function initializeForm() {
        const amountInput = document.getElementById('ug-amount');
        const submitBtn = document.getElementById('ug-submit-btn');
        const btnText = document.getElementById('ug-btn-text');
        const formContainer = document.getElementById('ug-form-container');
        const resultContainer = document.getElementById('ug-result-container');
        
        submitBtn.addEventListener('click', async () => {
            const amount = parseFloat(amountInput.value);
            
            // Validation
            if (!amount || amount < CONFIG.MIN_AMOUNT) {
                alert(`❌ Minimal deposit Rp ${CONFIG.MIN_AMOUNT.toLocaleString('id-ID')}`);
                return;
            }
            
            // Get username
            const username = await getUsername();
            
            // Disable button
            submitBtn.disabled = true;
            btnText.textContent = 'Processing...';
            
            try {
                // Load SDK if needed
                if (typeof window.QrisSDK === 'undefined') {
                    console.log('📦 [UG-QRIS] Loading SDK...');
                    await loadQrisSDK();
                }
                
                // Hide form, show result
                formContainer.style.display = 'none';
                resultContainer.style.display = 'block';
                
                // Create payment
                const invoice = 'UG-' + Date.now();
                console.log('💳 [UG-QRIS] Creating payment:', { amount, username, invoice });
                
                const payment = new window.QrisSDK({
                    amount: amount,
                    invoice: invoice,
                    notes: `UG Auto Deposit - ${invoice}`,
                    username: username,
                    payor_name: username,
                    payor_email: '',
                    displayMode: 'inline',
                    containerId: 'ug-result-container',
                    onSuccess: (response) => {
                        console.log('✅ [UG-QRIS] Payment success:', response);
                        
                        resultContainer.innerHTML = `
                            <div class="ug-success">
                                <h4>✅ Pembayaran Berhasil!</h4>
                                <p>Deposit Rp ${amount.toLocaleString('id-ID')} sedang diproses</p>
                            </div>
                        `;
                        
                        setTimeout(() => {
                            formContainer.style.display = 'block';
                            resultContainer.style.display = 'none';
                            resultContainer.innerHTML = '';
                            amountInput.value = '';
                            submitBtn.disabled = false;
                            btnText.textContent = 'Generate QRIS';
                        }, 5000);
                    },
                    onError: (error) => {
                        console.error('❌ [UG-QRIS] Payment error:', error);
                        alert('❌ Error: ' + (error.message || 'Terjadi kesalahan'));
                        
                        formContainer.style.display = 'block';
                        resultContainer.style.display = 'none';
                        submitBtn.disabled = false;
                        btnText.textContent = 'Generate QRIS';
                    },
                    onCancel: () => {
                        console.log('ℹ️ [UG-QRIS] Payment cancelled');
                        
                        formContainer.style.display = 'block';
                        resultContainer.style.display = 'none';
                        resultContainer.innerHTML = '';
                        submitBtn.disabled = false;
                        btnText.textContent = 'Generate QRIS';
                    }
                });
                
                payment.open();
                
            } catch (error) {
                console.error('❌ [UG-QRIS] Error:', error);
                alert('❌ Error: ' + error.message);
                
                formContainer.style.display = 'block';
                resultContainer.style.display = 'none';
                submitBtn.disabled = false;
                btnText.textContent = 'Generate QRIS';
            }
        });
        
        console.log('✅ [UG-QRIS] Form initialized');
    }
    
    // ========================================================================
    // Load QRIS SDK
    // ========================================================================
    function loadQrisSDK() {
        return new Promise((resolve, reject) => {
            if (typeof window.QrisSDK !== 'undefined') {
                resolve();
                return;
            }
            
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@poppackage/qris-payment-sdk/dist/qris-sdk.umd.js';
            script.onload = () => {
                console.log('✅ [UG-QRIS] SDK loaded');
                resolve();
            };
            script.onerror = () => {
                console.error('❌ [UG-QRIS] SDK load failed');
                reject(new Error('Failed to load SDK'));
            };
            
            document.head.appendChild(script);
        });
    }
    
    // ========================================================================
    // Start Injection with Retry
    // ========================================================================
    let retryCount = 0;
    
    function tryInject() {
        console.log(`🔄 [UG-QRIS] Attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES}`);
        
        const success = replaceQRIS();
        
        if (success) {
            console.log('🎉 [UG-QRIS] Injection complete!');
            return;
        }
        
        retryCount++;
        if (retryCount < CONFIG.MAX_RETRIES) {
            setTimeout(tryInject, CONFIG.RETRY_DELAY);
        } else {
            console.warn('⚠️ [UG-QRIS] Max retries - element may not exist on this page');
        }
    }
    
    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(tryInject, 1000);
        });
    } else {
        setTimeout(tryInject, 1000);
    }
    
})();
