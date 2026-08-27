const socket = io();

let currentUser = JSON.parse(localStorage.getItem('nonvitcha_user')) || null;
let allMembers = [];
let activeChatTargetId = null;
let typingTimeout = null;

document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
    setupSocketListeners();
});

function initApp() {
    renderNavigation();
    updateCoinsDisplay();
    if (currentUser) {
        socket.emit('user_connected', currentUser.id || currentUser._id);
        loadMembers();
        showSection('members-section');
    } else {
        showSection('auth-section');
    }
}

function showSection(sectionId) {
    document.querySelectorAll('.page-section').forEach(sec => sec.style.display = 'none');
    const target = document.getElementById(sectionId);
    if (target) target.style.display = 'block';

    if (sectionId === 'members-section') loadMembers();
}

function renderNavigation() {
    const headerEl = document.querySelector('header');
    if (!headerEl) return;

    const userName = currentUser ? (currentUser.nom || currentUser.username || 'Membre') : '';
    const userRole = currentUser ? (currentUser.isVip ? '👑 VIP' : 'Membre') : '';
    
    // Photo de l'utilisateur dans l'angle supérieur droit
    let userCornerHTML = '';
    if (currentUser) {
        const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=e11d48&color=fff&size=150`;
        const userPhoto = (currentUser.photo && currentUser.photo.trim() !== '') ? currentUser.photo : defaultAvatar;
        
        userCornerHTML = `
            <div class="header-user-corner">
                <img src="${userPhoto}" alt="${userName}" onerror="this.onerror=null; this.src='${defaultAvatar}';">
                <div class="header-user-info">
                    <span class="header-user-name">${userName}</span>
                    <span class="header-user-role">${userRole}</span>
                </div>
            </div>
        `;
    }

    // Header avec "Nonvitcha" bien grand en haut et la photo dans l'angle
    headerEl.innerHTML = `
        <div class="header-top">
            <h1><i class="fa-solid fa-heart-pulse"></i> Nonvitcha</h1>
            ${userCornerHTML}
        </div>
        <div id="nav-menu"></div>
    `;

    const nav = document.getElementById('nav-menu');
    if (!nav) return;

    if (!currentUser) {
        nav.innerHTML = `
            <button class="nav-btn nav-btn-members" onclick="showSection('auth-section')"><i class="fa-solid fa-right-to-bracket"></i> Connexion / Inscription</button>
            <button class="nav-btn nav-btn-ecoute" onclick="showSection('ecoutes-section')"><i class="fa-solid fa-hand-holding-heart"></i> Écoute SOS / SSR</button>
            <button class="nav-btn nav-btn-admin" onclick="showSection('admin-section')"><i class="fa-solid fa-shield-halved"></i> Admin</button>
        `;
    } else {
        nav.innerHTML = `
            <button class="nav-btn nav-btn-members" onclick="showSection('members-section')"><i class="fa-solid fa-users"></i> Membres</button>
            <button class="nav-btn nav-btn-public" onclick="showSection('public-chat-section')"><i class="fa-solid fa-comments"></i> Chat Public</button>
            <button class="nav-btn nav-btn-coins" onclick="showSection('recharge-section')"><i class="fa-solid fa-coins"></i> <span id="current-coins-display">${currentUser.coins || 0}</span> Coins</button>
            <button class="nav-btn nav-btn-ecoute" onclick="showSection('ecoutes-section')"><i class="fa-solid fa-hand-holding-heart"></i> Écoute SOS</button>
            <button class="nav-btn nav-btn-admin" onclick="showSection('admin-section')"><i class="fa-solid fa-shield-halved"></i> Admin</button>
            <button class="nav-btn nav-btn-logout" onclick="logout()"><i class="fa-solid fa-power-off"></i> Déconnexion</button>
        `;
    }
}

function updateCoinsDisplay() {
    const coinsEl = document.getElementById('current-coins-display');
    if (coinsEl && currentUser) {
        coinsEl.innerText = currentUser.coins || 0;
    }
}

function setupEventListeners() {
    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (res.ok) {
                currentUser = data.user;
                localStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
                initApp();
            } else {
                alert(data.error);
            }
        } catch (err) {
            alert('Erreur serveur lors de la connexion.');
        }
    });

    document.getElementById('register-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);

        try {
            const res = await fetch('/api/register', {
                method: 'POST',
                body: formData
            });
            const data = await res.json();
            if (res.ok) {
                currentUser = data.user;
                localStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
                initApp();
            } else {
                alert(data.error);
            }
        } catch (err) {
            alert('Erreur réseau lors de l’inscription.');
        }
    });

    document.getElementById('private-chat-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('private-message-input');
        const text = input.value.trim();
        if (!text || !activeChatTargetId) return;

        socket.emit('private_message', {
            fromUserId: currentUser.id || currentUser._id,
            toUserId: activeChatTargetId,
            fromUserName: currentUser.nom,
            text,
            isCoupDeCoeur: false
        });
        input.value = '';
    });

    document.getElementById('public-chat-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('public-message-input');
        const text = input.value.trim();
        if (!text) return;

        socket.emit('public_message', {
            fromUserName: currentUser ? currentUser.nom : 'Anonyme',
            text
        });
        input.value = '';
    });

    document.getElementById('ecoute-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('ecoute-type').value;
        const message = document.getElementById('ecoute-message').value;

        try {
            const res = await fetch('/api/ecoute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    message,
                    userId: currentUser ? (currentUser.id || currentUser._id) : null
                })
            });
            if (res.ok) {
                alert('Votre message a été transmis avec succès et en toute confidentialité.');
                document.getElementById('ecoute-message').value = '';
                showSection('members-section');
            }
        } catch (err) {
            alert('Erreur d’envoi.');
        }
    });

    document.getElementById('admin-login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('admin-password').value;

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            if (res.ok) {
                document.getElementById('admin-login-box').style.display = 'none';
                document.getElementById('admin-dashboard').style.display = 'block';
                renderAdminData(data.users, data.ecoutes);
            } else {
                alert(data.error);
            }
        } catch (err) {
            alert('Erreur lors de la connexion admin.');
        }
    });
}

async function loadMembers() {
    try {
        const res = await fetch('/api/members');
        allMembers = await res.json();
        renderMembers(allMembers);
    } catch (err) {
        console.error('Erreur membres:', err);
    }
}

function renderMembers(members) {
    const container = document.getElementById('members-container');
    if (!container) return;

    const currentId = currentUser ? (currentUser.id || currentUser._id) : null;

    container.innerHTML = members
        .filter(m => m.id !== currentId && m._id !== currentId)
        .map(m => {
            const defaultAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(m.nom || 'Membre')}&background=e11d48&color=fff&size=200`;
            const photoSrc = (m.photo && m.photo.trim() !== '') ? m.photo : defaultAvatar;

            return `
            <div class="member-card">
                <span class="status-badge online">En ligne</span>
                <img src="${photoSrc}" alt="${m.nom}" onerror="this.onerror=null; this.src='${defaultAvatar}';">
                <div class="card-body">
                    <h4>
                        ${m.nom}, ${m.age}
                        ${m.isVip ? '<span class="vip-badge">👑 VIP</span>' : ''}
                    </h4>
                    <p><i class="fa-solid fa-location-dot"></i> ${m.ville}, ${m.pays}</p>
                    <p><strong>Intérêts:</strong> ${m.interets || 'Aucun'}</p>
                    <div class="card-stats">
                        <span class="stat-item likes"><i class="fa-solid fa-thumbs-up"></i> ${m.likesCount || 0}</span>
                        <span class="stat-item hearts"><i class="fa-solid fa-heart"></i> ${m.heartsCount || 0}</span>
                    </div>
                </div>
                <div class="card-actions">
                    <button class="btn btn-secondary btn-sm" onclick="sendLike('${m.id || m._id}')"><i class="fa-solid fa-thumbs-up"></i> Like</button>
                    <button class="btn btn-warning btn-sm" onclick="sendHeartAction('${m.id || m._id}')"><i class="fa-solid fa-heart"></i> Cœur</button>
                    <button class="btn btn-primary btn-sm" onclick="openPrivateChat('${m.id || m._id}', '${m.nom}')"><i class="fa-solid fa-envelope"></i> Message</button>
                </div>
            </div>
        `}).join('');
}

async function sendLike(targetId) {
    if (!currentUser) return alert('Veuillez vous connecter.');
    try {
        const res = await fetch('/api/like', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senderId: currentUser.id || currentUser._id, targetId })
        });
        if (res.ok) loadMembers();
    } catch (err) {
        console.error(err);
    }
}

async function sendHeartAction(targetId) {
    if (!currentUser) return alert('Veuillez vous connecter.');
    try {
        const res = await fetch('/api/heart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senderId: currentUser.id || currentUser._id, targetId })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = data.user;
            localStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
            renderNavigation();
            updateCoinsDisplay();
            if (data.isMatch) alert('🎉 C\'est un MATCH ! Vous vous plaisez mutuellement.');
            loadMembers();
        } else {
            alert(data.error);
        }
    } catch (err) {
        console.error(err);
    }
}

async function openPrivateChat(targetId, targetName) {
    if (!currentUser) return alert('Veuillez vous connecter.');
    activeChatTargetId = targetId;
    document.getElementById('chat-target-name').innerHTML = `<i class="fa-solid fa-user-lock"></i> Discussion avec ${targetName}`;
    showSection('private-chat-section');

    const viewport = document.getElementById('private-messages-viewport');
    viewport.innerHTML = '<p style="text-align:center; color:var::text-muted;">Chargement...</p>';

    try {
        const userId = currentUser.id || currentUser._id;
        const res = await fetch(`/api/messages/${userId}/${targetId}`);
        const messages = await res.json();

        viewport.innerHTML = '';
        messages.forEach(msg => appendPrivateMessage(msg));
    } catch (err) {
        viewport.innerHTML = '<p style="color:red; text-align:center;">Erreur de chargement.</p>';
    }
}

function appendPrivateMessage(msg) {
    const viewport = document.getElementById('private-messages-viewport');
    if (!viewport) return;

    const currentId = currentUser ? (currentUser.id || currentUser._id) : '';
    const isOwn = msg.fromUserId === currentId;

    const div = document.createElement('div');
    div.className = `chat-msg ${isOwn ? 'own-msg' : ''}`;
    div.innerHTML = `
        <strong>${isOwn ? 'Vous' : (msg.fromUserName || 'Membre')}</strong>
        <div>${msg.text}</div>
    `;
    viewport.appendChild(div);
    viewport.scrollTop = viewport.scrollHeight;
}

function setupSocketListeners() {
    socket.on('private_message', (data) => {
        const currentId = currentUser ? (currentUser.id || currentUser._id) : '';
        if (
            (data.fromUserId === activeChatTargetId && data.toUserId === currentId) ||
            (data.fromUserId === currentId && data.toUserId === activeChatTargetId)
        ) {
            appendPrivateMessage(data);
        }
    });

    socket.on('public_message', (data) => {
        const viewport = document.getElementById('public-messages-viewport');
        if (!viewport) return;

        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = `<strong>${data.fromUserName}</strong><div>${data.text}</div>`;
        viewport.appendChild(div);
        viewport.scrollTop = viewport.scrollHeight;
    });

    socket.on('update_online_status', () => {
        if (document.getElementById('members-section').style.display !== 'none') {
            loadMembers();
        }
    });
}

async function buyVIP() {
    if (!currentUser) return;
    // ...
}

function filterUsers() {
    // Filtres des membres
    const name = document.getElementById('search-name').value.toLowerCase();
    const country = document.getElementById('search-country').value.toLowerCase();
    const city = document.getElementById('search-city').value.toLowerCase();
    const maxAge = parseInt(document.getElementById('search-age').value) || 100;
    const sex = document.getElementById('search-sex').value;
    const interest = document.getElementById('search-interest').value.toLowerCase();

    const filtered = allMembers.filter(m => {
        const matchesName = m.nom.toLowerCase().includes(name);
        const matchesCountry = m.pays.toLowerCase().includes(country);
        const matchesCity = m.ville.toLowerCase().includes(city);
        const matchesAge = m.age <= maxAge;
        const matchesSex = !sex || m.sexe === sex;
        const matchesInterest = !interest || (m.interets && m.interets.toLowerCase().includes(interest));

        return matchesName && matchesCountry && matchesCity && matchesAge && matchesSex && matchesInterest;
    });

    renderMembers(filtered);
}

function resetFilters() {
    document.getElementById('search-name').value = '';
    document.getElementById('search-country').value = '';
    document.getElementById('search-city').value = '';
    document.getElementById('search-age').value = '';
    document.getElementById('search-sex').value = '';
    document.getElementById('search-interest').value = '';
    renderMembers(allMembers);
}

function renderAdminData(users, ecoutes) {
    const usersTable = document.getElementById('admin-users-list');
    const ecoutesTable = document.getElementById('admin-ecoutes-list');

    usersTable.innerHTML = users.map(u => `
        <tr>
            <td>${u.nom}</td>
            <td>${u.email}</td>
            <td>${u.coins || 0}</td>
            <td>${u.isVip ? '👑 Oui' : 'Non'}</td>
        </tr>
    `).join('');

    ecoutesTable.innerHTML = ecoutes.map(e => `
        <tr>
            <td><strong>${e.type}</strong></td>
            <td>${e.message}</td>
            <td>${new Date(e.date).toLocaleString()}</td>
        </tr>
    `).join('');
}

function logout() {
    localStorage.removeItem('nonvitcha_user');
    currentUser = null;
    socket.disconnect();
    location.reload();
}
