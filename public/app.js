











































const socket = io();

// Utilisateur connecté en local
let currentUser = null;
try {
    currentUser = JSON.parse(localStorage.getItem('nonvitcha_user'));
} catch (e) {
    currentUser = null;
}

let activePrivateChatUserId = null;
let typingTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Rafraîchissement des informations utilisateur si connecté
    if (currentUser && currentUser.id) {
        await refreshUserData();
    }
    
    updateNav();
    loadMembers();
    setupEventListeners();

    if (currentUser && currentUser.id) {
        socket.emit('user_connected', currentUser.id);
    }
});

// --- RAFRAÎCHISSEMENT DE SESSION ---
async function refreshUserData() {
    if (!currentUser || !currentUser.id) return;
    try {
        const res = await fetch(`/api/members?userId=${currentUser.id}`);
        if (res.ok) {
            const members = await res.json();
            const me = members.find(m => m.id === currentUser.id);
            if (me) {
                currentUser = { ...currentUser, ...me };
                localStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
            }
        }
    } catch (e) {
        console.warn('Impossible de rafraîchir le profil local:', e);
    }
}

// --- NAVIGATION & INTERFACE ---
function updateNav() {
    const navMenu = document.getElementById('nav-menu');
    if (!navMenu) return;

    if (currentUser && currentUser.nom) {
        const userPhoto = currentUser.photo || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100';

        navMenu.innerHTML = `
            <div class="user-nav-profile" onclick="triggerPhotoChange()" title="Cliquer pour changer de photo" style="cursor:pointer; display:inline-flex; align-items:center; background:#f1f5f9; padding:0.4rem 0.8rem; border-radius:20px; margin-right:0.5rem; border:1px solid var(--border-color, #e2e8f0);">
                <div style="position:relative; display:inline-block; margin-right:0.5rem;">
                    <img src="${userPhoto}" alt="${currentUser.nom}" style="width:26px; height:26px; border-radius:50%; object-fit:cover; vertical-align:middle;">
                    <span style="position:absolute; bottom:-2px; right:-2px; background:var(--primary-color, #e11d48); color:white; border-radius:50%; width:11px; height:11px; font-size:7px; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-camera"></i></span>
                </div>
                <span style="font-weight:700; font-size:0.85rem; color:var(--text-color, #1e293b);">${currentUser.nom}</span>
            </div>
            <input type="file" id="nav-photo-input" accept="image/*" style="display:none;" onchange="uploadNewPhoto(event)">

            <button class="nav-btn nav-btn-members" onclick="showSection('members-section')"><i class="fa-solid fa-users"></i> Membres</button>
            <button class="nav-btn nav-btn-matchs" onclick="showMatchs()"><i class="fa-solid fa-fire text-danger"></i> Mes Matchs</button>
            <button class="nav-btn nav-btn-chat" onclick="showSection('public-chat-section')"><i class="fa-solid fa-comments"></i> Salon Public</button>
            <button class="nav-btn nav-btn-vip btn-warning" onclick="showSection('recharge-section')"><i class="fa-solid fa-crown"></i> VIP / Coins (<span id="current-coins-display">${currentUser.coins || 0}</span>)</button>
            <button class="nav-btn nav-btn-sos" onclick="showSection('ecoutes-section')"><i class="fa-solid fa-user-doctor"></i> Écoute SOS</button>
            <button class="nav-btn nav-btn-admin" onclick="showSection('admin-section')"><i class="fa-solid fa-lock"></i> Admin</button>
            <button class="nav-btn nav-btn-logout btn-secondary" onclick="logout()"><i class="fa-solid fa-power-off"></i></button>
        `;
    } else {
        navMenu.innerHTML = `
            <button class="nav-btn nav-btn-matchs" onclick="showSection('auth-section')"><i class="fa-solid fa-right-to-bracket"></i> Connexion / Inscription</button>
            <button class="nav-btn nav-btn-members" onclick="showSection('members-section')"><i class="fa-solid fa-users"></i> Explorer</button>
            <button class="nav-btn nav-btn-admin" onclick="showSection('admin-section')"><i class="fa-solid fa-lock"></i> Admin</button>
        `;
    }
}

// --- MODIFICATION PHOTO DE PROFIL ---
function triggerPhotoChange() {
    const input = document.getElementById('nav-photo-input');
    if (input) input.click();
}

async function uploadNewPhoto(event) {
    const file = event.target.files[0];
    if (!file || !currentUser) return;

    const formData = new FormData();
    formData.append('photo', file);
    formData.append('userId', currentUser.id);

    try {
        const res = await fetch('/api/update-photo', {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        if (res.ok) {
            currentUser.photo = data.photoUrl;
            localStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
            updateNav();
            loadMembers();
            alert('Photo de profil mise à jour avec succès ! 📸');
        } else {
            alert(data.error || 'Erreur lors du changement de photo');
        }
    } catch (err) {
        console.error('Erreur upload photo:', err);
        alert('Erreur réseau lors de l\'envoi de la photo');
    }
}

function showSection(sectionId) {
    document.querySelectorAll('.page-section').forEach(sec => sec.style.display = 'none');
    const target = document.getElementById(sectionId);
    if (target) {
        target.style.display = 'block';
    } else {
        const authSec = document.getElementById('auth-section');
        if (authSec) authSec.style.display = 'grid';
    }
}

function logout() {
    localStorage.removeItem('nonvitcha_user');
    currentUser = null;
    updateNav();
    showSection('auth-section');
    loadMembers();
}

// --- GESTION DES ÉVÉNEMENTS & FORMULAIRES ---
function setupEventListeners() {
    // Connexion
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
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
                    socket.emit('user_connected', currentUser.id);
                    updateNav();
                    showSection('members-section');
                    loadMembers();
                } else {
                    alert(data.error || 'Erreur de connexion');
                }
            } catch (err) {
                console.error('Erreur réseau login:', err);
            }
        });
    }

    // Inscription avec auto-connexion
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(registerForm);

            try {
                const res = await fetch('/api/register', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (res.ok) {
                    currentUser = data.user;
                    localStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
                    socket.emit('user_connected', currentUser.id);

                    alert(`Bienvenue ${currentUser.nom} ! Inscription réussie 🎉 50 Coins vous ont été offerts.`);
                    registerForm.reset();
                    updateNav();
                    showSection('members-section');
                    loadMembers();
                } else {
                    alert(data.error || 'Erreur lors de l’inscription');
                }
            } catch (err) {
                console.error('Erreur réseau register:', err);
            }
        });
    }

    // Chat Public
    const publicForm = document.getElementById('public-chat-form');
    if (publicForm) {
        publicForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('public-message-input');
            const message = input.value.trim();
            if (!message) return;

            const senderName = currentUser ? currentUser.nom : 'Anonyme';
            socket.emit('public_message', { 
                sender: senderName, 
                message, 
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
            });
            input.value = '';
        });
    }

    // Chat Privé avec gestion de la saisie (typing)
    const privateInput = document.getElementById('private-message-input');
    if (privateInput) {
        privateInput.addEventListener('input', () => {
            if (activePrivateChatUserId && currentUser) {
                socket.emit('typing', { from: currentUser.id, to: activePrivateChatUserId, senderName: currentUser.nom });
            }
        });
    }

    const privateForm = document.getElementById('private-chat-form');
    if (privateForm) {
        privateForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('private-message-input');
            const message = input.value.trim();
            if (!message || !activePrivateChatUserId || !currentUser) return;

            socket.emit('private_message', { 
                from: currentUser.id, 
                to: activePrivateChatUserId, 
                senderName: currentUser.nom, 
                message 
            });
            appendPrivateMessage(currentUser.nom, message, true);
            input.value = '';
        });
    }

    // Formulaire d'Écoute SOS
    const ecouteForm = document.getElementById('ecoute-form');
    if (ecouteForm) {
        ecouteForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const type = document.getElementById('ecoute-type').value;
            const message = document.getElementById('ecoute-message').value;

            try {
                const res = await fetch('/api/ecoute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, message, userId: currentUser ? currentUser.id : null })
                });
                if (res.ok) {
                    alert('Votre message a été transmis en toute confidentialité.');
                    ecouteForm.reset();
                } else {
                    alert('Erreur lors de l’envoi');
                }
            } catch (err) {
                console.error('Erreur écoute:', err);
            }
        });
    }

    // Admin Login
    const adminForm = document.getElementById('admin-login-form');
    if (adminForm) {
        adminForm.addEventListener('submit', async (e) => {
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
                    const loginBox = document.getElementById('admin-login-box');
                    const dashboard = document.getElementById('admin-dashboard');
                    if (loginBox) loginBox.style.display = 'none';
                    if (dashboard) dashboard.style.display = 'block';
                    renderAdminData(data);
                } else {
                    alert(data.error || 'Mot de passe incorrect');
                }
            } catch (err) {
                console.error('Erreur admin login:', err);
            }
        });
    }
}

// --- RECEPTION DES MESSAGES TEMPS REEL ---
socket.on('public_message', (data) => {
    const viewport = document.getElementById('public-messages-viewport');
    if (viewport) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-msg';
        msgDiv.innerHTML = `<strong>${data.sender} <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal;">${data.time}</span></strong>${data.message}`;
        viewport.appendChild(msgDiv);
        viewport.scrollTop = viewport.scrollHeight;
    }
});

socket.on('private_message', (data) => {
    if (activePrivateChatUserId === data.from) {
        appendPrivateMessage(data.senderName, data.message, false);
    } else {
        alert(`Nouveau message privé de ${data.senderName}`);
    }
});

socket.on('user_typing', (data) => {
    if (activePrivateChatUserId === data.from) {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) {
            indicator.innerText = `${data.senderName} est en train d'écrire...`;
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => { indicator.innerText = ''; }, 3000);
        }
    }
});

socket.on('update_online_status', (data) => {
    const card = document.querySelector(`.member-card[data-id="${data.userId}"]`);
    if (card) {
        const badge = card.querySelector('.status-badge');
        if (badge) {
            if (data.online) {
                badge.classList.add('online');
                badge.innerText = 'En ligne';
            } else {
                badge.classList.remove('online');
                badge.innerText = 'Hors ligne';
            }
        }
    }
});

function appendPrivateMessage(sender, text, isOwn) {
    const viewport = document.getElementById('private-messages-viewport');
    if (viewport) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${isOwn ? 'own-msg' : ''}`;
        msgDiv.innerHTML = `<strong>${sender}</strong>${text}`;
        viewport.appendChild(msgDiv);
        viewport.scrollTop = viewport.scrollHeight;
    }
}

// --- AFFICHAGE & FILTRAGE DES MEMBRES ---
async function loadMembers() {
    try {
        const query = currentUser ? `?userId=${currentUser.id}` : '';
        const res = await fetch(`/api/members${query}`);
        const members = await res.json();
        renderMembers(members);
    } catch (err) {
        console.error('Erreur chargement membres:', err);
    }
}

function renderMembers(members) {
    const container = document.getElementById('members-container');
    if (!container) return;

    if (!members || members.length === 0) {
        container.innerHTML = '<p style="padding:1rem; text-align:center; color:var(--text-muted); width:100%;">Aucun membre à afficher.</p>';
        return;
    }

    container.innerHTML = members.map(m => `
        <div class="member-card" 
             data-id="${m.id}"
             data-name="${(m.nom || '').toLowerCase()}"
             data-country="${(m.pays || '').toLowerCase()}"
             data-city="${(m.ville || '').toLowerCase()}"
             data-age="${m.age || 0}"
             data-sex="${m.sexe || ''}"
             data-interest="${(m.interets || '').toLowerCase()}">
            <span class="status-badge ${m.online ? 'online' : ''}">${m.online ? 'En ligne' : 'Hors ligne'}</span>
            <img src="${m.photo || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=300'}" alt="${m.nom}">
            <div class="card-body">
                <h4 style="font-size:1rem; font-weight:700; margin-bottom:0.3rem;">
                    ${m.nom}, ${m.age} ans 
                    ${m.isMatch ? '<span class="badge-match">MATCH 🔥</span>' : ''}
                </h4>
                <p style="font-size:0.85rem; color:var(--text-muted);"><i class="fa-solid fa-location-dot"></i> ${m.ville}, ${m.pays || 'Bénin'}</p>
                <p style="font-size:0.8rem; color:var(--primary-color); margin-top:0.4rem;"><i class="fa-solid fa-heart"></i> ${m.interets || 'Intérêts non spécifiés'}</p>
            </div>
            <div class="card-actions">
                <button class="btn btn-secondary btn-sm" onclick="sendLike('${m.id}')">👍 Like</button>
                <button class="btn btn-heart btn-sm" onclick="sendHeart('${m.id}')">❤️ Cœur</button>
                <button class="btn btn-primary btn-sm" onclick="openPrivateChat('${m.id}', '${m.nom}')">💬 Chat</button>
            </div>
        </div>
    `).join('');
}

function filterUsers() {
    const nameVal = (document.getElementById('search-name')?.value || '').toLowerCase();
    const countryVal = (document.getElementById('search-country')?.value || '').toLowerCase();
    const cityVal = (document.getElementById('search-city')?.value || '').toLowerCase();
    const ageVal = parseInt(document.getElementById('search-age')?.value) || 999;
    const sexVal = document.getElementById('search-sex')?.value || '';
    const interestVal = (document.getElementById('search-interest')?.value || '').toLowerCase();

    document.querySelectorAll('.member-card').forEach(card => {
        const matchesName = card.dataset.name.includes(nameVal);
        const matchesCountry = card.dataset.country.includes(countryVal);
        const matchesCity = card.dataset.city.includes(cityVal);
        const matchesAge = parseInt(card.dataset.age) <= ageVal;
        const matchesSex = sexVal === '' || card.dataset.sex === sexVal;
        const matchesInterest = card.dataset.interest.includes(interestVal);

        if (matchesName && matchesCountry && matchesCity && matchesAge && matchesSex && matchesInterest) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

function resetFilters() {
    ['search-name', 'search-country', 'search-city', 'search-age', 'search-interest'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const sexSelect = document.getElementById('search-sex');
    if (sexSelect) sexSelect.value = '';

    filterUsers();
}

async function showMatchs() {
    if (!currentUser) return alert('Veuillez vous connecter pour voir vos matchs.');
    try {
        const res = await fetch(`/api/members?userId=${currentUser.id}`);
        const members = await res.json();
        const matchesOnly = members.filter(m => m.isMatch);
        showSection('members-section');
        renderMembers(matchesOnly);
    } catch (err) {
        console.error('Erreur chargement matchs:', err);
    }
}

function openPrivateChat(targetId, targetName) {
    if (!currentUser) return alert('Veuillez vous connecter pour chatter.');
    activePrivateChatUserId = targetId;
    const titleEl = document.getElementById('chat-target-name');
    const viewport = document.getElementById('private-messages-viewport');
    if (titleEl) titleEl.innerText = `Discussion privée avec ${targetName}`;
    if (viewport) viewport.innerHTML = '';
    showSection('private-chat-section');
}

async function sendLike(targetId) {
    if (!currentUser) return alert('Veuillez vous connecter.');
    try {
        const res = await fetch('/api/like', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senderId: currentUser.id, targetId })
        });
        const data = await res.json();
        if (res.ok) {
            alert('Like envoyé avec succès ! 👍');
        } else {
            alert(data.error || 'Erreur lors du like');
        }
    } catch (err) {
        console.error('Erreur like:', err);
    }
}

async function sendHeart(targetId) {
    if (!currentUser) return alert('Veuillez vous connecter.');
    try {
        const res = await fetch('/api/heart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senderId: currentUser.id, targetId })
        });
        const data = await res.json();
        if (res.ok) {
            if (data.isMatch) {
                alert("🎉 C'est un MATCH ! Vous pouvez désormais discuter.");
            } else {
                alert('Coup de cœur envoyé ! ❤️');
            }
            loadMembers();
        } else {
            alert(data.error || 'Erreur lors de l\'envoi du cœur');
        }
    } catch (err) {
        console.error('Erreur heart:', err);
    }
}

// --- MONÉTISATION & KKIAPAY ---
function triggerKkiaPay(amount) {
    if (!currentUser) return alert('Veuillez vous connecter pour recharger votre compte.');
    
    openKkiapayWidget({
        amount: amount,
        position: "center",
        callback: "/api/kkiapay-callback",
        data: JSON.stringify({ userId: currentUser.id, amount }),
        key: "PUBLIC_API_KEY" // Remplacez par votre clé publique Kkiapay
    });
}

async function buyVIP() {
    if (!currentUser) return alert('Veuillez vous connecter.');
    if ((currentUser.coins || 0) < 500) {
        return alert('Coins insuffisants. Veuillez recharger votre compte.');
    }

    try {
        const res = await fetch('/api/buy-vip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = data.user;
            localStorage.setItem('nonvitcha_user', JSON.stringify(currentUser));
            updateNav();
            alert('Félicitations ! Vous êtes désormais un membre VIP 👑');
        } else {
            alert(data.error || 'Erreur lors de la mise à jour VIP');
        }
    } catch (err) {
        console.error('Erreur achat VIP:', err);
    }
}

// --- TABLEAU DE BORD ADMIN ---
function renderAdminData(data) {
    const usersList = document.getElementById('admin-users-list');
    if (usersList && data.users) {
        usersList.innerHTML = data.users.map(u => `
            <tr>
                <td>${u.nom}</td>
                <td>${u.email}</td>
                <td>${u.coins}</td>
                <td>${u.isVip ? 'Oui 👑' : 'Non'}</td>
            </tr>
        `).join('');
    }

    const ecoutesList = document.getElementById('admin-ecoutes-list');
    if (ecoutesList && data.ecoutes) {
        ecoutesList.innerHTML = data.ecoutes.map(e => `
            <tr>
                <td><strong>${e.type}</strong></td>
                <td>${e.message}</td>
                <td>${new Date(e.date).toLocaleString()}</td>
            </tr>
        `).join('');
    }
}
