// ============================================================================
// UG INJECTION TEST - Simple Username Detection
// BOB RESEARCH LABS - Test v1.0.0
// ============================================================================

(function() {
    'use strict';
    
    console.log('========================================');
    console.log('🚀 UG INJECTION TEST v1.0.0');
    console.log('========================================');
    
    // ========================================================================
    // Get Username
    // ========================================================================
    function getUsername() {
        console.log('🔍 Searching for username...');
        
        try {
            // Method 1: DOM extraction
            const allDivs = document.querySelectorAll('div[class*="mb-2"]');
            
            for (const div of allDivs) {
                const text = div.textContent.trim();
                
                // Validate: username biasanya 3-20 char, alphanumeric
                if (text.length >= 3 && text.length <= 20 && /^[a-zA-Z0-9_]+$/.test(text)) {
                    console.log(`✅ Username found: ${text}`);
                    console.log(`📦 Saved to: window.UG_USERNAME`);
                    return text;
                }
            }
            
            console.warn('⚠️ Username not found in DOM');
            
            // Method 2: localStorage/sessionStorage
            console.log('🔍 Checking storage...');
            const storageKeys = ['username', 'user', 'userData'];
            
            for (const key of storageKeys) {
                const value = localStorage.getItem(key) || sessionStorage.getItem(key);
                if (value) {
                    try {
                        const parsed = JSON.parse(value);
                        if (parsed.username) {
                            console.log(`✅ Username found in storage: ${parsed.username}`);
                            return parsed.username;
                        }
                    } catch {
                        if (value.length >= 3 && value.length <= 20) {
                            console.log(`✅ Username found in storage: ${value}`);
                            return value;
                        }
                    }
                }
            }
            
            console.error('❌ Username not found');
            return null;
            
        } catch (error) {
            console.error('❌ Error:', error);
            return null;
        }
    }
    
    // ========================================================================
    // Initialize
    // ========================================================================
    function init() {
        console.log('⏳ Waiting for page load...');
        
        setTimeout(() => {
            console.log('✅ Page loaded, extracting username...');
            
            const username = getUsername();
            
            if (username) {
                // Save to window object
                window.UG_USERNAME = username;
                
                console.log('========================================');
                console.log('🎉 SUCCESS!');
                console.log(`Username: ${username}`);
                console.log(`Access via: window.UG_USERNAME`);
                console.log('========================================');
            } else {
                console.log('========================================');
                console.log('⚠️ FAILED - Username not detected');
                console.log('========================================');
            }
        }, 1000);
    }
    
    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
})();
