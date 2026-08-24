// Connexion Socket.io
const socket = io();

// État local de l'application
let currentUser = null;
let activeChatTargetId = null;

// --- NAVIGATION ENTRE LES SECTIONS ---
function showSection(sectionId) {
    document.querySelectorAll('.page-section').forEach(sec => sec.style.display = 'none');
    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.style.display = 'block';

    // Mise à jour de la navigation
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
}

// --- RENDU DE LA BARRE DE NAVIGATION DYNAMIQUE ---
function updateNavbar() {
    const navMenu = document.getElementById('nav-menu');
    if (!currentUser) {
        navMenu.innerHTML = `
            <button class="nav-btn active" onclick="showSection('auth-section')">
                <i class="fa-solid fa-right-to-bracket"></i> Connexion
            </button>
        `;
        return;
    }

    navMenu.innerHTML = `
        <button class="nav-btn" onclick="showSection('members-section')">
            <i class="fa-solid fa-users"></i> Membres
        </button>
        <button class="nav-btn" onclick="showSection('public-chat-section')">
            <i class="fa-solid fa-comments"></i> Salon Public
        </button>
        <button class="nav-btn" onclick="showSection('ecoutes-section')">
            <i class="fa-solid fa-user-nurse"></i> Écoute SOS
        </button>
        <button class="nav-btn coins-btn" onclick="showSection('recharge-section')">
            <i class="fa-solid fa-coins"></i> <span id="nav-coins">${currentUser.coins || 0}</span> Nonvicoins
        </button>
        <button class="nav-btn" onclick="logout()">
            <i class="fa-solid fa-right-from-bracket"></i>
        </button>
    `;
    document.getElementById('current-coins-display').innerText = currentUser.coins || 0;
}

// --- AUTHENTIFICATION ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
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
            updateNavbar();
            showSection('members-section');
            loadMembers();
        } else {
            alert(data.error || 'Échec de connexion');
        }
    } catch (err) {
        console.error(err);
    }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (res.ok) {
            alert('Inscription réussie ! 50 Nonvicoins vous ont été offerts.');
            currentUser = data.user;
            updateNavbar();
            showSection('members-section');
            loadMembers();
        } else {
            alert(data.error || 'Échec de l\'inscription');
        }
    } catch (err) {
        console.error(err);
    }
});

function logout() {
    currentUser = null;
    updateNavbar();
    showSection('auth-section');
}

// --- GESTION DES MEMBRES & RECHERCHE ---
async function loadMembers() {
    try {
        const res = await fetch('/api/members');
        const members = await res.json();
        renderMembers(members);
    } catch (err) {
        console.error(err);
    }
}

function renderMembers(members) {
    const container = document.getElementById('members-container');
    container.innerHTML = members.map(m => `
        <div class="member-card">
            <span class="status-badge ${m.online ? 'online' : ''}">${m.online ? 'En ligne' : 'Hors ligne'}</span>
            <img src="${m.photo || '/uploads/default.png'}" alt="${m.nom}">
            <div class="member-info">
                <h4>${m.nom}, ${m.age} ans</h4>
                <p style="color: var(--text-muted); font-size: 0.85rem;"><i class="fa-solid fa-location-dot"></i> ${m.ville}</p>
            </div>
            <div class="member-actions">
                <button class="btn btn-primary btn-sm" onclick="openPrivateChat('${m.id}', '${m.nom}')">
                    <i class="fa-solid fa-envelope"></i> Message
                </button>
            </div>
        </div>
    `).join('');
}

function filterUsers() {
    const query = document.getElementById('search-input').value.toLowerCase();
    const cards = document.querySelectorAll('.member-card');
    cards.forEach(card => {
        const text = card.innerText.toLowerCase();
        card.style.display = text.includes(query) ? 'block' : 'none';
    });
}

// --- TCHAT PRIVÉ ---
function openPrivateChat(targetId, targetName) {
    activeChatTargetId = targetId;
    document.getElementById('chat-target-name').innerText = `Discussion avec ${targetName}`;
    document.getElementById('private-messages-viewport').innerHTML = '';
    showSection('private-chat-section');
}

document.getElementById('private-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('private-message-input');
    const msg = input.value.trim();
    if (!msg || !activeChatTargetId) return;

    socket.emit('private_message', {
        to: activeChatTargetId,
        from: currentUser.id,
        text: msg
    });

    appendPrivateMessage(currentUser.nom, msg, true);
    input.value = '';
});

function appendPrivateMessage(sender, text, isMe) {
    const viewport = document.getElementById('private-messages-viewport');
    const msgDiv = document.createElement('div');
    msgDiv.style.marginBottom = '0.75rem';
    msgDiv.style.textAlign = isMe ? 'right' : 'left';
    msgDiv.innerHTML = `
        <span style="display:inline-block; padding: 0.5rem 1rem; border-radius: 12px; background: ${isMe ? 'var(--primary)' : '#ffffff'}; color: ${isMe ? '#fff' : 'var(--text-main)'}">
            <strong>${sender}:</strong> ${text}
        </span>
    `;
    viewport.appendChild(msgDiv);
    viewport.scrollTop = viewport.scrollHeight;
}

// --- TCHAT PUBLIC ---
document.getElementById('public-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('public-message-input');
    const msg = input.value.trim();
    if (!msg) return;

    socket.emit('public_message', {
        user: currentUser.nom,
        text: msg
    });
    input.value = '';
});

socket.on('public_message', (data) => {
    const viewport = document.getElementById('public-messages-viewport');
    const msgDiv = document.createElement('div');
    msgDiv.style.marginBottom = '0.5rem';
    msgDiv.innerHTML = `<strong>${data.user}:</strong> ${data.text}`;
    viewport.appendChild(msgDiv);
    viewport.scrollTop = viewport.scrollHeight;
});

// --- DEMANDE D'ÉCOUTE SOS / SSR ---
document.getElementById('ecoute-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('ecoute-type').value;
    const message = document.getElementById('ecoute-message').value;

    try {
        const res = await fetch('/api/ecoutes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id, type, message })
        });
        if (res.ok) {
            alert('Votre demande a été transmise en toute confidentialité.');
            document.getElementById('ecoute-message').value = '';
        }
    } catch (err) {
        console.error(err);
    }
});

// --- RECHARGE KKIAPAY & VIP ---
function triggerKkiaPay(amount) {
    openKkiapayWidget({
        amount: amount,
        position: "center",
        callback: "/api/kkiapay-callback"
    });
}

async function buyVIP() {
    if (!currentUser || currentUser.coins < 500) {
        alert('Solde insuffisant (500 Nonvicoins requis).');
        return;
    }
    // Transaction VIP
    alert('Félicitations, vous êtes désormais Membre VIP !');
}
