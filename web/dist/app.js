// State
let token = localStorage.getItem('token');
let currentPage = 'status';

// API Helper
async function api(method, endpoint, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`/api/admin${endpoint}`, options);
    if (res.status === 401) {
        logout();
        throw new Error('Unauthorized');
    }
    return res.json();
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    if (token) {
        showDashboard();
    }

    // Connect to SSE for download progress
    connectProgressStream();
});

// Download Progress SSE
let progressSource = null;

function connectProgressStream() {
    if (progressSource) {
        progressSource.close();
    }

    progressSource = new EventSource('/api/admin/progress');

    progressSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        updateDownloadProgress(data);
    };

    progressSource.onerror = () => {
        // Reconnect after 3 seconds
        setTimeout(connectProgressStream, 3000);
    };
}

function updateDownloadProgress(data) {
    const section = document.getElementById('downloadSection');
    const titleEl = document.getElementById('downloadTitle');
    const progressEl = document.getElementById('downloadProgress');
    const percentEl = document.getElementById('downloadPercent');

    if (data.status === 'downloading') {
        section.style.display = 'block';
        titleEl.textContent = data.title || 'Downloading...';
        progressEl.style.width = data.percent + '%';
        percentEl.textContent = Math.round(data.percent) + '%';
    } else if (data.status === 'complete') {
        section.style.display = 'block';
        titleEl.textContent = data.title + ' ✓';
        progressEl.style.width = '100%';
        percentEl.textContent = '100%';
    } else {
        section.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {    // Login form
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const data = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            }).then(r => r.json());

            if (data.token) {
                token = data.token;
                localStorage.setItem('token', token);
                showDashboard();
            } else {
                document.getElementById('loginError').textContent = data.error || 'Login failed';
            }
        } catch (err) {
            document.getElementById('loginError').textContent = 'Login failed';
        }
    });

    // Nav clicks
    document.querySelectorAll('.sidebar li').forEach(li => {
        li.addEventListener('click', () => {
            document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active'));
            li.classList.add('active');
            showPage(li.dataset.page);
        });
    });

    // Add item form
    document.getElementById('addItemForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const key = document.getElementById('itemKey').value;
        const title = document.getElementById('itemTitle').value;
        const type = document.getElementById('itemType').value;
        const sourceValue = document.getElementById('itemSource').value;

        const source = type === 'youtube_url'
            ? { type, url: sourceValue }
            : { type, path: sourceValue };

        try {
            await api('POST', '/allowed', { key, title, source });
            closeModal();
            loadCatalog();
        } catch (err) {
            alert('Failed to add item');
        }
    });
});

function showDashboard() {
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    showPage('status');
}

function logout() {
    token = null;
    localStorage.removeItem('token');
    document.getElementById('loginContainer').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
}

function showPage(page) {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById(`${page}Page`).style.display = 'block';

    switch (page) {
        case 'status': loadStatus(); break;
        case 'queue': loadQueue(); break;
        case 'catalog': loadCatalog(); break;
        case 'cache': loadCache(); break;
        case 'logs': loadLogs(); break;
    }
}

// Status
async function loadStatus() {
    try {
        const data = await api('GET', '/status');
        document.getElementById('botStatus').textContent = data.botConnected ? '🟢 Connected' : '🔴 Disconnected';
        document.getElementById('queueLength').textContent = data.queueLength || 0;
        document.getElementById('coreStatus').textContent = data.coreReachable ? '🟢 Reachable' : '🔴 Unreachable';
        document.getElementById('currentPlaying').textContent = data.currentPlaying?.title || 'Nothing playing';
    } catch (err) {
        console.error('Failed to load status', err);
    }
}

// Queue
async function loadQueue() {
    try {
        const data = await api('GET', '/queue');

        // Current track
        const current = data.current;
        document.getElementById('currentTrackInfo').innerHTML = current
            ? `<strong>Now Playing:</strong> ${current.title} <em>(by @${current.requestedBy})</em>`
            : '<em>Nothing playing</em>';

        // Queue table
        const tbody = document.getElementById('queueBody');
        tbody.innerHTML = data.queue.map((item, i) => `
            <tr>
                <td>${i + 1}</td>
                <td>${item.title}</td>
                <td>${item.key}</td>
                <td>@${item.requestedBy}</td>
                <td><button onclick="removeFromQueue(${i})" class="danger">Remove</button></td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load queue', err);
    }
}

async function skipTrack() {
    await api('POST', '/queue/skip');
    loadQueue();
    loadStatus();
}

async function clearQueue() {
    if (confirm('Clear entire queue?')) {
        await api('DELETE', '/queue');
        loadQueue();
        loadStatus();
    }
}

async function removeFromQueue(index) {
    await api('DELETE', `/queue/${index}`);
    loadQueue();
}

// Catalog
async function loadCatalog() {
    try {
        const data = await api('GET', '/allowed');
        const tbody = document.getElementById('catalogBody');
        tbody.innerHTML = data.map(item => `
            <tr>
                <td>${item.key}</td>
                <td>${item.title}</td>
                <td>${item.source.type}</td>
                <td>${item.source.url || item.source.path || '-'}</td>
                <td>
                    <button onclick="enqueueItem('${item.key}')">▶️ Play</button>
                    <button onclick="deleteCatalogItem('${item.key}')" class="danger">🗑️</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load catalog', err);
    }
}

function showAddItem() {
    document.getElementById('addItemModal').classList.add('show');
}

function closeModal() {
    document.getElementById('addItemModal').classList.remove('show');
    document.getElementById('addItemForm').reset();
}

async function enqueueItem(key) {
    await api('POST', '/queue', { key });
    loadQueue();
    loadStatus();
}

async function deleteCatalogItem(key) {
    if (confirm(`Delete "${key}" from catalog?`)) {
        await api('DELETE', `/allowed/${key}`);
        loadCatalog();
    }
}

// Cache
async function loadCache() {
    try {
        const data = await api('GET', '/cache');
        const tbody = document.getElementById('cacheBody');
        tbody.innerHTML = data.map(file => `
            <tr>
                <td>${file.name}</td>
                <td>${formatSize(file.size)}</td>
                <td>${new Date(file.modified).toLocaleString()}</td>
                <td><button onclick="deleteCacheFile('${file.name}')" class="danger">🗑️</button></td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load cache', err);
    }
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function deleteCacheFile(filename) {
    await api('DELETE', `/cache/${filename}`);
    loadCache();
}

async function clearCache() {
    if (confirm('Clear all cached files?')) {
        await api('DELETE', '/cache');
        loadCache();
    }
}

// Logs
async function loadLogs() {
    try {
        const data = await api('GET', '/twitch/logs');
        const tbody = document.getElementById('logsBody');
        tbody.innerHTML = data.reverse().map(log => `
            <tr>
                <td>${new Date(log.timestamp).toLocaleTimeString()}</td>
                <td>@${log.user}</td>
                <td>${log.command}</td>
                <td>${log.args}</td>
                <td>${log.action}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Failed to load logs', err);
    }
}

function refreshLogs() {
    loadLogs();
}

// Core
async function coreStart() {
    await api('POST', '/core/start');
    alert('Process started');
}

async function coreStop() {
    await api('POST', '/core/stop');
    alert('Process stopped');
}

async function coreRestart() {
    await api('POST', '/core/restart');
    alert('Process restarted');
}

// Auto-refresh status every 5 seconds
setInterval(() => {
    if (currentPage === 'status') loadStatus();
}, 5000);
