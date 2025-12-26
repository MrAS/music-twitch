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
    // Connect to SSE for all insights
    connectInsightsStream();
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

// Insights SSE (all real-time events)
let insightsSource = null;

function connectInsightsStream() {
    if (insightsSource) {
        insightsSource.close();
    }

    insightsSource = new EventSource('/api/admin/insights');

    insightsSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleInsight(data);
    };

    insightsSource.onerror = () => {
        setTimeout(connectInsightsStream, 3000);
    };
}

function handleInsight(data) {
    // Update stream status if it's a stream event
    if (data.type === 'stream') {
        updateStreamStatus(data);
    }

    // Add to activity feed
    addInsightEntry(data);
}

function updateStreamStatus(data) {
    const indicator = document.getElementById('streamIndicator');
    if (!indicator) return;

    // Update the new UI live progress elements
    if (data.status === 'streaming' && data.time) {
        const streamTimeEl = document.getElementById('streamTime');
        const streamBitrateEl = document.getElementById('streamBitrate');
        const streamSpeedEl = document.getElementById('streamSpeed');
        if (streamTimeEl) streamTimeEl.textContent = data.time;
        if (streamBitrateEl) streamBitrateEl.textContent = data.bitrate || '0 kbps';
        if (streamSpeedEl) streamSpeedEl.textContent = data.speed || '0x';

        // Update indicator to show streaming
        indicator.textContent = '● LIVE';
        indicator.classList.remove('offline');
    } else if (data.status === 'stopped') {
        // Reset live progress
        const st = document.getElementById('streamTime');
        const sb = document.getElementById('streamBitrate');
        const ss = document.getElementById('streamSpeed');
        if (st) st.textContent = '00:00:00';
        if (sb) sb.textContent = '--';
        if (ss) ss.textContent = '--';

        indicator.textContent = '● OFFLINE';
        indicator.classList.add('offline');
    }
}

// Skip current track
async function skipTrack() {
    try {
        await api('POST', '/queue/skip');
        loadStatus();
    } catch (err) {
        alert('Failed to skip: ' + (err.message || 'Unknown error'));
    }
}

// Toggle YouTube suggestions mode
let suggestionsEnabled = false;

async function toggleSuggestions() {
    const btn = document.getElementById('suggestionsBtn');
    const status = document.getElementById('suggestionsStatus');

    try {
        if (suggestionsEnabled) {
            await api('POST', '/suggestions/disable');
            suggestionsEnabled = false;
            btn.textContent = '🔄 Enable Suggestions';
            btn.classList.remove('success');
            status.textContent = 'Disabled';
            status.style.color = '#95a5a6';
        } else {
            await api('POST', '/suggestions/enable');
            suggestionsEnabled = true;
            btn.textContent = '🔄 Disable Suggestions';
            btn.classList.add('success');
            status.textContent = 'Auto-playing related videos';
            status.style.color = '#2ecc71';
        }
    } catch (err) {
        status.textContent = 'Error: ' + (err.message || 'Failed');
        status.style.color = '#e74c3c';
    }
}

// Load suggestions status
async function loadSuggestionsStatus() {
    try {
        const data = await api('GET', '/suggestions');
        suggestionsEnabled = data.enabled;
        const btn = document.getElementById('suggestionsBtn');
        const status = document.getElementById('suggestionsStatus');
        if (btn && status) {
            if (suggestionsEnabled) {
                btn.textContent = '🔄 Disable Suggestions';
                btn.classList.add('success');
                status.textContent = 'Auto-playing related videos';
                status.style.color = '#2ecc71';
            } else {
                btn.textContent = '🔄 Enable Suggestions';
                btn.classList.remove('success');
                status.textContent = '';
            }
        }
    } catch (err) {
        console.error('Failed to load suggestions status', err);
    }
}

function addInsightEntry(data) {
    const feed = document.getElementById('insightsFeed');
    if (!feed) return;

    // Remove placeholder if present
    const placeholder = feed.querySelector('.insight-placeholder');
    if (placeholder) placeholder.remove();

    // Limit to 50 entries
    while (feed.children.length >= 50) {
        feed.removeChild(feed.firstChild);
    }

    // Get icon based on type
    const icons = {
        download: '⬇️',
        stream: '📡',
        queue: '🎵',
        system: 'ℹ️',
        error: '❌'
    };

    // Create entry
    const entry = document.createElement('div');
    entry.className = `insight-entry ${data.type}`;

    const time = new Date(data.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    entry.innerHTML = `
        <span class="time">${time}</span>
        <span class="icon">${icons[data.type] || '•'}</span>
        <span class="message">${escapeHtml(data.message)}</span>
    `;

    feed.appendChild(entry);

    // Auto-scroll to bottom
    feed.scrollTop = feed.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
        const queueLengthEl = document.getElementById('queueLength');
        if (queueLengthEl) queueLengthEl.textContent = data.queueLength || 0;
        const coreStatusEl = document.getElementById('coreStatus');
        if (coreStatusEl) coreStatusEl.textContent = data.coreReachable ? '🟢 Reachable' : '🔴 Unreachable';
        document.getElementById('currentPlaying').textContent = data.currentPlaying?.title || 'Nothing playing';

        // Load quality, cover, queue, and suggestions settings
        loadQuality();
        loadCover();
        loadQueueList();
        loadSuggestionsStatus();
    } catch (err) {
        console.error('Failed to load status', err);
    }
}

// Quality Settings
async function loadQuality() {
    try {
        const data = await api('GET', '/quality');
        const select = document.getElementById('qualitySelect');
        const infoEl = document.getElementById('qualityInfo');

        if (select && data.current) {
            select.value = data.current;
        }

        if (infoEl && data.presets && data.presets[data.current]) {
            const preset = data.presets[data.current];
            infoEl.textContent = `${preset.resolution} @ ${preset.videoBitrate}`;
        }
    } catch (err) {
        console.error('Failed to load quality settings', err);
    }
}

async function changeQuality(quality) {
    try {
        const data = await api('POST', '/quality', { quality });
        if (data.success) {
            loadQuality();
        }
    } catch (err) {
        alert('Failed to change quality');
    }
}

// Cover Image Settings
async function loadCover() {
    try {
        const data = await api('GET', '/cover');
        const input = document.getElementById('coverImagePath');
        const infoEl = document.getElementById('coverInfo');

        if (input && data.coverImage) {
            input.value = data.coverImage;
        }

        if (infoEl) {
            infoEl.textContent = data.coverImage
                ? `Current: ${data.coverImage}`
                : 'Using black background';
        }
    } catch (err) {
        console.error('Failed to load cover settings', err);
    }
}

async function setCoverImage() {
    const input = document.getElementById('coverImagePath');
    const coverImage = input.value.trim();

    try {
        const data = await api('POST', '/cover', { coverImage });
        if (data.success) {
            loadCover();
            alert('Cover image set! Will apply on next song.');
        }
    } catch (err) {
        alert('Failed to set cover image: ' + (err.message || 'File not found'));
    }
}

async function clearCoverImage() {
    try {
        await api('POST', '/cover', { coverImage: '' });
        document.getElementById('coverImagePath').value = '';
        loadCover();
        alert('Cover image cleared. Using black background.');
    } catch (err) {
        alert('Failed to clear cover image');
    }
}

// Play YouTube URL
async function playUrl() {
    const input = document.getElementById('playUrlInput');
    const statusEl = document.getElementById('playUrlStatus');
    const url = input.value.trim();

    if (!url) {
        alert('Please enter a YouTube URL or search term');
        return;
    }

    statusEl.textContent = 'Loading...';
    statusEl.style.color = '#f39c12';

    try {
        const data = await api('POST', '/play/url', { url });
        if (data.success) {
            statusEl.textContent = `✓ Added: ${data.title}`;
            statusEl.style.color = '#27ae60';
            input.value = '';
            // Refresh status to update queue count
            loadStatus();
        }
    } catch (err) {
        statusEl.textContent = `✗ ${err.message || 'Failed to play'}`;
        statusEl.style.color = '#e74c3c';
    }
}

// AI Playlist Generator
let generatedPlaylist = null;

async function generatePlaylist() {
    const description = document.getElementById('playlistDescription').value;
    const count = document.getElementById('playlistCount').value;

    if (!description) {
        alert('Please enter a mood description');
        return;
    }

    const resultDiv = document.getElementById('playlistResult');
    const loadingDiv = document.getElementById('playlistLoading');

    resultDiv.style.display = 'none';
    loadingDiv.style.display = 'block';

    try {
        const data = await api('POST', '/playlist/generate', {
            description,
            count: parseInt(count),
            mode: 'shuffle'
        });

        generatedPlaylist = data;

        document.getElementById('playlistName').textContent = '🎵 ' + data.name;
        const songsList = document.getElementById('playlistSongs');
        songsList.innerHTML = data.songs.map((song, i) =>
            `<li>${i + 1}. ${song.artist ? song.artist + ' - ' : ''}${song.title}</li>`
        ).join('');

        loadingDiv.style.display = 'none';
        resultDiv.style.display = 'block';

    } catch (err) {
        loadingDiv.style.display = 'none';
        alert('Failed to generate playlist: ' + (err.message || 'Unknown error'));
    }
}

async function queuePlaylist() {
    if (!generatedPlaylist || !generatedPlaylist.songs) {
        alert('No playlist to queue');
        return;
    }

    try {
        const data = await api('POST', '/playlist/queue', {
            songs: generatedPlaylist.songs
        });
        alert(`Queued ${data.queued} songs! Check the Queue page.`);
    } catch (err) {
        alert('Failed to queue playlist');
    }
}

async function toggleAutoPlaylist() {
    const checkbox = document.getElementById('autoPlaylistToggle');
    const description = document.getElementById('playlistDescription').value;

    if (checkbox.checked) {
        if (!description) {
            checkbox.checked = false;
            alert('Please enter a mood description first');
            return;
        }

        try {
            await api('POST', '/autoplaylist/enable', { description, songsPerBatch: 3 });
            showAutoPlaylistStatus(description);
        } catch (err) {
            checkbox.checked = false;
            alert('Failed to enable non-stop mode');
        }
    } else {
        await disableAutoPlaylist();
    }
}

async function disableAutoPlaylist() {
    try {
        await api('POST', '/autoplaylist/disable');
        document.getElementById('autoPlaylistToggle').checked = false;
        document.getElementById('autoPlaylistStatus').style.display = 'none';
    } catch (err) {
        alert('Failed to disable non-stop mode');
    }
}

function showAutoPlaylistStatus(description) {
    document.getElementById('autoPlaylistDesc').textContent = description;
    document.getElementById('autoPlaylistStatus').style.display = 'block';
}

async function loadAutoPlaylistStatus() {
    try {
        const data = await api('GET', '/autoplaylist');
        if (data.enabled) {
            document.getElementById('autoPlaylistToggle').checked = true;
            showAutoPlaylistStatus(data.description);
        }
    } catch (err) { }
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
                <td>
                    <button onclick="playCacheFile('${file.name}')">▶️</button>
                    <button onclick="deleteCacheFile('${file.name}')" class="danger">🗑️</button>
                </td>
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

async function playCacheFile(filename) {
    try {
        const result = await api('POST', `/cache/${encodeURIComponent(filename)}/play`);
        alert(`Playing: ${result.title}`);
        loadQueue();
        loadStatus();
    } catch (err) {
        alert('Failed to play file');
    }
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

// Update functions
async function gitPull() {
    const output = document.getElementById('updateOutput');
    output.textContent = 'Running git pull...';
    try {
        const data = await api('POST', '/update/pull');
        output.textContent = data.output || 'Done!';
    } catch (err) {
        output.textContent = 'Error: ' + (err.message || 'Failed');
        output.style.color = '#e74c3c';
    }
}

async function npmBuild() {
    const output = document.getElementById('updateOutput');
    output.textContent = 'Running npm build (this may take a moment)...';
    try {
        const data = await api('POST', '/update/build');
        output.textContent = data.output || 'Done!';
    } catch (err) {
        output.textContent = 'Error: ' + (err.message || 'Failed');
        output.style.color = '#e74c3c';
    }
}

async function fullUpdate() {
    if (!confirm('This will update from Git, rebuild, and restart the bot. Continue?')) return;

    const output = document.getElementById('updateOutput');
    output.textContent = 'Running full update (git pull + npm build + restart)...';
    output.style.color = '#2ecc71';

    try {
        const data = await api('POST', '/update/full');
        output.textContent = data.output + '\n\n' + (data.restart || '');
        alert('Update complete! The page will refresh in 5 seconds...');
        setTimeout(() => location.reload(), 5000);
    } catch (err) {
        output.textContent = 'Error: ' + (err.message || 'Failed');
        output.style.color = '#e74c3c';
    }
}

// ===== NEW: YouTube Search =====
let searchResults = [];

async function searchYouTube() {
    const input = document.getElementById('youtubeSearchInput');
    const resultsDiv = document.getElementById('searchResults');
    const query = input.value.trim();

    if (!query) {
        resultsDiv.innerHTML = '<div class="search-placeholder">Enter a search term</div>';
        return;
    }

    resultsDiv.innerHTML = '<div class="search-placeholder">Searching...</div>';

    try {
        const data = await api('POST', '/youtube/search', { query, limit: 10 });
        searchResults = data.results || [];

        if (searchResults.length === 0) {
            resultsDiv.innerHTML = '<div class="search-placeholder">No results found</div>';
            return;
        }

        resultsDiv.innerHTML = searchResults.map((r, i) => `
            <div class="search-item" onclick="playSearchResult(${i})">
                <span class="search-item-title">${r.title}</span>
                ${r.cached ? '<span class="search-item-cached">✓ cached</span>' : ''}
                <button onclick="event.stopPropagation(); playSearchResult(${i})">▶ Play</button>
            </div>
        `).join('');
    } catch (err) {
        resultsDiv.innerHTML = '<div class="search-placeholder">Search failed</div>';
    }
}

async function playSearchResult(index) {
    const result = searchResults[index];
    if (!result) return;

    try {
        const data = await api('POST', '/youtube/play', { videoId: result.id, url: result.url, title: result.title });
        if (data.success) {
            loadQueueList();
            loadStatus();
        }
    } catch (err) {
        alert('Failed to play: ' + (err.message || 'Error'));
    }
}

// ===== NEW: Queue List =====
async function loadQueueList() {
    const listEl = document.getElementById('queueList');
    const countEl = document.getElementById('queueCount');
    if (!listEl) return;

    try {
        const data = await api('GET', '/queue');
        const queue = data.queue || [];

        countEl.textContent = `${queue.length} song${queue.length !== 1 ? 's' : ''}`;

        if (queue.length === 0) {
            listEl.innerHTML = '<div class="queue-empty">Queue is empty</div>';
            return;
        }

        listEl.innerHTML = queue.map((item, i) => `
            <div class="queue-item">
                <span class="queue-item-num">${i + 1}</span>
                <span class="queue-item-title">${item.title}</span>
                <button onclick="removeFromQueue(${i})" title="Remove">✕</button>
            </div>
        `).join('');
    } catch (err) {
        listEl.innerHTML = '<div class="queue-empty">Failed to load queue</div>';
    }
}

async function removeFromQueue(index) {
    try {
        await api('POST', '/queue/remove', { index });
        loadQueueList();
    } catch (err) {
        alert('Failed to remove item');
    }
}

// Auto-refresh status and queue every 5 seconds
setInterval(() => {
    if (currentPage === 'status') {
        loadStatus();
        loadQueueList();
    }
}, 5000);

