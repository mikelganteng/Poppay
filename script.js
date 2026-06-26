// ============================================================================
// UG QRIS POPPAY INJECTION - Full Replica of injectscript.html
// BOB RESEARCH LABS - v3.0.0
// ============================================================================

(function() {
    'use strict';
    
    console.log('🚀 [UG-QRIS-POPPAY] Starting v3.0.0...');
    
    // ========================================================================
    // Configuration
    // ========================================================================
    const CONFIG = {
        MIN_AMOUNT: 10000,
        MAX_AMOUNT: 10000000,
        MAX_RETRIES: 20,
        RETRY_DELAY: 500
    };
    
    // ========================================================================
    // Get Username (STRICT MODE - No Fallback)
    // ========================================================================
    async function getUsername() {
        try {
            // UG specific: find username in DOM
            const allDivs = document.querySelectorAll('div[class*="mb-2"]');
            for (const div of allDivs) {
                const text = div.textContent.trim();
                if (text.length >= 3 && text.length <= 20 && /^[a-zA-Z0-9_]+$/.test(text)) {
                    console.log(`✅ [UG-QRIS] Username found: ${text}`);
                    return text;
                }
            }
            
            // NO FALLBACK - Return null if not found
            console.warn('⚠️ [UG-QRIS] Username NOT found - will NOT inject');
            return null;
        } catch (error) {
            console.error('❌ [UG-QRIS] Error getting username:', error);
            return null;
        }
    }
    
    // ========================================================================
    // Check if Username Exists (Pre-Injection Validation)
    // ========================================================================
    async function validateUsernameExists() {
        const username = await getUsername();
        
        if (!username) {
            console.warn('⚠️ [UG-QRIS] INJECTION DISABLED - Username not found');
            return false;
        }
        
        console.log('✅ [UG-QRIS] Username validation passed');
        return true;
    }
    
    // ========================================================================
    // Find QRIS Element (EXCLUDE our Poppay form!)
    // ========================================================================
    function findQRISElement() {
        // SKIP if element is inside our Poppay container
        function isInsidePoppay(element) {
            return element.closest('#ug-poppay-qris-full') !== null;
        }
        
        // Find by image (MOST SPECIFIC - qrisoke logo)
        const qrisImages = Array.from(document.querySelectorAll('img')).filter(img => 
            img.alt && (img.alt.toLowerCase().includes('qrisoke') || 
                       img.src && img.src.toLowerCase().includes('qrisoke'))
        );
        
        if (qrisImages.length > 0 && !isInsidePoppay(qrisImages[0])) {
            const container = qrisImages[0].closest('div[class*="hvpgtl"]') ||
                            qrisImages[0].closest('div[class*="root"]') ||
                            qrisImages[0].closest('li');
            
            if (container && !isInsidePoppay(container)) {
                console.log('✅ [UG-QRIS] Original QRIS found (qrisoke image)');
                return container;
            }
        }
        
        // Find by text "Qris" (but NOT our Poppay text!)
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
            // Skip if inside our Poppay container
            if (isInsidePoppay(div)) continue;
            
            const text = div.textContent.trim().toLowerCase();
            if (text === 'qris' || text === 'qrisoke') {
                const container = div.closest('div[class*="hvpgtl"]') || 
                                div.closest('div[class*="root"]') ||
                                div.closest('li');
                
                if (container && !isInsidePoppay(container)) {
                    console.log('✅ [UG-QRIS] Original QRIS found (text)');
                    return container;
                }
            }
        }
        
        return null;
    }
    
    // ========================================================================
    // Delete Original QRIS & Insert Poppay Form
    // ========================================================================
    async function replaceQRIS() {
        const qrisElement = findQRISElement();
        
        if (!qrisElement) {
            return false;
        }
        
        // Check if already injected
        if (document.getElementById('ug-poppay-qris-full')) {
            console.log('ℹ️ [UG-QRIS] Already injected');
            return true;
        }
        
        // CRITICAL: Validate username exists BEFORE injection
        const isValid = await validateUsernameExists();
        if (!isValid) {
            console.error('❌ [UG-QRIS] INJECTION BLOCKED - No valid username found');
            return false;
        }
        
        console.log('🔄 [UG-QRIS] Deleting original QRIS and injecting Poppay...');
        console.log('[UG-QRIS] Original element:', qrisElement);
        
        // Get parent container
        const parentContainer = qrisElement.parentElement;
        console.log('[UG-QRIS] Parent container:', parentContainer);
        
        if (!parentContainer) {
            console.error('❌ [UG-QRIS] Parent container not found!');
            return false;
        }
        
        // Create new Poppay element
        const newElement = document.createElement('div');
        newElement.id = 'ug-poppay-qris-full';
        newElement.className = qrisElement.className;
        newElement.innerHTML = `
            <style>
                .qris-manual-wrapper {
                    background: #ffffff;
                    padding: 25px;
                    border-radius: 12px;
                    margin-bottom: 25px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                }
                
                .qris-manual-header {
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 2px solid #f0f0f0;
                }
                
                .qris-manual-header h5 {
                    color: #333;
                    font-weight: 600;
                    margin: 0;
                    display: flex;
                    align-items: center;
                    font-size: 18px;
                }
                
                .qris-manual-header .qris-icon {
                    width: 24px;
                    height: 24px;
                    margin-right: 10px;
                    color: #4CAF50;
                    font-size: 20px;
                }
                
                .qris-manual-header p {
                    color: #666;
                    font-size: 13px;
                    margin: 8px 0 0 0;
                }
                
                .qris-form label {
                    color: #555;
                    font-weight: 500;
                    margin-bottom: 8px;
                    display: block;
                }
                
                .qris-amount-buttons {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                    margin-bottom: 15px;
                }
                
                .qris-amount-btn {
                    padding: 8px 16px;
                    border: 1px solid #667eea;
                    background: white;
                    color: #667eea;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.3s;
                }
                
                .qris-amount-btn:hover {
                    background: #667eea;
                    color: white;
                }
                
                .qris-amount-btn.active {
                    background: #667eea;
                    color: white;
                }
                
                .qris-input-group {
                    display: flex;
                    margin-bottom: 10px;
                }
                
                .qris-input-prefix {
                    background: #f0f0f0;
                    padding: 12px 16px;
                    border: 1px solid #ddd;
                    border-right: none;
                    border-radius: 6px 0 0 6px;
                    color: #666;
                    font-weight: 500;
                }
                
                .qris-input {
                    flex: 1;
                    padding: 12px 16px;
                    border: 1px solid #ddd;
                    border-radius: 0 6px 6px 0;
                    font-size: 16px;
                }
                
                .qris-input:focus {
                    outline: none;
                    border-color: #667eea;
                }
                
                .qris-input-hint {
                    font-size: 12px;
                    color: #999;
                    margin-top: 5px;
                }
                
                .qris-submit-btn {
                    width: 100%;
                    padding: 14px;
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    transition: all 0.3s;
                }
                
                .qris-submit-btn:hover {
                    background: #45a049;
                }
                
                .qris-submit-btn:disabled {
                    background: #ccc;
                    cursor: not-allowed;
                }
                
                .qris-result {
                    display: none;
                    margin-top: 20px;
                }
                
                .qris-result.active {
                    display: block;
                }
                
                #qris-payment-frame {
                    min-height: 400px;
                    text-align: center;
                }
                
                #payment-result {
                    margin-top: 15px;
                }
            </style>
            
            <div class="qris-manual-wrapper">
                <div class="qris-manual-header">
                    <h5>
                        <span class="qris-icon">💳</span>
                        QRIS Payment - PopPay Instant
                    </h5>
                    <p>Scan QR code dengan e-wallet favorit Anda (DANA, OVO, GoPay, ShopeePay, dll)</p>
                </div>
                
                <div class="qris-form" id="qrisFormContainer">
                    <form id="formDepositAutoQris">
                        <input type="hidden" id="bankSelectAutoQris" value="QRIS">
                        
                        <div class="form-group mb-3">
                            <label>Jumlah Deposit</label>
                            
                            <div class="qris-amount-buttons">
                                <button type="button" class="qris-amount-btn" data-amount="10000">Rp 10.000</button>
                                <button type="button" class="qris-amount-btn" data-amount="20000">Rp 20.000</button>
                                <button type="button" class="qris-amount-btn" data-amount="50000">Rp 50.000</button>
                                <button type="button" class="qris-amount-btn" data-amount="100000">Rp 100.000</button>
                                <button type="button" class="qris-amount-btn" data-amount="500000">Rp 500.000</button>
                            </div>
                            
                            <div class="qris-input-group">
                                <div class="qris-input-prefix">Rp</div>
                                <input 
                                    class="qris-input" 
                                    type="text" 
                                    id="depositShowAmountAutoQris" 
                                    placeholder="Atau masukkan jumlah manual"
                                >
                            </div>
                            <input type="hidden" id="depositAmountAutoQris" value="">
                            
                            <small class="qris-input-hint">Min: Rp ${CONFIG.MIN_AMOUNT.toLocaleString('id-ID')} | Max: Rp ${CONFIG.MAX_AMOUNT.toLocaleString('id-ID')}</small>
                        </div>
                        
                        <button type="submit" class="qris-submit-btn">
                            <span>💳</span>
                            <span id="qris-btn-text">Generate QR Code</span>
                        </button>
                    </form>
                </div>
                
                <div class="qris-result" id="qrisResultContainer">
                    <div class="text-center">
                        <div id="qris-payment-frame"></div>
                        <div id="payment-result"></div>
                    </div>
                </div>
            </div>
        `;
        
        // Insert Poppay BEFORE original
        try {
            parentContainer.insertBefore(newElement, qrisElement);
            console.log('[UG-QRIS] Poppay element inserted');
        } catch (error) {
            console.error('❌ [UG-QRIS] Failed to insert:', error);
            // Fallback: try appendChild
            try {
                parentContainer.appendChild(newElement);
                console.log('[UG-QRIS] Poppay element appended (fallback)');
            } catch (e2) {
                console.error('❌ [UG-QRIS] Failed to append:', e2);
                return false;
            }
        }
        
        // DELETE original QRIS completely
        try {
            qrisElement.remove();
            console.log('[UG-QRIS] Original QRIS deleted');
        } catch (error) {
            console.error('❌ [UG-QRIS] Failed to delete original:', error);
        }
        
        // Verify insertion
        const inserted = document.getElementById('ug-poppay-qris-full');
        if (inserted) {
            console.log('✅ [UG-QRIS] Injection verified successfully!');
        } else {
            console.error('❌ [UG-QRIS] Injection verification failed!');
            return false;
        }
        
        // Initialize form
        setTimeout(() => {
            initializeForm();
        }, 100);
        
        return true;
    }
    
    // ========================================================================
    // Initialize Form
    // ========================================================================
    function initializeForm() {
        const form = document.getElementById('formDepositAutoQris');
        const amountShow = document.getElementById('depositShowAmountAutoQris');
        const amountHidden = document.getElementById('depositAmountAutoQris');
        const formContainer = document.getElementById('qrisFormContainer');
        const resultContainer = document.getElementById('qrisResultContainer');
        const btnText = document.getElementById('qris-btn-text');
        
        // Amount input handler
        amountShow.addEventListener('input', function() {
            const val = this.value.replace(/\D/g, '');
            amountHidden.value = val;
            this.value = val.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        });
        
        // Amount button handlers
        const amountBtns = document.querySelectorAll('.qris-amount-btn');
        amountBtns.forEach(btn => {
            btn.addEventListener('click', function() {
                amountBtns.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                const amount = this.dataset.amount;
                amountShow.value = parseInt(amount).toLocaleString('id-ID');
                amountHidden.value = amount;
            });
        });
        
        // Form submit
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const amount = parseInt(amountHidden.value);
            
            // Validation
            if (!amount || amount < CONFIG.MIN_AMOUNT) {
                alert(`❌ Minimal deposit Rp ${CONFIG.MIN_AMOUNT.toLocaleString('id-ID')}`);
                return;
            }
            
            if (amount > CONFIG.MAX_AMOUNT) {
                alert(`❌ Maksimal deposit Rp ${CONFIG.MAX_AMOUNT.toLocaleString('id-ID')}`);
                return;
            }
            
            // Disable button
            const submitBtn = this.querySelector('.qris-submit-btn');
            submitBtn.disabled = true;
            btnText.textContent = 'Generating...';
            
            try {
                // Load SDK
                if (typeof window.QrisSDK === 'undefined') {
                    console.log('📦 [UG-QRIS] Loading SDK...');
                    await loadQrisSDK();
                }
                
                // Get username (with validation)
                const username = await getUsername();
                
                if (!username) {
                    throw new Error('Username tidak ditemukan. Silakan login terlebih dahulu.');
                }
                
                // Hide form, show result
                formContainer.style.display = 'none';
                resultContainer.classList.add('active');
                
                // WAIT for container to be ready
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Verify container exists
                const container = document.getElementById('qris-payment-frame');
                if (!container) {
                    throw new Error('Container qris-payment-frame not found in DOM');
                }
                console.log('[UG-QRIS] Container verified:', container);
                
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
                    containerId: 'qris-payment-frame',
                    resultContainerId: 'payment-result',
                    onSuccess: (data) => {
                        console.log('✅ [UG-QRIS] Payment success:', data);
                        
                        document.getElementById('payment-result').innerHTML = `
                            <div style="padding: 20px; background: #d4edda; border: 2px solid #c3e6cb; border-radius: 8px; margin-top: 15px;">
                                <h4 style="color: #155724; margin: 0 0 10px 0;">✅ Pembayaran Berhasil!</h4>
                                <p style="color: #155724; margin: 0;">Deposit Rp ${amount.toLocaleString('id-ID')} sedang diproses</p>
                            </div>
                        `;
                        
                        setTimeout(() => {
                            resetForm();
                        }, 5000);
                    },
                    onFailed: (error) => {
                        console.error('❌ [UG-QRIS] Payment failed:', error);
                        alert('Gagal membuat QR Code. Silakan coba lagi.');
                        resetForm();
                    },
                    onCancel: () => {
                        console.log('ℹ️ [UG-QRIS] Payment cancelled');
                        resetForm();
                    }
                });
                
                payment.openPayment();
                
            } catch (error) {
                console.error('❌ [UG-QRIS] Error:', error);
                alert('Terjadi kesalahan. Silakan coba lagi.');
                resetForm();
            }
        });
        
        function resetForm() {
            formContainer.style.display = 'block';
            resultContainer.classList.remove('active');
            document.getElementById('qris-payment-frame').innerHTML = '';
            document.getElementById('payment-result').innerHTML = '';
            amountShow.value = '';
            amountHidden.value = '';
            document.querySelectorAll('.qris-amount-btn').forEach(b => b.classList.remove('active'));
            const submitBtn = form.querySelector('.qris-submit-btn');
            submitBtn.disabled = false;
            btnText.textContent = 'Generate QR Code';
        }
        
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
    // Persistent Injection (handles Qwik re-renders)
    // ========================================================================
    let isInjected = false;
    let observer = null;
    
    async function startPersistentInjection() {
        console.log('🔄 [UG-QRIS] Starting persistent injection...');
        
        // Validate username FIRST
        const isValid = await validateUsernameExists();
        if (!isValid) {
            console.error('❌ [UG-QRIS] INJECTION ABORTED - No username detected');
            console.error('❌ [UG-QRIS] Script will NOT activate without valid username');
            return;
        }
        
        // Initial inject
        const success = await replaceQRIS();
        if (success) {
            isInjected = true;
            console.log('✅ [UG-QRIS] Initial injection successful');
        }
        
        // Watch for DOM changes (Qwik re-renders)
        observer = new MutationObserver((mutations) => {
            // Check if our injected element still exists
            const ourElement = document.getElementById('ug-poppay-qris-full');
            
            // Check if original QRIS reappeared
            const originalQRIS = findQRISElement();
            
            // If original QRIS exists and we're injected, delete it again
            if (originalQRIS && ourElement) {
                console.log('⚠️ [UG-QRIS] Original QRIS reappeared, deleting again...');
                originalQRIS.remove();
            }
            
            // If our element was removed, re-inject (with username check)
            if (!ourElement && isInjected) {
                console.log('⚠️ [UG-QRIS] Our element removed, re-injecting...');
                
                setTimeout(async () => {
                    const isValid = await validateUsernameExists();
                    if (isValid) {
                        const reinjected = await replaceQRIS();
                        if (reinjected) {
                            console.log('✅ [UG-QRIS] Re-injection successful');
                        }
                    } else {
                        console.warn('⚠️ [UG-QRIS] Re-injection skipped - no username');
                    }
                }, 100);
            }
            
            // If not injected yet, try to inject (with username check)
            if (!isInjected) {
                (async () => {
                    const isValid = await validateUsernameExists();
                    if (isValid) {
                        const success = await replaceQRIS();
                        if (success) {
                            isInjected = true;
                        }
                    }
                })();
            }
        });
        
        // Start observing
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        console.log('✅ [UG-QRIS] Persistent injection active');
    }
    
    // Start with retry mechanism
    let retryCount = 0;
    
    async function tryStart() {
        // FIRST: Check if username exists
        const hasUsername = await validateUsernameExists();
        
        if (!hasUsername) {
            console.error('❌ [UG-QRIS] SCRIPT DISABLED - Username not found');
            console.error('❌ [UG-QRIS] Will NOT activate injection without valid username');
            return; // STOP completely
        }
        
        const qrisElement = findQRISElement();
        
        if (qrisElement || retryCount >= CONFIG.MAX_RETRIES) {
            await startPersistentInjection();
        } else {
            retryCount++;
            console.log(`🔄 [UG-QRIS] Waiting for QRIS element... (${retryCount}/${CONFIG.MAX_RETRIES})`);
            setTimeout(tryStart, CONFIG.RETRY_DELAY);
        }
    }
    
    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(tryStart, 1000);
        });
    } else {
        setTimeout(tryStart, 1000);
    }
    
})();
