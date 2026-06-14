/* ==========================================================================
   ZenFinance - Frontend Application Logic & Visualization
   ========================================================================== */

// Global Application State
let appData = {
    fi_target: 4500000000,
    transactions: [],
    filteredTransactions: []
};

// UI Config & Pagination
let currentPage = 1;
const rowsPerPage = 20;

// API base path (If opened via file:/// protocol, target local server port 8000)
const apiBase = window.location.protocol === 'file:' ? 'http://localhost:8000' : '';

// Chart Instances
let netWorthChart = null;
let expenseDonutChart = null;

// Real-time synchronization state
let lastTransactionsHash = '';
let lastCloudFetchTime = 0;

// ID của giao dịch đang được chỉnh sửa (null = đang ở chế độ thêm mới)
let editingTxId = null;

// Ghi đè window.fetch gốc để intercept các cuộc gọi API khi dùng Cloud Gist
const originalFetch = window.fetch;
window.fetch = async function(url, options) {
    if (typeof url === 'string' && (url.includes('/api/') || url.startsWith('/api/'))) {
        const isCloud = !!(localStorage.getItem('github_token') && localStorage.getItem('github_gist_id'));
        if (isCloud) {
            return handleCloudApiRequest(url, options);
        }
    }
    return originalFetch.apply(this, arguments);
};

function isCloudMode() {
    return !!(localStorage.getItem('github_token') && localStorage.getItem('github_gist_id'));
}

function getCloudConfig() {
    return {
        token: localStorage.getItem('github_token'),
        gistId: localStorage.getItem('github_gist_id')
    };
}

// Tự động nhận diện cấu hình đồng bộ qua URL (Query parameters) để thiết lập 1-click
(function() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    const urlGistId = urlParams.get('gist_id');
    
    if (urlToken && urlGistId) {
        localStorage.setItem('github_token', urlToken.trim());
        localStorage.setItem('github_gist_id', urlGistId.trim());
        
        // Xóa query parameters trên thanh địa chỉ ngay lập tức để bảo mật
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
        
        // Tự động reload để áp dụng cấu hình đám mây
        window.location.reload();
    }
})();


// Auth utility functions
function getAuthHeaders() {
    const token = localStorage.getItem('zenfinance_auth_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

let isSetupMode = false;

function handleAuthRequired(setupRequired = false) {
    const overlay = document.getElementById('login-overlay');
    const title = document.getElementById('login-title');
    const desc = document.getElementById('login-desc');
    const pwdInput = document.getElementById('login-password');
    const errMsg = document.getElementById('login-error-msg');
    
    errMsg.classList.add('hidden');
    pwdInput.value = '';
    overlay.classList.remove('hidden');
    pwdInput.focus();
    
    isSetupMode = setupRequired;
    if (setupRequired) {
        title.innerText = 'Thiết lập Mật mã';
        desc.innerText = 'Tạo mật mã mới để bảo vệ dữ liệu tài chính của bạn.';
        pwdInput.placeholder = 'Tạo mật mã mới...';
    } else {
        title.innerText = 'ZenFinance Bảo mật';
        desc.innerText = 'Vui lòng nhập mật mã để truy cập bảng điều khiển.';
        pwdInput.placeholder = 'Nhập mật mã...';
    }
}

async function handleLoginSubmit() {
    const pwdInput = document.getElementById('login-password');
    const password = pwdInput.value;
    const errMsg = document.getElementById('login-error-msg');
    const spinner = document.getElementById('login-spinner');
    const btn = document.getElementById('btn-login');
    
    if (!password) return;
    
    spinner.classList.remove('hidden');
    btn.disabled = true;
    errMsg.classList.add('hidden');
    
    const endpoint = isSetupMode ? '/api/setup-auth' : '/api/login';
    
    try {
        const response = await fetch(`${apiBase}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        const data = await response.json();
        if (response.ok && data.status === 'success') {
            localStorage.setItem('zenfinance_auth_token', data.token);
            document.getElementById('login-overlay').classList.add('hidden');
            loadAppData();
        } else {
            errMsg.innerText = data.message || 'Mật mã không chính xác!';
            errMsg.classList.remove('hidden');
        }
    } catch (err) {
        console.error('Authentication request failed:', err);
        errMsg.innerText = 'Không thể kết nối với máy chủ!';
        errMsg.classList.remove('hidden');
    } finally {
        spinner.classList.add('hidden');
        btn.disabled = false;
    }
}

// Date Filter Helpers
function getDashboardDateRange() {
    const el = document.getElementById('dashboard-date-range');
    return el ? el.value : (localStorage.getItem('dashboard_date_range') || 'all');
}

function isTransactionInDateRange(txDateStr, range) {
    if (range === 'all') return { inRange: true, isBefore: false };
    
    const txDate = new Date(txDateStr);
    if (isNaN(txDate.getTime())) return { inRange: true, isBefore: false };
    
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    let startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    
    if (range === 'this-month') {
        startDate.setDate(1);
    } else if (range === 'last-3-months') {
        startDate.setMonth(startDate.getMonth() - 3);
        startDate.setDate(1);
    } else if (range === 'this-year') {
        startDate.setMonth(0, 1);
    }
    
    const inRange = txDate >= startDate && txDate <= today;
    const isBefore = txDate < startDate;
    return { inRange, isBefore };
}

// Category Option Mappings
const categoryMap = {
    'KHOẢN THU': ['Buôn bán', 'Thu phí', 'Nhận tiền D', 'Mượn', 'Nợ trả', 'Quỹ', 'Có sẵn / Khác', 'Lương'],
    'KHOẢN CHI': ['Nhu yếu phẩm', 'Ăn uống', 'Mua sắm', 'Thư giãn', 'Phát sinh', 'Cấp tiền TG', 'Mua đồ d', 'Trả nợ'],
    'KHOẢN NỢ': ['Khoản nợ'],
    'ĐÒI NỢ': ['Đòi nợ'],
    'DOANH THU ĐẦU TƯ': ['Doanh thu đầu tư']
};

function stripAccents(str) {
    if (!str) return '';
    return str.normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/đ/g, 'd')
              .replace(/Đ/g, 'd')
              .toLowerCase()
              .trim();
}

function normalizeName(item) {
    if (!item) return '';
    let name = item.normalize('NFC').trim();
    // Remove prefixes/suffixes without relying on \b boundaries (Unicode/diacritic-safe)
    const wordsToRemove = ['trả nợ', 'thu nợ', 'đòi nợ', 'trả', 'nợ', 'vay', 'mượn', 'gửi', 'nhờ'];
    wordsToRemove.forEach(word => {
        const regex = new RegExp(word.normalize('NFC'), 'gi');
        name = name.replace(regex, '');
    });
    name = name.replace(/\s+/g, ' ').trim();
    return name || item;
}

// VNĐ Number Words Converter helper for Modal (To wow the user with detail)
function convertNumberToWords(number) {
    const defaultNumbers = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    if (number == 0) return 'Không đồng';
    
    // Simple rough conversion for large numbers (VND usually million/billion)
    if (number >= 1000000000) {
        const billion = Math.floor(number / 1000000000);
        const million = Math.floor((number % 1000000000) / 1000000);
        return `Khoảng ${billion} tỷ ${million > 0 ? million + ' triệu' : ''} đồng`;
    } else if (number >= 1000000) {
        const million = Math.floor(number / 1000000);
        const thousand = Math.floor((number % 1000000) / 1000);
        return `Khoảng ${million} triệu ${thousand > 0 ? thousand + ' nghìn' : ''} đồng`;
    }
    return '';
}

// Format currency
function formatVND(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount).replace('₫', 'đ');
}

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNavigation();
    initEventListeners();
    
    // Auth listeners
    const btnLogin = document.getElementById('btn-login');
    const inputLoginPwd = document.getElementById('login-password');
    if (btnLogin) btnLogin.addEventListener('click', handleLoginSubmit);
    if (inputLoginPwd) {
        inputLoginPwd.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleLoginSubmit();
        });
    }
    
    // Date range filter listener
    const dateRangeFilter = document.getElementById('dashboard-date-range');
    if (dateRangeFilter) {
        const savedRange = localStorage.getItem('dashboard_date_range') || 'all';
        dateRangeFilter.value = savedRange;
        dateRangeFilter.addEventListener('change', () => {
            localStorage.setItem('dashboard_date_range', dateRangeFilter.value);
            calculateStats();
            renderCharts();
            renderWidgets();
        });
    }
    
    loadAppData();
    
    // Periodically poll for background updates every 5 seconds (only if window is active)
    setInterval(() => {
        const loginOverlay = document.getElementById('login-overlay');
        if (!document.hidden && loginOverlay && loginOverlay.classList.contains('hidden')) {
            checkAndRefreshData();
        }
    }, 5000);

    // Fetch and sync immediately when window becomes active/focused
    window.addEventListener('focus', () => {
        const loginOverlay = document.getElementById('login-overlay');
        if (loginOverlay && loginOverlay.classList.contains('hidden')) {
            checkAndRefreshData();
        }
    });
});

// Theme Management (Dark/Light Toggle)
function initTheme() {
    const themeToggleBtn = document.getElementById('theme-toggle');
    const isLight = localStorage.getItem('theme') === 'light';
    
    if (isLight) {
        document.body.classList.remove('dark-mode');
        document.body.classList.add('light-mode');
        themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    } else {
        document.body.classList.remove('light-mode');
        document.body.classList.add('dark-mode');
        themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    }
    
    themeToggleBtn.addEventListener('click', () => {
        if (document.body.classList.contains('dark-mode')) {
            document.body.classList.remove('dark-mode');
            document.body.classList.add('light-mode');
            themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
            localStorage.setItem('theme', 'light');
        } else {
            document.body.classList.remove('light-mode');
            document.body.classList.add('dark-mode');
            themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
            localStorage.setItem('theme', 'dark');
        }
        // Redraw charts to update text/border colors
        if (appData.transactions.length > 0) {
            renderCharts();
        }
    });
}

// Tab Navigation
function initNavigation() {
    const menuItems = document.querySelectorAll('.sidebar-menu li');
    const tabViews = document.querySelectorAll('.tab-view');
    
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tabName = item.getAttribute('data-tab');
            
            menuItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            tabViews.forEach(view => {
                if (view.id === `view-${tabName}`) {
                    view.classList.remove('hidden');
                    view.classList.add('active');
                } else {
                    view.classList.remove('active');
                    view.classList.add('hidden');
                }
            });
            
            // Adjust pagination and counts if switching to ledger
            if (tabName === 'transactions') {
                filterTransactions();
            }
        });
    });
}

// Event Listeners for Filters, Modals and Uploads
function initEventListeners() {
    // (Excel drag & drop features removed to secure central database)

    // Modal Control
    const addTxModal = document.getElementById('modal-add-tx');
    const btnOpenModal = document.getElementById('btn-add-tx-modal');
    const btnOpenModalFab = document.getElementById('btn-add-tx-modal-fab');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnCancelModal = document.getElementById('btn-cancel-modal');
    const formAddTx = document.getElementById('form-add-tx');
    const groupSelect = document.getElementById('tx-group');
    const catSelect = document.getElementById('tx-category');
    const amountField = document.getElementById('tx-amount');
    const amountWordsLabel = document.getElementById('amount-words');
    
    const openModalFunc = () => {
        editingTxId = null; // Chế độ thêm mới
        document.getElementById('modal-tx-title').innerHTML = '<i class="fa-solid fa-file-invoice-dollar text-primary"></i> Ghi nhận Giao dịch Mới';
        document.getElementById('btn-save-tx-label').innerText = 'Lưu giao dịch';
        formAddTx.reset();
        const localDate = new Date();
        const year = localDate.getFullYear();
        const month = String(localDate.getMonth() + 1).padStart(2, '0');
        const day = String(localDate.getDate()).padStart(2, '0');
        document.getElementById('tx-date').value = `${year}-${month}-${day}`;
        catSelect.innerHTML = '<option value="" disabled selected>Chọn danh mục...</option>';
        catSelect.disabled = true;
        amountWordsLabel.innerText = '';
        addTxModal.classList.remove('hidden');
    };
    
    if (btnOpenModal) btnOpenModal.addEventListener('click', openModalFunc);
    if (btnOpenModalFab) btnOpenModalFab.addEventListener('click', openModalFunc);
    
    const closeModal = () => addTxModal.classList.add('hidden');
    btnCloseModal.addEventListener('click', closeModal);
    btnCancelModal.addEventListener('click', closeModal);
    
    // Dynamic dropdown populator for Category Group select
    groupSelect.addEventListener('change', () => {
        const group = groupSelect.value;
        catSelect.innerHTML = '<option value="" disabled selected>Chọn danh mục...</option>';
        if (categoryMap[group]) {
            categoryMap[group].forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat;
                opt.innerText = cat;
                catSelect.appendChild(opt);
            });
            catSelect.disabled = false;
        } else {
            catSelect.disabled = true;
        }
    });
    
    // Dynamic number into words helper for modal inputs
    amountField.addEventListener('input', () => {
        const val = parseInt(amountField.value) || 0;
        amountWordsLabel.innerText = convertNumberToWords(val);
    });
    
    // Form Submission
    formAddTx.addEventListener('submit', handleFormSubmit);

    // Ledger Filters
    document.getElementById('search-tx').addEventListener('input', () => { currentPage = 1; filterTransactions(); });
    document.getElementById('filter-sheet').addEventListener('change', () => { currentPage = 1; filterTransactions(); });
    document.getElementById('filter-group').addEventListener('change', () => { currentPage = 1; filterTransactions(); });
    
    // Pagination Controls
    document.getElementById('btn-prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderLedgerTable();
        }
    });
    
    document.getElementById('btn-next-page').addEventListener('click', () => {
        const maxPage = Math.ceil(appData.filteredTransactions.length / rowsPerPage);
        if (currentPage < maxPage) {
            currentPage++;
            renderLedgerTable();
        }
    });
}

// Helper to update all connection badges (Sidebar & Header)
function updateConnectionBadges(htmlContent) {
    document.querySelectorAll('.connection-badge').forEach(badge => {
        badge.innerHTML = htmlContent;
    });
}

// Fetch and Load App Data
async function loadAppData() {
    const dsInfo = document.getElementById('data-source-info');
    
    try {
        const headers = getAuthHeaders();
        const response = await fetch(`${apiBase}/api/data`, { headers });
        
        if (response.status === 401) {
            const errData = await response.json();
            handleAuthRequired(errData.status === 'setup_required');
            return;
        }
        
        if (!response.ok) throw new Error('API server returned error status');
        
        const data = await response.json();
        
        // Auto-Migration & Smart Merging check
        const cachedTxs = localStorage.getItem('cached_transactions');
        const cachedTarget = localStorage.getItem('cached_fi_target');
        
        let localTxs = [];
        if (cachedTxs) {
            try {
                const parsed = JSON.parse(cachedTxs);
                // Keep only 'QUẢN LÝ WEB' transactions to discard old Excel cache
                localTxs = parsed.filter(t => t.sheet === 'QUẢN LÝ WEB');
                localStorage.setItem('cached_transactions', JSON.stringify(localTxs));
            } catch (e) {
                console.error('Error parsing cached transactions:', e);
            }
        }
        
        // Find transactions present in browser cache but not on server yet (local-only)
        const serverTxIds = new Set(data.transactions.map(t => t.id));
        const localOnlyTxs = localTxs.filter(t => t.id && !serverTxIds.has(t.id));

        // QUAN TRỌNG: Ở chế độ Cloud Gist, Gist là nguồn chân lý duy nhất.
        // KHÔNG merge cache cũ đẩy ngược lên — nếu không, giao dịch đã xóa ở máy khác
        // sẽ bị máy này "hồi sinh" do cache cũ vẫn còn (resurrection bug đa máy).
        if (isCloudMode()) {
            appData.fi_target = data.fi_target;
            appData.transactions = data.transactions;
            // Đồng bộ lại cache trình duyệt cho khớp Gist (xóa các bản ghi cũ đã bị xóa nơi khác)
            localStorage.setItem('cached_fi_target', appData.fi_target);
            localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));
        } else if (localOnlyTxs.length > 0) {
            console.log(`Found ${localOnlyTxs.length} local-only transactions in browser. Syncing/merging with server...`);
            const mergedTxs = [...data.transactions, ...localOnlyTxs];
            const localTarget = cachedTarget ? parseFloat(cachedTarget) : data.fi_target;
            
            // Sync up the merged list to the server
            await syncLocalDataToServer(mergedTxs, localTarget);
            
            // Re-fetch fresh server data
            const reloadRes = await fetch(`${apiBase}/api/data`, { headers: getAuthHeaders() });
            if (reloadRes.ok) {
                const freshData = await reloadRes.json();
                appData.fi_target = freshData.fi_target;
                appData.transactions = freshData.transactions;
            } else {
                appData.fi_target = data.fi_target;
                appData.transactions = mergedTxs;
            }
        } else {
            appData.fi_target = data.fi_target;
            appData.transactions = data.transactions;
        }
        
        // Cache locally for backup
        localStorage.setItem('cached_fi_target', appData.fi_target);
        localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));
        
        // Save initial transaction hash to detect server updates
        lastTransactionsHash = JSON.stringify(appData.transactions);
        
        if (data.local_ip === 'GitHub Cloud') {
            updateConnectionBadges('<span class="badge-dot" style="background-color: #38bdf8; box-shadow: 0 0 8px #38bdf8"></span>Đồng bộ Cloud Gist');
            dsInfo.innerHTML = `<i class="fa-solid fa-cloud text-primary"></i> Đang đồng bộ với <strong>GitHub Gist Cloud</strong>`;
            // Tự động ẩn login overlay nếu đang dùng Cloud Gist
            const loginOverlay = document.getElementById('login-overlay');
            if (loginOverlay) loginOverlay.classList.add('hidden');
        } else {
            updateConnectionBadges('<span class="badge-dot" style="background-color: var(--surplus); box-shadow: 0 0 8px var(--surplus)"></span>Đồng bộ Máy chủ');
            if (window.location.hostname === data.local_ip || window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
                dsInfo.innerHTML = `<i class="fa-solid fa-circle-check text-surplus"></i> Đang kết nối trực tiếp với Máy chủ Wi-Fi`;
            } else {
                dsInfo.innerHTML = `<i class="fa-solid fa-circle-check text-surplus"></i> Máy chủ Wi-Fi: Truy cập trên điện thoại <strong>http://${data.local_ip}:8000/frontend/index.html</strong>`;
            }
        }
        
        initApp();
    } catch (err) {
        console.warn('Could not connect to API server, trying static database.json fallback...', err);
        
        // Try fetching static database.json from GitHub Pages host
        try {
            const staticResponse = await originalFetch(`database.json?t=${Date.now()}`);
            if (staticResponse.ok) {
                const staticData = await staticResponse.json();
                appData.fi_target = staticData.fi_target || 4500000000;
                appData.transactions = staticData.transactions || [];
                
                // Cache locally for backup
                localStorage.setItem('cached_fi_target', appData.fi_target);
                localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));
                lastTransactionsHash = JSON.stringify(appData.transactions);
                
                updateConnectionBadges('<span class="badge-dot" style="background-color: #a855f7; box-shadow: 0 0 8px #a855f7"></span>Đồng bộ GitHub Pages');
                dsInfo.innerHTML = `<i class="fa-solid fa-globe text-primary" style="color: #a855f7"></i> Đang hiển thị dữ liệu tĩnh từ <strong>GitHub Pages</strong>`;
                initApp();
                return;
            }
        } catch (staticErr) {
            console.warn('Could not fetch static database.json:', staticErr);
        }
        
        // Offline Fallback
        const cachedTarget = localStorage.getItem('cached_fi_target');
        const cachedTxs = localStorage.getItem('cached_transactions');
        
        if (cachedTarget && cachedTxs) {
            appData.fi_target = parseFloat(cachedTarget);
            appData.transactions = JSON.parse(cachedTxs);
            updateConnectionBadges('<span class="badge-dot" style="background-color: var(--warn); box-shadow: 0 0 8px var(--warn)"></span>Chạy Offline (Cache)');
            if (isCloudMode()) {
                dsInfo.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-warn"></i> Mất kết nối Cloud: Đang sử dụng dữ liệu cục bộ trình duyệt';
            } else {
                dsInfo.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-warn"></i> Mất kết nối Máy chủ: Đang sử dụng dữ liệu cục bộ trình duyệt';
            }
            initApp();
        } else {
            appData.fi_target = 4500000000;
            appData.transactions = [];
            updateConnectionBadges('<span class="badge-dot" style="background-color: var(--expense); box-shadow: 0 0 8px var(--expense)"></span>Offline (Trống)');
            dsInfo.innerHTML = '<i class="fa-solid fa-circle-xmark text-expense"></i> Không có kết nối. Kéo thả file Excel của bạn để bắt đầu!';
            initApp();
            showEmptyState();
        }
    }
}


// Check and refresh data if changed (background sync)
async function checkAndRefreshData() {
    try {
        const response = await fetch(`${apiBase}/api/data`, { headers: getAuthHeaders() });
        if (response.status === 401) {
            handleAuthRequired(false);
            return;
        }
        if (!response.ok) return;
        const data = await response.json();
        
        const currentHash = JSON.stringify(data.transactions);
        if (currentHash !== lastTransactionsHash) {
            console.log("Detecting new data updates from server. Refreshing UI...");
            lastTransactionsHash = currentHash;
            appData.fi_target = data.fi_target;
            appData.transactions = data.transactions;
            
            // Cache locally for backup
            localStorage.setItem('cached_fi_target', appData.fi_target);
            localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));
            
            // Re-render the application widgets and charts
            initApp();
        }
    } catch (err) {
        console.warn("Background data sync check failed:", err);
    }
}

// Sync local cache data up to server
async function syncLocalDataToServer(txs, target) {
    try {
        const response = await fetch(`${apiBase}/api/sync`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ transactions: txs, fi_target: target })
        });
        const resData = await response.json();
        if (resData.status === 'success') {
            showToast('Di chuyển dữ liệu', 'Đã tự động tải dữ liệu trình duyệt cũ lên máy chủ thành công!');
        }
    } catch (err) {
        console.error('Error syncing local data to server:', err);
    }
}

// Populate filter select with actual sheet values dynamically
function populateSheetFilter() {
    const filterSheet = document.getElementById('filter-sheet');
    if (!filterSheet) return;
    
    const currentValue = filterSheet.value;
    const uniqueSheets = [...new Set(appData.transactions.map(t => t.sheet || 'QUẢN LÝ WEB'))];
    
    filterSheet.innerHTML = '<option value="all">Tất cả nguồn dữ liệu</option>';
    uniqueSheets.forEach(sheet => {
        const opt = document.createElement('option');
        opt.value = sheet;
        opt.innerText = sheet;
        filterSheet.appendChild(opt);
    });
    
    if (currentValue && uniqueSheets.includes(currentValue)) {
        filterSheet.value = currentValue;
    } else {
        filterSheet.value = 'all';
    }
}

// Initialize Application Widgets & Charts
function initApp() {
    // Ensure every transaction has a sequence number and unique ID
    appData.transactions.forEach((tx, idx) => {
        tx.seq = idx + 1;
        if (!tx.id) tx.id = 'tx_' + idx + '_' + Math.random().toString(36).substr(2, 9);
    });

    // Sort transactions chronologically (ascending for net worth, but list descending for ledger)
    appData.transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    populateSheetFilter();
    calculateStats();
    renderCharts();
    renderWidgets();
    filterTransactions(); // Initialize ledger tab
}



// Calculate Statistics
function calculateStats() {
    const range = getDashboardDateRange();
    
    // 1. Calculate All-time stats (for Net Worth, Cash, Debts, Receivables, etc.)
    let incomeAllTime = 0;
    let expenseAllTime = 0;
    let debtsOriginalAllTime = 0;
    let receivablesOriginalAllTime = 0;
    let investmentsAllTime = 0;
    let repaymentsSumAllTime = 0;
    let paymentsSumAllTime = 0;
    
    // Starting balance variables
    let startingAvailableAllTime = 0;
    let startingCashSeq = 0;
    
    // Find the latest starting balance seq
    appData.transactions.forEach(tx => {
        if (tx.group === 'KHOẢN THU' && tx.category === 'Có sẵn / Khác') {
            startingAvailableAllTime += tx.amount;
            if (tx.seq > startingCashSeq) {
                startingCashSeq = tx.seq;
            }
        }
    });
    
    // Cash on Hand flow since starting balance
    let cashFlowAfterStarting = 0;
    
    // 2. Calculate Filtered stats (for Period Income, Period Expense)
    let incomeFiltered = 0;
    let expenseFiltered = 0;
    
    appData.transactions.forEach(tx => {
        const { inRange } = isTransactionInDateRange(tx.date, range);
        
        if (tx.group === 'KHOẢN THU') {
            if (tx.category !== 'Có sẵn / Khác') {
                incomeAllTime += tx.amount;
                if (inRange) incomeFiltered += tx.amount;
                
                // Add to cash flow if after starting balance
                if (tx.seq > startingCashSeq) {
                    cashFlowAfterStarting += tx.amount;
                }
            }
            if (tx.category === 'Nợ trả') {
                repaymentsSumAllTime += tx.amount;
            }
        } else if (tx.group === 'KHOẢN CHI') {
            expenseAllTime += tx.amount;
            if (inRange) expenseFiltered += tx.amount;
            
            // Subtract from cash flow if after starting balance
            if (tx.seq > startingCashSeq) {
                cashFlowAfterStarting -= tx.amount;
            }
            
            if (tx.category === 'Trả nợ' || tx.item.toLowerCase().startsWith('trả nợ') || tx.item.toLowerCase().startsWith('trả ')) {
                paymentsSumAllTime += tx.amount;
            }
        } else if (tx.group === 'KHOẢN NỢ') {
            debtsOriginalAllTime += tx.amount;
            
            // Add to cash flow if after starting balance
            if (tx.seq > startingCashSeq) {
                cashFlowAfterStarting += tx.amount;
            }
        } else if (tx.group === 'ĐÒI NỢ') {
            receivablesOriginalAllTime += tx.amount;
            // ĐÒI NỢ là chuyển đổi tài sản (cash → receivable), không phải chi tiêu thực

            // Subtract from cash flow if after starting balance
            if (tx.seq > startingCashSeq) {
                cashFlowAfterStarting -= tx.amount;
            }
        } else if (tx.group === 'DOANH THU ĐẦU TƯ') {
            investmentsAllTime += tx.amount;
        }
    });
    
    const debtsNetAllTime = Math.max(debtsOriginalAllTime - paymentsSumAllTime, 0);
    const receivablesNetAllTime = Math.max(receivablesOriginalAllTime - repaymentsSumAllTime, 0);
    
    // Cash on Hand: Starting cash + cash flow change since that start
    const cashOnHandAllTime = startingAvailableAllTime + cashFlowAfterStarting;

    // Net Worth = tiền mặt thực tế + các khoản phải thu - các khoản nợ + đầu tư
    // Công thức cũ (sai): dùng surplus không tính tiền vay vào → vay tiền làm netWorth giảm sai
    const netWorthAllTime = cashOnHandAllTime + receivablesNetAllTime - debtsNetAllTime + investmentsAllTime;
    const netSurplusAllTime = cashOnHandAllTime + receivablesNetAllTime - debtsNetAllTime;
    
    // Filtered surplus
    const surplusFiltered = incomeFiltered - expenseFiltered;
    
    // Set UI values
    document.getElementById('val-net-worth').innerText = formatVND(netWorthAllTime);
    document.getElementById('val-cash-on-hand').innerText = formatVND(cashOnHandAllTime);
    document.getElementById('val-total-income').innerText = formatVND(incomeFiltered);
    document.getElementById('val-total-expense').innerText = formatVND(expenseFiltered);
    document.getElementById('val-total-surplus').innerText = formatVND(netSurplusAllTime);

    // Widget "Trạng thái Công nợ" & "Đầu tư" (trước đây bị hardcode 0đ — nay dùng số thực)
    const sDebt = document.getElementById('summary-debt-val');
    const sRec = document.getElementById('summary-receivable-val');
    const sInv = document.getElementById('summary-invest-val');
    if (sDebt) sDebt.innerText = formatVND(debtsNetAllTime);
    if (sRec) sRec.innerText = formatVND(receivablesNetAllTime);
    if (sInv) sInv.innerText = formatVND(investmentsAllTime);

    // Savings rate (based on filtered period)
    const savingsRate = incomeFiltered > 0 ? (surplusFiltered / incomeFiltered) * 100 : 0;
    document.getElementById('val-savings-rate').innerText = `Tỷ lệ tích lũy: ${savingsRate.toFixed(1)}%`;
    
    // FI Goal Values (FI goal is always based on current all-time net worth)
    const fiPercent = Math.min((netWorthAllTime / appData.fi_target) * 100, 100);
    document.getElementById('fi-target-val').innerText = formatVND(appData.fi_target);
    document.getElementById('fi-current-val').innerText = formatVND(netWorthAllTime);
    document.getElementById('fi-remaining-val').innerText = formatVND(Math.max(appData.fi_target - netWorthAllTime, 0));
    document.getElementById('fi-progress-percent-label').innerText = `${fiPercent.toFixed(2)}%`;
    document.getElementById('fi-progress-fill-bar').style.width = `${fiPercent}%`;
    // Gauge update
    document.getElementById('gauge-percent-val').innerText = `${fiPercent.toFixed(1)}%`;
    const deg = (fiPercent / 100) * 360;
    document.getElementById('gauge-fill-arc').style.background = `conic-gradient(var(--primary) ${deg}deg, rgba(255, 255, 255, 0.03) ${deg}deg)`;
}

// Generate Suggestions card details (Self-correction & Optimizations)
function renderWidgets() {
    const range = getDashboardDateRange();
    
    // 1. Render Income Breakdown list (filtered by range)
    const incomeCats = {};
    appData.transactions
        .filter(t => t.group === 'KHOẢN THU' && t.category !== 'Có sẵn / Khác' && isTransactionInDateRange(t.date, range).inRange)
        .forEach(t => {
            incomeCats[t.category] = (incomeCats[t.category] || 0) + t.amount;
        });
        
    const incomeListEl = document.getElementById('income-breakdown-list');
    incomeListEl.innerHTML = '';
    
    const sortedIncome = Object.keys(incomeCats).sort((a,b) => incomeCats[b] - incomeCats[a]);
    if (sortedIncome.length === 0) {
        incomeListEl.innerHTML = '<div class="widget-row">Chưa có dữ liệu thu nhập</div>';
    } else {
        const colors = ['#34d399', '#60a5fa', '#a78bfa', '#fb923c', '#f472b6', '#38bdf8', '#fbbf24', '#a1a1aa'];
        sortedIncome.forEach((cat, idx) => {
            const row = document.createElement('div');
            row.className = 'widget-row';
            row.innerHTML = `
                <div class="widget-row-label">
                    <span class="dot-indicator" style="background-color: ${colors[idx % colors.length]}"></span>
                    <span>${cat}</span>
                </div>
                <div class="widget-row-value">${formatVND(incomeCats[cat])}</div>
            `;
            incomeListEl.appendChild(row);
        });
    }
    
    // 2. Render Investment details (filtered by range)
    const investmentsListEl = document.getElementById('investment-list');
    investmentsListEl.innerHTML = '';
    const investItems = {};
    appData.transactions
        .filter(t => t.group === 'DOANH THU ĐẦU TƯ' && isTransactionInDateRange(t.date, range).inRange)
        .forEach(t => {
            investItems[t.item] = (investItems[t.item] || 0) + t.amount;
        });
        
    const sortedInvests = Object.keys(investItems).sort((a,b) => investItems[b] - investItems[a]);
    if (sortedInvests.length === 0) {
        investmentsListEl.innerHTML = '<div class="widget-row" style="color: var(--text-muted)">Không có giao dịch đầu tư</div>';
    } else {
        sortedInvests.forEach(item => {
            const row = document.createElement('div');
            row.className = 'widget-row';
            row.innerHTML = `
                <div class="widget-row-label">
                    <i class="fa-solid fa-gem" style="color: var(--primary); font-size: 10px;"></i>
                    <span>${item}</span>
                </div>
                <div class="widget-row-value" style="color: var(--primary)">${formatVND(investItems[item])}</div>
            `;
            investmentsListEl.appendChild(row);
        });
    }

    // 3. Render Debts & Receivables details in Tab Debts
    const debtsBody = document.getElementById('table-debts-body');
    const recBody = document.getElementById('table-receivables-body');
    debtsBody.innerHTML = '';
    recBody.innerHTML = '';
    
    // First pass: extract all base names from KHOẢN NỢ and ĐÒI NỢ
    const baseNames = [];
    appData.transactions.forEach(t => {
        if (t.group === 'KHOẢN NỢ' || t.group === 'ĐÒI NỢ') {
            const name = t.partner || normalizeName(t.item);
            if (name && !baseNames.includes(name)) {
                baseNames.push(name);
            }
        }
    });

    // Smart name matching function for fuzzy matching
    function findBestMatch(rawItem, baseNames) {
        if (!rawItem) return '';
        const name = normalizeName(rawItem);
        
        // 1. Substring match against existing base names (case-insensitive & accent-insensitive)
        const cleanName = stripAccents(name);
        for (const base of baseNames) {
            const cleanBase = stripAccents(base);
            if (cleanName === cleanBase) return base;
            if (cleanName.includes(cleanBase) || cleanBase.includes(cleanName)) {
                return base;
            }
        }
        
        // 2. Word overlap match for minor variations
        const stopwords = ['a', 'anh', 'chị', 'em', 'trả', 'nợ', 'cho', 'thu', 'vay', 'mượn', 'gửi', 'nhờ', 'tiền'];
        const getWords = (str) => stripAccents(str).split(/[\s,._+/]+/).filter(w => w && !stopwords.includes(w));
        
        const itemWords = getWords(name);
        if (itemWords.length === 0) return name;
        
        let bestMatch = name;
        let maxOverlap = 0;
        
        for (const base of baseNames) {
            const baseWords = getWords(base);
            const overlap = baseWords.filter(w => itemWords.includes(w)).length;
            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                bestMatch = base;
            }
        }
        
        if (maxOverlap > 0) {
            return bestMatch;
        }
        return name;
    }

    // Group all debt/receivable transactions by partner or smart matching name
    const people = {};
    appData.transactions.forEach(t => {
        const rawItem = t.item;
        const group = t.group;
        const category = t.category;
        const amount = t.amount;
        const date = t.date;
        
        let name = t.partner; // Use database-supplied normalized partner if exists
        
        if (!name) {
            if (group === 'KHOẢN NỢ' || group === 'ĐÒI NỢ' || (group === 'KHOẢN THU' && category === 'Nợ trả')) {
                name = findBestMatch(rawItem, baseNames);
            } else if (group === 'KHOẢN CHI' && (category === 'Trả nợ' || rawItem.toLowerCase().startsWith('trả nợ') || rawItem.toLowerCase().startsWith('trả '))) {
                let cleanName = rawItem.replace(/trả\s+nợ\s+/i, '').replace(/trả\s+/i, '').trim();
                name = findBestMatch(cleanName, baseNames);
            }
        }
        
        if (name) {
            if (!people[name]) people[name] = { debts: [], receivables: [], repayments: [], payments: [] };
            if (group === 'KHOẢN NỢ') {
                people[name].debts.push({ date, amount, rawItem });
            } else if (group === 'ĐÒI NỢ') {
                people[name].receivables.push({ date, amount, rawItem });
            } else if (group === 'KHOẢN THU' && category === 'Nợ trả') {
                people[name].repayments.push({ date, amount, rawItem });
            } else if (group === 'KHOẢN CHI' && (category === 'Trả nợ' || rawItem.toLowerCase().startsWith('trả nợ') || rawItem.toLowerCase().startsWith('trả '))) {
                people[name].payments.push({ date, amount, rawItem });
            }
        }
    });
    
    let activeDebtsCount = 0;
    let activeRecsCount = 0;
    
    Object.keys(people).sort().forEach(name => {
        const p = people[name];
        
        const totalWeLent = p.receivables.reduce((sum, x) => sum + x.amount, 0);
        const totalTheyPaidUs = p.repayments.reduce((sum, x) => sum + x.amount, 0);
        const totalWeBorrowed = p.debts.reduce((sum, x) => sum + x.amount, 0);
        const totalWePaidThem = p.payments.reduce((sum, x) => sum + x.amount, 0);
        
        // Net position: positive means they owe us, negative means we owe them
        const netPosition = (totalWeLent - totalTheyPaidUs) - (totalWeBorrowed - totalWePaidThem);
        
        // Construct transaction history list HTML
        const historyItems = [];
        p.debts.forEach(x => historyItems.push(`Nhận nợ ${formatVND(x.amount)} (${x.date})`));
        p.receivables.forEach(x => historyItems.push(`Cho vay ${formatVND(x.amount)} (${x.date})`));
        p.repayments.forEach(x => historyItems.push(`Thu ${formatVND(x.amount)} (${x.date})`));
        p.payments.forEach(x => historyItems.push(`Trả ${formatVND(x.amount)} (${x.date})`));
        
        const historyHTML = `<div class="tx-history-list" style="font-size: 11px; color: var(--text-secondary); max-height: 60px; overflow-y: auto; line-height: 1.4;">
            ${historyItems.join('<br>')}
        </div>`;
        
        if (netPosition === 0) {
            // Settled row (Marked as resolved)
            const tr = document.createElement('tr');
            tr.className = 'settled-row';
            
            if (totalWeBorrowed > totalWeLent) {
                activeDebtsCount++;
                tr.innerHTML = `
                    <td class="font-bold" style="text-decoration: line-through; opacity: 0.4;">${name}</td>
                    <td style="opacity: 0.5;">${historyHTML}</td>
                    <td class="text-right font-bold" style="color: var(--text-muted); opacity: 0.4;">0đ</td>
                    <td class="text-center">
                        <span class="badge" style="background-color: rgba(52, 211, 153, 0.08); color: #34d399; border-color: rgba(52, 211, 153, 0.2); font-size: 10px; padding: 4px 8px;">
                            <i class="fa-solid fa-circle-check"></i> Đã trả xong
                        </span>
                    </td>
                `;
                debtsBody.appendChild(tr);
            } else {
                activeRecsCount++;
                tr.innerHTML = `
                    <td class="font-bold" style="text-decoration: line-through; opacity: 0.4;">${name}</td>
                    <td style="opacity: 0.5;">${historyHTML}</td>
                    <td class="text-right font-bold" style="color: var(--text-muted); opacity: 0.4;">0đ</td>
                    <td class="text-center">
                        <span class="badge" style="background-color: rgba(52, 211, 153, 0.08); color: #34d399; border-color: rgba(52, 211, 153, 0.2); font-size: 10px; padding: 4px 8px;">
                            <i class="fa-solid fa-circle-check"></i> Đã đòi xong
                        </span>
                    </td>
                `;
                recBody.appendChild(tr);
            }
            return;
        }
        
        if (netPosition < 0) {
            // We owe them (Nợ phải trả)
            activeDebtsCount++;
            const outstanding = Math.abs(netPosition);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-bold">${name}</td>
                <td>${historyHTML}</td>
                <td class="text-right text-expense font-bold">${formatVND(outstanding)}</td>
                <td class="text-center">
                    <button class="btn btn-secondary btn-sm" onclick="settleDebt('${name}', ${outstanding})" style="padding: 4px 8px; font-size: 11px; border-radius: 6px;">
                        <i class="fa-solid fa-square-check text-expense"></i> Trả xong
                    </button>
                </td>
            `;
            debtsBody.appendChild(tr);
        } else {
            // They owe us (Cho vay / Đòi nợ)
            activeRecsCount++;
            const outstanding = netPosition;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-bold">${name}</td>
                <td>${historyHTML}</td>
                <td class="text-right text-surplus font-bold">${formatVND(outstanding)}</td>
                <td class="text-center">
                    <button class="btn btn-secondary btn-sm" onclick="settleReceivable('${name}', ${outstanding})" style="padding: 4px 8px; font-size: 11px; border-radius: 6px;">
                        <i class="fa-solid fa-square-check text-surplus"></i> Đòi xong
                    </button>
                </td>
            `;
            recBody.appendChild(tr);
        }
    });
    
    if (activeDebtsCount === 0) {
        debtsBody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: var(--text-muted); padding: 20px;">Không có khoản nợ nào cần trả</td></tr>';
    }
    if (activeRecsCount === 0) {
        recBody.innerHTML = '<tr><td colspan="4" class="text-center" style="color: var(--text-muted); padding: 20px;">Không có khoản cho vay nào cần đòi</td></tr>';
    }

    // 4. Financial suggestions logic (Goal tab - filtered by range)
    const suggestionsGrid = document.getElementById('suggestion-cards-grid');
    suggestionsGrid.innerHTML = '';
    
    // Calculate total operational income and expense in range
    let totalOpIncome = appData.transactions
        .filter(t => t.group === 'KHOẢN THU' && t.category !== 'Có sẵn / Khác' && isTransactionInDateRange(t.date, range).inRange)
        .reduce((sum, t) => sum + t.amount, 0);
    let totalExpense = appData.transactions
        .filter(t => t.group === 'KHOẢN CHI' && isTransactionInDateRange(t.date, range).inRange)
        .reduce((sum, t) => sum + t.amount, 0);
    const surplus = totalOpIncome - totalExpense;
    const savingsRate = totalOpIncome > 0 ? (surplus / totalOpIncome) * 100 : 0;
    
    // Find top expense category in range
    const expenseCats = {};
    appData.transactions
        .filter(t => t.group === 'KHOẢN CHI' && isTransactionInDateRange(t.date, range).inRange)
        .forEach(t => {
            expenseCats[t.category] = (expenseCats[t.category] || 0) + t.amount;
        });
    let topExpenseCat = 'Không có';
    let topExpenseVal = 0;
    Object.keys(expenseCats).forEach(cat => {
        if (expenseCats[cat] > topExpenseVal) {
            topExpenseVal = expenseCats[cat];
            topExpenseCat = cat;
        }
    });

    const suggestions = [];

    // Suggestion 1: Savings Rate Analysis
    if (savingsRate < 20) {
        suggestions.push({
            icon: 'fa-triangle-exclamation text-warn',
            title: 'Tăng Tỷ Lệ Tiết Kiệm',
            body: `Tỷ lệ tiết kiệm hiện hành chỉ ở mức ${savingsRate.toFixed(1)}% (Thấp hơn mức an toàn 20%). Bạn nên cân nhắc áp dụng quy tắc JARS (6 chiếc hũ) hoặc 50/30/20 để cắt giảm nhu cầu không cần thiết.`
        });
    } else if (savingsRate >= 40) {
        suggestions.push({
            icon: 'fa-circle-check text-surplus',
            title: 'Tốc độ tích lũy cao',
            body: `Tỷ lệ tiết kiệm xuất sắc đạt ${savingsRate.toFixed(1)}%! Với tốc độ tích lũy hiện tại, bạn đang tối ưu hóa tốt dòng tiền nhàn rỗi để đầu tư sinh lời.`
        });
    } else {
        suggestions.push({
            icon: 'fa-lightbulb text-primary',
            title: 'Duy trì kỷ luật tài chính',
            body: `Tỷ lệ tiết kiệm hiện tại là ${savingsRate.toFixed(1)}%. Khuyến nghị duy trì và nâng dần lên 35% bằng cách cắt bớt khoản chi tiêu linh hoạt (Wants).`
        });
    }

    // Suggestion 2: Top Expense Category Analysis
    if (topExpenseVal > 0) {
        const percent = totalExpense > 0 ? (topExpenseVal / totalExpense) * 100 : 0;
        suggestions.push({
            icon: 'fa-magnifying-glass-chart text-sky',
            title: `Tối ưu danh mục "${topExpenseCat}"`,
            body: `Chi tiêu nhiều nhất nằm ở mục "${topExpenseCat}" với tổng ${formatVND(topExpenseVal)} (chiếm ${percent.toFixed(1)}% tổng chi). Hãy kiểm duyệt lại các giao dịch trong danh mục này để tìm cơ hội tiết giảm.`
        });
    }

    // Suggestion 3: Cash flow projections
    const totalNetWorth = appData.transactions
        .filter(t => t.category === 'Có sẵn / Khác')
        .reduce((sum, t) => sum + t.amount, 0) + (appData.transactions.filter(t => t.group === 'KHOẢN THU' && t.category !== 'Có sẵn / Khác').reduce((sum, t) => sum + t.amount, 0) - appData.transactions.filter(t => t.group === 'KHOẢN CHI').reduce((sum, t) => sum + t.amount, 0));
    const missing = appData.fi_target - totalNetWorth;
    
    if (missing > 0) {
        const yearsToFI = missing / (15000000 * 12); // standard 15M/mo savings assumption
        suggestions.push({
            icon: 'fa-hourglass-half text-warn',
            title: 'Ước tính Tự do Tài chính',
            body: `Để bù đắp khoản thiếu hụt ${formatVND(missing)} với định mức tích lũy định kỳ 15,000,000đ/tháng, bạn sẽ cần khoảng ${yearsToFI.toFixed(1)} năm nữa để đạt tự do tài chính hoàn toàn.`
        });
    }

    suggestions.forEach(s => {
        const card = document.createElement('div');
        card.className = 'suggestion-card';
        card.innerHTML = `
            <div class="suggestion-card-header">
                <i class="fa-solid ${s.icon}"></i>
                <span>${s.title}</span>
            </div>
            <div class="suggestion-card-body">${s.body}</div>
        `;
        suggestionsGrid.appendChild(card);
    });
}

// Render Interactive Chart.js charts
function renderCharts() {
    const range = getDashboardDateRange();
    const isDark = !document.body.classList.contains('light-mode');
    const labelColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.05)';
    
    // Update active button state based on the saved mode
    const chartMode = localStorage.getItem('netWorthChartMode') || 'transaction';
    const btnTx = document.getElementById('btn-chart-tx');
    const btnSheet = document.getElementById('btn-chart-sheet');
    if (btnTx && btnSheet) {
        if (chartMode === 'transaction') {
            btnTx.classList.add('active');
            btnSheet.classList.remove('active');
        } else {
            btnTx.classList.remove('active');
            btnSheet.classList.add('active');
        }
    }

    const chartLabels = [];
    const netWorthPoints = [];
    const chartDatesFull = [];
    const chartItems = [];
    
    if (chartMode === 'transaction') {
        // Mode: Transaction-by-transaction chronological chart
        let runningStarting = 0;
        let runningIncome = 0;
        let runningExpense = 0;
        let runningInvestments = 0;
        let runningReceivables = 0;
        let runningDebts = 0;
        let runningRepayments = 0;
        let runningPayments = 0;
        
        // Split transactions into before and within filtered range
        const beforeTxs = [];
        const rangeTxs = [];
        
        appData.transactions.forEach(t => {
            const { inRange, isBefore } = isTransactionInDateRange(t.date, range);
            if (isBefore) {
                beforeTxs.push(t);
            } else if (inRange) {
                rangeTxs.push(t);
            }
        });
        
        // Sum up preceding values to calculate starting net worth balance
        beforeTxs.forEach(t => {
            if (t.group === 'KHOẢN THU') {
                if (t.category === 'Có sẵn / Khác') {
                    runningStarting += t.amount;
                } else {
                    runningIncome += t.amount;
                    if (t.category === 'Nợ trả') {
                        runningRepayments += t.amount;
                    }
                }
            } else if (t.group === 'KHOẢN CHI') {
                runningExpense += t.amount;
                if (t.category === 'Trả nợ' || t.item.toLowerCase().startsWith('trả nợ') || t.item.toLowerCase().startsWith('trả ')) {
                    runningPayments += t.amount;
                }
            } else if (t.group === 'KHOẢN NỢ') {
                runningDebts += t.amount;
            } else if (t.group === 'ĐÒI NỢ') {
                runningReceivables += t.amount;
            } else if (t.group === 'DOANH THU ĐẦU TƯ') {
                runningInvestments += t.amount;
            }
        });
        
        // Add a starting point if range is filtered and history exists
        if (range !== 'all' && beforeTxs.length > 0) {
            const debtsNet = Math.max(runningDebts - runningPayments, 0);
            const receivablesNet = Math.max(runningReceivables - runningRepayments, 0);
            const cashOnHand = runningStarting + runningIncome - runningExpense + runningDebts - runningReceivables;
            const initialNetWorth = cashOnHand + receivablesNet - debtsNet + runningInvestments;
            
            chartLabels.push("Khởi đầu");
            netWorthPoints.push(initialNetWorth);
            chartDatesFull.push("Trước kỳ đầu");
            chartItems.push("Số dư tích lũy ban đầu");
        }
        
        // Plot remaining transactions inside range
        rangeTxs.forEach(t => {
            if (t.group === 'KHOẢN THU') {
                if (t.category === 'Có sẵn / Khác') {
                    runningStarting += t.amount;
                } else {
                    runningIncome += t.amount;
                    if (t.category === 'Nợ trả') {
                        runningRepayments += t.amount;
                    }
                }
            } else if (t.group === 'KHOẢN CHI') {
                runningExpense += t.amount;
                if (t.category === 'Trả nợ' || t.item.toLowerCase().startsWith('trả nợ') || t.item.toLowerCase().startsWith('trả ')) {
                    runningPayments += t.amount;
                }
            } else if (t.group === 'KHOẢN NỢ') {
                runningDebts += t.amount;
            } else if (t.group === 'ĐÒI NỢ') {
                runningReceivables += t.amount;
            } else if (t.group === 'DOANH THU ĐẦU TƯ') {
                runningInvestments += t.amount;
            }
            
            const debtsNet = Math.max(runningDebts - runningPayments, 0);
            const receivablesNet = Math.max(runningReceivables - runningRepayments, 0);
            const cashOnHand = runningStarting + runningIncome - runningExpense + runningDebts - runningReceivables;
            const currentNetWorth = cashOnHand + receivablesNet - debtsNet + runningInvestments;

            const dObj = new Date(t.date);
            const dateStr = isNaN(dObj.getTime()) ? t.date : `${String(dObj.getDate()).padStart(2, '0')}/${String(dObj.getMonth() + 1).padStart(2, '0')}`;
            const dateStrFull = isNaN(dObj.getTime()) ? t.date : `${String(dObj.getDate()).padStart(2, '0')}/${String(dObj.getMonth() + 1).padStart(2, '0')}/${dObj.getFullYear()}`;
            
            chartLabels.push(dateStr);
            netWorthPoints.push(currentNetWorth);
            chartDatesFull.push(dateStrFull);
            chartItems.push(t.item);
        });
    } else {
        // Mode: Grouped by Month or Sheet dynamically
        const rangeFilteredTxs = appData.transactions.filter(t => isTransactionInDateRange(t.date, range).inRange);
        
        const uniqueSheets = [...new Set(rangeFilteredTxs.map(t => t.sheet))];
        const useSheetGrouping = uniqueSheets.length > 1;
        
        const groups = {};
        
        rangeFilteredTxs.forEach(t => {
            const groupKey = useSheetGrouping ? t.sheet : t.date.substring(0, 7); // Sheet name or YYYY-MM
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    income: 0,
                    expense: 0,
                    roi: 0,
                    debt: 0,
                    receivable: 0,
                    starting: 0,
                    repayments: 0,
                    payments: 0
                };
            }
            
            if (t.group === 'KHOẢN THU') {
                if (t.category === 'Có sẵn / Khác') {
                    groups[groupKey].starting += t.amount;
                } else {
                    groups[groupKey].income += t.amount;
                    if (t.category === 'Nợ trả') {
                        groups[groupKey].repayments += t.amount;
                    }
                }
            } else if (t.group === 'KHOẢN CHI') {
                groups[groupKey].expense += t.amount;
                if (t.item.toLowerCase().startsWith('trả nợ') || t.item.toLowerCase().startsWith('trả ')) {
                    groups[groupKey].payments += t.amount;
                }
            } else if (t.group === 'KHOẢN NỢ') {
                groups[groupKey].debt += t.amount;
            } else if (t.group === 'ĐÒI NỢ') {
                groups[groupKey].receivable += t.amount;
            } else if (t.group === 'DOANH THU ĐẦU TƯ') {
                groups[groupKey].roi += t.amount;
            }
        });

        const groupKeys = Object.keys(groups);
        if (useSheetGrouping) {
            const sheetFirstDates = {};
            rangeFilteredTxs.forEach(t => {
                if (!sheetFirstDates[t.sheet]) {
                    sheetFirstDates[t.sheet] = new Date(t.date).getTime();
                }
            });
            groupKeys.sort((a, b) => (sheetFirstDates[a] || 0) - (sheetFirstDates[b] || 0));
        } else {
            groupKeys.sort();
        }
        
        // We calculate all preceding transactions before range start for correct offset
        let runningStarting = 0;
        let runningIncome = 0;
        let runningExpense = 0;
        let runningInvestments = 0;
        let runningReceivables = 0;
        let runningDebts = 0;
        let runningRepayments = 0;
        let runningPayments = 0;
        
        appData.transactions.forEach(t => {
            const { isBefore } = isTransactionInDateRange(t.date, range);
            if (isBefore) {
                if (t.group === 'KHOẢN THU') {
                    if (t.category === 'Có sẵn / Khác') {
                        runningStarting += t.amount;
                    } else {
                        runningIncome += t.amount;
                        if (t.category === 'Nợ trả') {
                            runningRepayments += t.amount;
                        }
                    }
                } else if (t.group === 'KHOẢN CHI') {
                    runningExpense += t.amount;
                    if (t.item.toLowerCase().startsWith('trả nợ') || t.item.toLowerCase().startsWith('trả ')) {
                        runningPayments += t.amount;
                    }
                } else if (t.group === 'KHOẢN NỢ') {
                    runningDebts += t.amount;
                } else if (t.group === 'ĐÒI NỢ') {
                    runningReceivables += t.amount;
                } else if (t.group === 'DOANH THU ĐẦU TƯ') {
                    runningInvestments += t.amount;
                }
            }
        });
        
        groupKeys.forEach(key => {
            const g = groups[key];
            runningStarting += g.starting;
            runningIncome += g.income;
            runningExpense += g.expense;
            runningInvestments += g.roi;
            runningReceivables += g.receivable;
            runningDebts += g.debt;
            runningRepayments += g.repayments;
            runningPayments += g.payments;
            
            const debtsNet = Math.max(runningDebts - runningPayments, 0);
            const receivablesNet = Math.max(runningReceivables - runningRepayments, 0);
            const cashOnHand = runningStarting + runningIncome - runningExpense + runningDebts - runningReceivables;
            const currentNetWorth = cashOnHand + receivablesNet - debtsNet + runningInvestments;

            let displayLabel = key;
            if (!useSheetGrouping) {
                const parts = key.split('-');
                displayLabel = `${parts[1]}/${parts[0].substring(2)}`;
            }
            
            chartLabels.push(displayLabel);
            netWorthPoints.push(currentNetWorth);
            chartDatesFull.push(useSheetGrouping ? `Sheet: ${key}` : `Tháng: ${displayLabel}`);
            chartItems.push(`Kết kỳ`);
        });
    }

    // 1. Line Chart (Net worth history)
    const netWorthContainer = document.getElementById('net-worth-chart-container');
    if (netWorthContainer) {
        netWorthContainer.innerHTML = '<canvas id="chart-net-worth"></canvas>';
    }
    const ctxLine = document.getElementById('chart-net-worth').getContext('2d');
    if (netWorthChart) netWorthChart.destroy();
    
    netWorthChart = new Chart(ctxLine, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: [{
                label: 'Tài sản tích lũy (VND)',
                data: netWorthPoints,
                borderColor: '#38bdf8',
                backgroundColor: 'rgba(56, 189, 248, 0.05)',
                borderWidth: 3,
                tension: 0.35,
                fill: true,
                pointBackgroundColor: '#38bdf8'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: function(context) {
                            const index = context[0].dataIndex;
                            return chartDatesFull[index] || context[0].label;
                        },
                        label: function(context) {
                            const index = context.dataIndex;
                            const itemInfo = chartItems[index] ? ` (${chartItems[index]})` : '';
                            return 'Tài sản: ' + formatVND(context.raw) + itemInfo;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: labelColor, font: { family: 'Inter', size: 10 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: {
                        color: labelColor,
                        font: { family: 'Inter', size: 10 },
                        callback: function(value) {
                            return (value / 1000000).toLocaleString() + 'Mđ';
                        }
                    }
                }
            }
        }
    });

    // 2. Expense breakdown doughnut chart (filtered by range)
    const expenseCats = {};
    appData.transactions
        .filter(t => (t.group === 'KHOẢN CHI' || t.group === 'ĐÒI NỢ') && isTransactionInDateRange(t.date, range).inRange)
        .forEach(t => {
            expenseCats[t.category] = (expenseCats[t.category] || 0) + t.amount;
        });

    const donutLabels = Object.keys(expenseCats);
    const donutData = Object.values(expenseCats);
    
    const expenseContainer = document.getElementById('expense-chart-container');
    if (expenseContainer) {
        expenseContainer.innerHTML = '<canvas id="chart-expenses-donut"></canvas>';
    }
    const ctxDonut = document.getElementById('chart-expenses-donut').getContext('2d');
    if (expenseDonutChart) expenseDonutChart.destroy();
    
    const chartColors = ['#f87171', '#38bdf8', '#fbbf24', '#a78bfa', '#fb923c', '#4ade80', '#ec4899', '#64748b'];
    
    expenseDonutChart = new Chart(ctxDonut, {
        type: 'doughnut',
        data: {
            labels: donutLabels,
            datasets: [{
                data: donutData,
                backgroundColor: chartColors,
                borderWidth: isDark ? 2 : 1,
                borderColor: isDark ? '#0f172a' : '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: window.innerWidth < 768 ? 'bottom' : 'right',
                    labels: {
                        color: labelColor,
                        font: { family: 'Inter', size: 11 },
                        boxWidth: 12
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const sum = context.dataset.data.reduce((a, b) => a + b, 0);
                            const val = context.raw;
                            const pct = ((val / sum) * 100).toFixed(1);
                            return ` ${context.label}: ${formatVND(val)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '70%'
        }
    });
}

// Filter and Search Transactions for ledger tab
function filterTransactions() {
    const searchVal = document.getElementById('search-tx').value.toLowerCase().trim();
    const sheetVal = document.getElementById('filter-sheet').value;
    const groupVal = document.getElementById('filter-group').value;
    
    appData.filteredTransactions = appData.transactions.filter(tx => {
        // Search
        const matchesSearch = tx.item.toLowerCase().includes(searchVal) || tx.category.toLowerCase().includes(searchVal);
        // Sheet
        const matchesSheet = sheetVal === 'all' || tx.sheet === sheetVal;
        // Flow Group
        const matchesGroup = groupVal === 'all' || tx.group === groupVal;
        
        return matchesSearch && matchesSheet && matchesGroup;
    });
    
    // Sort transactions reverse chronologically (newest first). If same date, show latest inserted first.
    appData.filteredTransactions.sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        return b.seq - a.seq;
    });
    
    // Set total count label
    document.getElementById('ledger-count-label').innerText = `Tìm thấy ${appData.filteredTransactions.length} dòng`;
    
    currentPage = 1;
    renderLedgerTable();
}

// Render ledger pagination rows
function renderLedgerTable() {
    const tbody = document.getElementById('ledger-tbody');
    tbody.innerHTML = '';
    
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, appData.filteredTransactions.length);
    const pageTxs = appData.filteredTransactions.slice(startIndex, endIndex);
    
    const groupBadgeClass = {
        'KHOẢN THU': 'badge-income-row',
        'KHOẢN CHI': 'badge-expense-row',
        'KHOẢN NỢ': 'badge-debt-row',
        'ĐÒI NỢ': 'badge-rec-row',
        'DOANH THU ĐẦU TƯ': 'badge-roi-row'
    };
    
    if (pageTxs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color: var(--text-muted); padding: 40px;">Không có giao dịch nào khớp với bộ lọc.</td></tr>';
        document.getElementById('page-indicator').innerText = 'Trang 0 / 0';
        return;
    }
    
    pageTxs.forEach(t => {
        const tr = document.createElement('tr');
        const isExp = t.group === 'KHOẢN CHI' || t.group === 'ĐÒI NỢ';
        const sign = isExp ? '-' : '+';
        const valClass = isExp ? 'text-expense font-bold' : 'text-surplus font-bold';
        const badgeClass = groupBadgeClass[t.group] || 'badge-default';
        
        tr.innerHTML = `
            <td style="color: var(--text-muted)">${t.sheet}</td>
            <td>${t.date}</td>
            <td><span class="row-badge ${badgeClass}">${t.group}</span></td>
            <td>${t.category}</td>
            <td>${t.item}</td>
            <td class="text-right ${valClass}">${sign}${formatVND(t.amount)}</td>
            <td class="text-center">
                <button class="btn btn-secondary btn-sm" onclick="editTransaction('${t.id}')" style="padding: 4px 8px; font-size: 11px; border-radius: 6px; color: var(--primary); border-color: rgba(99, 102, 241, 0.2); margin-right: 4px;" title="Sửa giao dịch này">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-secondary btn-sm" onclick="deleteTransaction('${t.id}')" style="padding: 4px 8px; font-size: 11px; border-radius: 6px; color: var(--expense); border-color: rgba(248, 113, 113, 0.2);" title="Xóa giao dịch này">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    // Update pagination labels
    const maxPage = Math.ceil(appData.filteredTransactions.length / rowsPerPage);
    document.getElementById('page-indicator').innerText = `Trang ${currentPage} / ${maxPage}`;
    
    // Disable buttons accordingly
    document.getElementById('btn-prev-page').disabled = currentPage === 1;
    document.getElementById('btn-next-page').disabled = currentPage === maxPage || maxPage === 0;
}

// Handle Form Submission and Dynamic API syncing
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const spinner = document.getElementById('save-spinner');
    const saveBtn = document.getElementById('btn-save-tx');
    
    spinner.classList.remove('hidden');
    saveBtn.disabled = true;
    
    const tx = {
        sheet: 'QUẢN LÝ WEB',
        date: document.getElementById('tx-date').value,
        group: document.getElementById('tx-group').value,
        category: document.getElementById('tx-category').value,
        item: document.getElementById('tx-item').value.trim(),
        amount: parseFloat(document.getElementById('tx-amount').value)
    };

    const isEditing = !!editingTxId;
    const apiUrl = isEditing ? `${apiBase}/api/edit` : `${apiBase}/api/transaction`;
    if (isEditing) tx.id = editingTxId;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(tx)
        });

        const resData = await response.json();
        if (resData.status === 'success') {
            appData.fi_target = resData.fi_target;
            appData.transactions = resData.transactions;

            // Recache
            localStorage.setItem('cached_fi_target', resData.fi_target);
            localStorage.setItem('cached_transactions', JSON.stringify(resData.transactions));

            initApp();
            showToast(isEditing ? 'Đã cập nhật' : 'Đã lưu giao dịch', isEditing ? 'Giao dịch đã được cập nhật!' : 'Giao dịch mới đã được lưu vào máy chủ!');
            document.getElementById('modal-add-tx').classList.add('hidden');
        } else {
            throw new Error(resData.message || 'Server error occurred');
        }
    } catch (err) {
        console.error('Lưu giao dịch thất bại:', err);

        // Ở chế độ Cloud Gist: KHÔNG lưu cục bộ giả (tránh lệch dữ liệu) — báo lỗi thật
        if (isCloudMode()) {
            editingTxId = null;
            spinner.classList.add('hidden');
            saveBtn.disabled = false;
            showToast('Không lưu được lên Cloud', err.message || 'Ghi lên GitHub Gist thất bại. Thay đổi CHƯA được lưu.', 'error');
            return;
        }

        // Chế độ máy chủ local: Offline Save Fallback
        if (isEditing) {
            const idx = appData.transactions.findIndex(t => t.id === editingTxId);
            if (idx !== -1) {
                appData.transactions[idx] = { ...appData.transactions[idx], ...tx };
            }
        } else {
            tx.id = 'tx_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 9);
            tx.row = appData.transactions.length + 1;
            appData.transactions.push(tx);
        }

        localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));

        initApp();
        showToast('Đã lưu Offline', 'Mất kết nối máy chủ! Thay đổi được lưu tạm thời trên trình duyệt.', 'warning');
        document.getElementById('modal-add-tx').classList.add('hidden');
    } finally {
        editingTxId = null;
        spinner.classList.add('hidden');
        saveBtn.disabled = false;
    }
}

// Toast Notification controller
function showToast(title, body, type = 'success') {
    const toast = document.getElementById('toast-msg');
    const tIcon = document.getElementById('toast-icon-box');
    const tTitle = document.getElementById('toast-title-text');
    const tBody = document.getElementById('toast-body-text');
    
    tTitle.innerText = title;
    tBody.innerText = body;
    
    if (type === 'success') {
        tIcon.innerHTML = '<i class="fa-solid fa-circle-check" style="color: var(--surplus)"></i>';
    } else if (type === 'warning') {
        tIcon.innerHTML = '<i class="fa-solid fa-circle-exclamation" style="color: var(--warn)"></i>';
    } else {
        tIcon.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color: var(--expense)"></i>';
    }
    
    toast.classList.remove('hidden');
    
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 4500);
}

// Global actions to settle debts & receivables
window.settleDebt = async function(name, amount) {
    if (!confirm(`Bạn có chắc chắn muốn ghi nhận ĐÃ TRẢ khoản nợ ${formatVND(amount)} cho "${name}"?`)) return;
    
    const tx = {
        date: new Date().toISOString().split('T')[0],
        group: 'KHOẢN CHI',
        category: 'Trả nợ',
        item: `Trả nợ ${name}`,
        amount: amount
    };
    
    await submitSettleTransaction(tx);
};

window.settleReceivable = async function(name, amount) {
    if (!confirm(`Bạn có chắc chắn muốn ghi nhận ĐÃ THU ĐÒI được ${formatVND(amount)} từ "${name}"?`)) return;
    
    const tx = {
        date: new Date().toISOString().split('T')[0],
        group: 'KHOẢN THU',
        category: 'Nợ trả',
        item: `${name} trả`,
        amount: amount
    };
    
    await submitSettleTransaction(tx);
};

async function submitSettleTransaction(tx) {
    try {
        const response = await fetch(`${apiBase}/api/transaction`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(tx)
        });
        
        const resData = await response.json();
        if (resData.status === 'success') {
            appData.fi_target = resData.fi_target;
            appData.transactions = resData.transactions;
            
            localStorage.setItem('cached_fi_target', resData.fi_target);
            localStorage.setItem('cached_transactions', JSON.stringify(resData.transactions));
            
            initApp();
            showToast('Thành công', 'Đã lưu giao dịch thanh toán vào máy chủ!');
        } else {
            throw new Error(resData.message || 'Server error occurred');
        }
    } catch (err) {
        console.warn('Backend sync failed, storing transaction locally...', err);
        
        tx.id = 'tx_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 9);
        tx.row = appData.transactions.length + 1;
        tx.sheet = 'QUẢN LÝ WEB';
        appData.transactions.push(tx);
        
        localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));
        
        initApp();
        showToast('Đã lưu Offline', 'Mất kết nối máy chủ! Giao dịch lưu tạm thời trên trình duyệt.', 'warning');
    }
}

// Global action to change chart mode (transaction-by-transaction vs monthly/sheet)
window.setChartMode = function(mode) {
    localStorage.setItem('netWorthChartMode', mode);
    renderCharts();
};

// Global action to change financial goal target
window.promptChangeGoal = async function() {
    const currentGoal = appData.fi_target;
    const newGoalStr = prompt("Nhập số tiền mục tiêu Độc lập tài chính mới (VNĐ):", currentGoal);
    
    if (newGoalStr === null) return; // User cancelled
    
    const newGoal = parseFloat(newGoalStr.replace(/[^0-9]/g, ''));
    if (isNaN(newGoal) || newGoal <= 0) {
        showToast('Lỗi mục tiêu', 'Số tiền mục tiêu không hợp lệ. Vui lòng nhập số dương!', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${apiBase}/api/goal`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ fi_target: newGoal })
        });
        
        const resData = await response.json();
        if (resData.status === 'success') {
            appData.fi_target = resData.fi_target;
            appData.transactions = resData.transactions;
            
            localStorage.setItem('cached_fi_target', resData.fi_target);
            localStorage.setItem('cached_transactions', JSON.stringify(resData.transactions));
            
            calculateStats();
            showToast('Cập nhật mục tiêu', `Đã lưu mục tiêu tài chính mới lên máy chủ: ${formatVND(newGoal)}`);
        } else {
            throw new Error(resData.message);
        }
    } catch (err) {
        console.warn('Backend sync failed, storing goal locally...', err);
        appData.fi_target = newGoal;
        localStorage.setItem('cached_fi_target', newGoal);
        calculateStats();
        showToast('Cập nhật mục tiêu', `Lưu tạm thời mục tiêu mới trên trình duyệt: ${formatVND(newGoal)}`, 'warning');
    }
};

// Global action to reset all app data in localStorage
window.confirmResetAllData = async function() {
    if (!confirm("CẢNH BÁO: Hành động này sẽ XÓA TOÀN BỘ giao dịch và cài đặt hiện tại trên Máy chủ & Trình duyệt. Bạn có chắc chắn muốn thực hiện không?")) {
        return;
    }
    
    try {
        const response = await fetch(`${apiBase}/api/reset`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        const resData = await response.json();
        if (resData.status === 'success') {
            localStorage.removeItem('cached_transactions');
            localStorage.removeItem('cached_fi_target');
            
            appData.transactions = [];
            appData.fi_target = 4500000000;
            
            localStorage.setItem('cached_fi_target', appData.fi_target);
            localStorage.setItem('cached_transactions', JSON.stringify([]));
            
            initApp();
            showToast('Đã xóa dữ liệu', 'Toàn bộ dữ liệu trên máy chủ đã được dọn sạch!', 'warning');
            
            setTimeout(() => {
                window.location.reload();
            }, 800);
        } else {
            throw new Error(resData.message);
        }
    } catch (err) {
        console.warn('Backend sync failed, resetting browser cache only...', err);
        localStorage.removeItem('cached_transactions');
        localStorage.removeItem('cached_fi_target');
        
        appData.transactions = [];
        appData.fi_target = 4500000000;
        
        localStorage.setItem('cached_fi_target', appData.fi_target);
        localStorage.setItem('cached_transactions', JSON.stringify([]));
        
        initApp();
        showToast('Đã xóa Offline', 'Chỉ dọn sạch bộ nhớ cục bộ của trình duyệt này!', 'warning');
        
        setTimeout(() => {
            window.location.reload();
        }, 800);
    }
};

// Global action to delete a single transaction
// Mở modal ở chế độ chỉnh sửa và đổ dữ liệu giao dịch cũ vào form
window.editTransaction = function(id) {
    const tx = appData.transactions.find(t => t.id === id);
    if (!tx) {
        showToast('Không tìm thấy', 'Giao dịch này không còn tồn tại.', 'error');
        return;
    }

    editingTxId = id;

    // Đổi tiêu đề & nút sang chế độ Sửa
    document.getElementById('modal-tx-title').innerHTML = '<i class="fa-solid fa-pen text-primary"></i> Chỉnh sửa Giao dịch';
    document.getElementById('btn-save-tx-label').innerText = 'Cập nhật giao dịch';

    // Đổ dữ liệu
    document.getElementById('tx-date').value = tx.date;
    const groupSelect = document.getElementById('tx-group');
    const catSelect = document.getElementById('tx-category');
    groupSelect.value = tx.group;

    // Populate danh mục theo nhóm (giống listener change)
    catSelect.innerHTML = '<option value="" disabled>Chọn danh mục...</option>';
    if (categoryMap[tx.group]) {
        categoryMap[tx.group].forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.innerText = cat;
            catSelect.appendChild(opt);
        });
        catSelect.disabled = false;
    }
    // Nếu danh mục cũ không nằm trong danh sách (dữ liệu cũ), thêm vào để không mất
    if (tx.category && !Array.from(catSelect.options).some(o => o.value === tx.category)) {
        const opt = document.createElement('option');
        opt.value = tx.category;
        opt.innerText = tx.category;
        catSelect.appendChild(opt);
        catSelect.disabled = false;
    }
    catSelect.value = tx.category;

    document.getElementById('tx-item').value = tx.item;
    document.getElementById('tx-amount').value = tx.amount;
    document.getElementById('amount-words').innerText = convertNumberToWords(parseInt(tx.amount) || 0);

    document.getElementById('modal-add-tx').classList.remove('hidden');
};

window.deleteTransaction = async function(id) {
    const tx = appData.transactions.find(t => t.id === id);
    if (!tx) return;
    
    if (!confirm(`Bạn có chắc chắn muốn XÓA giao dịch:\n"${tx.date} - ${tx.item}: ${formatVND(tx.amount)}"?`)) return;
    
    try {
        const response = await fetch(`${apiBase}/api/delete`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ id: id })
        });
        
        const resData = await response.json();
        if (resData.status === 'success') {
            appData.fi_target = resData.fi_target;
            appData.transactions = resData.transactions;
            
            localStorage.setItem('cached_fi_target', resData.fi_target);
            localStorage.setItem('cached_transactions', JSON.stringify(resData.transactions));
            
            initApp();
            showToast('Đã xóa', 'Giao dịch đã được xóa thành công khỏi máy chủ!');
        } else {
            throw new Error(resData.message);
        }
    } catch (err) {
        console.error('Xóa giao dịch thất bại:', err);
        // Ở chế độ Cloud Gist: KHÔNG xóa cục bộ (tránh lệch dữ liệu) — báo lỗi thật để người dùng xử lý
        if (isCloudMode()) {
            showToast('Không xóa được trên Cloud', err.message || 'Ghi lên GitHub Gist thất bại. Giao dịch CHƯA bị xóa.', 'error');
            return;
        }
        // Chế độ máy chủ local: lưu xóa tạm trên trình duyệt
        appData.transactions = appData.transactions.filter(t => t.id !== id);
        localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));

        initApp();
        showToast('Đã xóa Offline', 'Giao dịch bị xóa tạm thời trên trình duyệt này!', 'warning');
    }
};

// Export data to a JSON file (Backup)
window.exportDataJSON = function() {
    const dataStr = JSON.stringify({
        fi_target: appData.fi_target,
        transactions: appData.transactions
    }, null, 2);
    
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `zenfinance_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('Xuất file', 'Đã tải xuống tệp sao lưu dữ liệu!');
};

// Trigger hidden file picker
window.triggerImportJSON = function() {
    document.getElementById('json-file-picker').click();
};

// Import data from a JSON file (Restore)
window.importDataJSON = async function(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (!imported.transactions) {
                throw new Error("Tệp sao lưu không đúng định dạng!");
            }
            
            const fi_target = imported.fi_target || 4500000000;
            const transactions = imported.transactions;
            
            // If connected to server, sync to server
            let syncSuccess = false;
            try {
                const response = await fetch(`${apiBase}/api/sync`, {
                    method: 'POST',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({ transactions, fi_target })
                });
                const resData = await response.json();
                if (resData.status === 'success') {
                    appData.fi_target = resData.fi_target;
                    appData.transactions = resData.transactions;
                    syncSuccess = true;
                }
            } catch (err) {
                console.warn("Could not sync imported data to server, saving locally...", err);
            }
            
            if (!syncSuccess) {
                appData.fi_target = fi_target;
                appData.transactions = transactions;
            }
            
            localStorage.setItem('cached_fi_target', appData.fi_target);
            localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));
            
            initApp();
            showToast('Nhập dữ liệu', `Đã khôi phục thành công ${transactions.length} giao dịch!`);
            
            // Clear input
            event.target.value = '';
        } catch (err) {
            console.error(err);
            showToast('Lỗi', 'Không thể đọc tệp sao lưu. Vui lòng kiểm tra lại!', 'error');
            event.target.value = '';
        }
    };
    reader.readAsText(file);
};


/* ==========================================================================
   GitHub Gist Cloud Sync Integration (Phương án A)
   ========================================================================== */

// Handle cloud API requests internally when in Cloud Mode
async function handleCloudApiRequest(url, options) {
    const { token, gistId } = getCloudConfig();
    const endpoint = url.replace(apiBase, '').split('?')[0];
    
    const mockResponse = (data, status = 200) => {
        return new Response(JSON.stringify(data), {
            status: status,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    try {
        if (endpoint === '/api/data') {
            const now = Date.now();
            // Caching: tránh spam API GitHub. Nếu fetch chưa quá 10s và đã có data, trả về local cache luôn.
            if (now - lastCloudFetchTime < 10000 && appData.transactions && appData.transactions.length > 0) {
                return mockResponse({
                    fi_target: appData.fi_target,
                    transactions: appData.transactions,
                    local_ip: 'GitHub Cloud'
                });
            }
            
            const res = await originalFetch(`https://api.github.com/gists/${gistId}`, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github+json'
                }
            });
            
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    return mockResponse({ status: 'error', message: 'GitHub Token không hợp lệ hoặc đã hết hạn.' }, 401);
                }
                throw new Error(`GitHub Gist API error: ${res.statusText}`);
            }
            
            const gist = await res.json();
            const file = gist.files['database.json'];
            if (!file || !file.content) {
                throw new Error('Không tìm thấy tệp database.json trong Gist');
            }
            
            const data = JSON.parse(file.content);
            appData.fi_target = data.fi_target || 4500000000;
            appData.transactions = data.transactions || [];
            lastCloudFetchTime = now;
            
            // Cập nhật local storage cache
            localStorage.setItem('cached_fi_target', appData.fi_target);
            localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));
            
            return mockResponse({
                fi_target: appData.fi_target,
                transactions: appData.transactions,
                local_ip: 'GitHub Cloud'
            });
        }
        
        else if (endpoint === '/api/transaction') {
            const body = JSON.parse(options.body);
            // Tạo ID và các thuộc tính đồng bộ
            body.id = 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            body.sheet = 'QUẢN LÝ WEB';
            body.row = appData.transactions.length + 1;

            // Normalize partner (mirror server logic) để tab Nợ match đúng
            const isDebtRelated = body.group === 'KHOẢN NỢ' || body.group === 'ĐÒI NỢ'
                || (body.group === 'KHOẢN THU' && body.category === 'Nợ trả')
                || (body.group === 'KHOẢN CHI' && (body.category === 'Trả nợ' || body.item.toLowerCase().startsWith('trả nợ') || body.item.toLowerCase().startsWith('trả ')));
            if (isDebtRelated) {
                body.partner = normalizeName(body.item);
            }

            // Đẩy vào danh sách
            appData.transactions.push(body);
            
            await saveToGistCloud(token, gistId, {
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
            
            return mockResponse({
                status: 'success',
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
        }
        
        else if (endpoint === '/api/edit') {
            const body = JSON.parse(options.body);
            const idx = appData.transactions.findIndex(t => t.id === body.id);
            if (idx === -1) {
                return mockResponse({ status: 'error', message: 'Không tìm thấy giao dịch cần sửa.' }, 404);
            }

            // Giữ id/seq/sheet cũ, cập nhật các trường còn lại
            const existing = appData.transactions[idx];
            existing.date = body.date;
            existing.group = body.group;
            existing.category = body.category;
            existing.item = body.item;
            existing.amount = body.amount;

            // Tính lại partner cho khoản nợ (hoặc xóa nếu không còn liên quan nợ)
            const isDebtRelated = body.group === 'KHOẢN NỢ' || body.group === 'ĐÒI NỢ'
                || (body.group === 'KHOẢN THU' && body.category === 'Nợ trả')
                || (body.group === 'KHOẢN CHI' && (body.category === 'Trả nợ' || body.item.toLowerCase().startsWith('trả nợ') || body.item.toLowerCase().startsWith('trả ')));
            if (isDebtRelated) {
                existing.partner = normalizeName(body.item);
            } else {
                delete existing.partner;
            }

            await saveToGistCloud(token, gistId, {
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });

            return mockResponse({
                status: 'success',
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
        }

        else if (endpoint === '/api/goal') {
            const body = JSON.parse(options.body);
            appData.fi_target = body.fi_target;
            
            await saveToGistCloud(token, gistId, {
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
            
            return mockResponse({
                status: 'success',
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
        }
        
        else if (endpoint === '/api/delete') {
            const body = JSON.parse(options.body);
            appData.transactions = appData.transactions.filter(t => t.id !== body.id);
            
            await saveToGistCloud(token, gistId, {
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
            
            return mockResponse({
                status: 'success',
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
        }
        
        else if (endpoint === '/api/reset') {
            appData.transactions = [];
            appData.fi_target = 4500000000;
            
            await saveToGistCloud(token, gistId, {
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
            
            return mockResponse({
                status: 'success',
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
        }
        
        else if (endpoint === '/api/sync') {
            const body = JSON.parse(options.body);
            appData.fi_target = body.fi_target;
            appData.transactions = body.transactions;
            
            await saveToGistCloud(token, gistId, {
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
            
            return mockResponse({
                status: 'success',
                fi_target: appData.fi_target,
                transactions: appData.transactions
            });
        }
        
        else if (endpoint === '/api/login' || endpoint === '/api/setup-auth') {
            return mockResponse({
                status: 'success',
                token: 'mock-cloud-token-' + Date.now()
            });
        }
        
        return mockResponse({ status: 'error', message: 'Endpoint không hỗ trợ trong chế độ Cloud.' }, 404);
        
    } catch (err) {
        console.error("Lỗi xử lý Cloud API:", err);
        return mockResponse({ status: 'error', message: err.message }, 500);
    }
}

// Ghi đè file database.json trên Gist
async function saveToGistCloud(token, gistId, payload) {
    const res = await originalFetch(`https://api.github.com/gists/${gistId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            description: "ZenFinance Cloud Database",
            files: {
                "database.json": {
                    "content": JSON.stringify(payload, null, 2)
                }
            }
        })
    });
    if (!res.ok) {
        let detail = res.statusText;
        if (res.status === 403 || res.status === 404) {
            detail = `Token GitHub không có quyền GHI vào Gist (HTTP ${res.status}). Hãy tạo lại token với quyền Gist = Read and write.`;
        } else if (res.status === 401) {
            detail = `Token GitHub đã hết hạn hoặc không hợp lệ (HTTP ${res.status}).`;
        } else {
            detail = `Cập nhật Gist thất bại (HTTP ${res.status}): ${res.statusText}`;
        }
        throw new Error(detail);
    }
    // Đồng bộ tức thì với local storage
    localStorage.setItem('cached_fi_target', payload.fi_target);
    localStorage.setItem('cached_transactions', JSON.stringify(payload.transactions));
}

// Khởi tạo một Gist mới tinh trên GitHub
async function createNewGistCloud(token, payload) {
    const res = await originalFetch(`https://api.github.com/gists`, {
        method: 'POST',
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            description: "ZenFinance Cloud Database (Secret)",
            public: false,
            files: {
                "database.json": {
                    "content": JSON.stringify(payload, null, 2)
                }
            }
        })
    });
    if (!res.ok) {
        throw new Error(`Tạo Gist mới thất bại: ${res.statusText}`);
    }
    const gist = await res.json();
    return gist.id;
}

// Cloud Setup UI & Events
document.addEventListener('DOMContentLoaded', () => {
    // Buttons và Modal elements
    const btnCloudConfig = document.getElementById('btn-cloud-config');
    const modalCloudConfig = document.getElementById('modal-cloud-config');
    const btnCloseCloudModal = document.getElementById('btn-close-cloud-modal');
    const btnCancelCloudModal = document.getElementById('btn-cancel-cloud-modal');
    const formCloudConfig = document.getElementById('form-cloud-config');
    const inputGithubToken = document.getElementById('cloud-github-token');
    const inputGistId = document.getElementById('cloud-gist-id');
    
    const btnCreateGist = document.getElementById('btn-create-gist');
    const createGistSpinner = document.getElementById('create-gist-spinner');
    const btnDisconnectCloud = document.getElementById('btn-disconnect-cloud');
    
    const cloudSyncActions = document.getElementById('cloud-sync-actions');
    const btnPushCloud = document.getElementById('btn-push-cloud');
    const btnPullCloud = document.getElementById('btn-pull-cloud');
    const pushCloudSpinner = document.getElementById('push-cloud-spinner');
    const pullCloudSpinner = document.getElementById('pull-cloud-spinner');
    const pushCloudIcon = document.getElementById('push-cloud-icon');
    const pullCloudIcon = document.getElementById('pull-cloud-icon');
    const btnCopyLoginLink = document.getElementById('btn-copy-login-link');

    // Mở modal cấu hình khi click nút ở Sidebar
    if (btnCloudConfig) {
        btnCloudConfig.addEventListener('click', openCloudModal);
    }

    // Cho phép mở modal khi click trực tiếp vào connection badge (ở Sidebar hoặc Header)
    document.querySelectorAll('.connection-badge').forEach(badge => {
        badge.style.cursor = 'pointer';
        badge.addEventListener('click', openCloudModal);
    });

    function openCloudModal() {
        // Điền dữ liệu cấu hình cũ nếu có
        inputGithubToken.value = localStorage.getItem('github_token') || '';
        inputGistId.value = localStorage.getItem('github_gist_id') || '';
        
        if (isCloudMode()) {
            cloudSyncActions.classList.remove('hidden');
            btnDisconnectCloud.classList.remove('hidden');
        } else {
            cloudSyncActions.classList.add('hidden');
            btnDisconnectCloud.classList.add('hidden');
        }
        
        modalCloudConfig.classList.remove('hidden');
    }

    // Đóng Modal
    const closeCloudModal = () => {
        modalCloudConfig.classList.add('hidden');
    };
    
    if (btnCloseCloudModal) btnCloseCloudModal.addEventListener('click', closeCloudModal);
    if (btnCancelCloudModal) btnCancelCloudModal.addEventListener('click', closeCloudModal);

    // Xử lý tạo Gist mới tự động
    if (btnCreateGist) {
        btnCreateGist.addEventListener('click', async () => {
            const token = inputGithubToken.value.trim();
            if (!token) {
                showToast('Lỗi cấu hình', 'Vui lòng nhập GitHub Personal Access Token trước!', 'error');
                return;
            }
            
            btnCreateGist.disabled = true;
            createGistSpinner.classList.remove('hidden');
            
            try {
                // Sử dụng dữ liệu hiện có trong app hoặc tạo dữ liệu trống
                const payload = {
                    fi_target: appData.fi_target || 4500000000,
                    transactions: appData.transactions || []
                };
                
                const newGistId = await createNewGistCloud(token, payload);
                inputGistId.value = newGistId;
                showToast('Thành công', 'Đã tạo tệp Gist riêng tư mới trên GitHub của bạn!');
            } catch (err) {
                console.error(err);
                showToast('Lỗi tạo Gist', `Không thể tạo Gist: ${err.message}`, 'error');
            } finally {
                btnCreateGist.disabled = false;
                createGistSpinner.classList.add('hidden');
            }
        });
    }

    // Xử lý ngắt kết nối Cloud Gist
    if (btnDisconnectCloud) {
        btnDisconnectCloud.addEventListener('click', () => {
            if (confirm("Bạn có chắc chắn muốn ngắt kết nối Cloud Gist? Ứng dụng sẽ quay lại đồng bộ với máy chủ Local.")) {
                localStorage.removeItem('github_token');
                localStorage.removeItem('github_gist_id');
                showToast('Đã ngắt kết nối', 'Ứng dụng đã chuyển về chế độ Local Server.', 'warning');
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        });
    }

    // Xử lý Lưu cấu hình
    if (formCloudConfig) {
        formCloudConfig.addEventListener('submit', async (e) => {
            e.preventDefault();
            const token = inputGithubToken.value.trim();
            const gistId = inputGistId.value.trim();
            
            if (!token || !gistId) {
                showToast('Thiếu thông tin', 'Vui lòng nhập đầy đủ Token và Gist ID.', 'error');
                return;
            }

            const saveBtn = document.getElementById('btn-save-cloud');
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" style="margin-right: 6px;"></i>Đang kết nối...';

            try {
                // Xác minh kết nối bằng cách fetch thử Gist
                const res = await originalFetch(`https://api.github.com/gists/${gistId}`, {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github+json'
                    }
                });
                
                if (!res.ok) throw new Error(`Không thể kết nối Gist: ${res.statusText}`);
                
                const gist = await res.json();
                const file = gist.files['database.json'];
                if (!file) throw new Error('Gist không chứa file database.json');

                // Lưu vào local storage
                localStorage.setItem('github_token', token);
                localStorage.setItem('github_gist_id', gistId);
                
                showToast('Cấu hình thành công', 'ZenFinance đã kết nối với GitHub Cloud Database!');
                closeCloudModal();
                
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
                
            } catch (err) {
                console.error(err);
                showToast('Lỗi kết nối', `Xác minh thất bại: ${err.message}`, 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = 'Lưu cấu hình';
            }
        });
    }

    // Đẩy dữ liệu Local lên Cloud
    if (btnPushCloud) {
        btnPushCloud.addEventListener('click', async () => {
            if (!confirm("Hành động này sẽ tải toàn bộ dữ liệu hiện tại của trình duyệt này đè lên Cloud Gist. Bạn có muốn tiếp tục không?")) {
                return;
            }
            
            btnPushCloud.disabled = true;
            pushCloudSpinner.classList.remove('hidden');
            pushCloudIcon.classList.add('hidden');
            
            try {
                const { token, gistId } = getCloudConfig();
                const payload = {
                    fi_target: appData.fi_target,
                    transactions: appData.transactions
                };
                await saveToGistCloud(token, gistId, payload);
                showToast('Đồng bộ', 'Đã tải dữ liệu thành công lên Cloud!');
            } catch (err) {
                console.error(err);
                showToast('Lỗi đồng bộ', `Không thể đẩy dữ liệu lên: ${err.message}`, 'error');
            } finally {
                btnPushCloud.disabled = false;
                pushCloudSpinner.classList.add('hidden');
                pushCloudIcon.classList.remove('hidden');
            }
        });
    }

    // Tải dữ liệu từ Cloud về Local
    if (btnPullCloud) {
        btnPullCloud.addEventListener('click', async () => {
            if (!confirm("Hành động này sẽ tải toàn bộ dữ liệu từ Cloud Gist đè lên bộ nhớ trình duyệt hiện tại. Bạn có muốn tiếp tục không?")) {
                return;
            }
            
            btnPullCloud.disabled = true;
            pullCloudSpinner.classList.remove('hidden');
            pullCloudIcon.classList.add('hidden');
            
            try {
                const { token, gistId } = getCloudConfig();
                const res = await originalFetch(`https://api.github.com/gists/${gistId}`, {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github+json'
                    }
                });
                
                if (!res.ok) throw new Error(`GitHub error: ${res.statusText}`);
                
                const gist = await res.json();
                const file = gist.files['database.json'];
                if (!file || !file.content) throw new Error('Không có file database.json trên Gist');
                
                const data = JSON.parse(file.content);
                appData.fi_target = data.fi_target || 4500000000;
                appData.transactions = data.transactions || [];
                
                localStorage.setItem('cached_fi_target', appData.fi_target);
                localStorage.setItem('cached_transactions', JSON.stringify(appData.transactions));
                
                showToast('Đồng bộ', 'Đã tải dữ liệu Cloud về trình duyệt thành công!');
                closeCloudModal();
                
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            } catch (err) {
                console.error(err);
                showToast('Lỗi đồng bộ', `Không thể tải dữ liệu xuống: ${err.message}`, 'error');
            } finally {
                btnPullCloud.disabled = false;
                pullCloudSpinner.classList.add('hidden');
                pullCloudIcon.classList.remove('hidden');
            }
        });
    }

    // Tạo link đăng nhập nhanh (chứa token + gist_id) để mở trên thiết bị/tab khác
    if (btnCopyLoginLink) {
        btnCopyLoginLink.addEventListener('click', async () => {
            const { token, gistId } = getCloudConfig();
            if (!token || !gistId) {
                showToast('Chưa kết nối', 'Bạn cần kết nối Cloud Gist trước khi tạo link.', 'error');
                return;
            }

            const baseUrl = window.location.origin + window.location.pathname;
            const link = `${baseUrl}?token=${encodeURIComponent(token)}&gist_id=${encodeURIComponent(gistId)}`;

            try {
                await navigator.clipboard.writeText(link);
                showToast('Đã copy link', 'Link đăng nhập nhanh đã được sao chép. Chỉ dán trên thiết bị cá nhân của bạn!');
            } catch (err) {
                // Trình duyệt chặn clipboard (vd: không phải HTTPS) → hiện link để copy tay
                console.warn('Clipboard bị chặn, hiển thị link để copy thủ công:', err);
                prompt('Sao chép link đăng nhập nhanh (KHÔNG chia sẻ công khai):', link);
            }
        });
    }
});

