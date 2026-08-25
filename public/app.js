// Initialisation de Socket.io
const socket = io();

// État global de l'application
let currentUser = null;
let activeChatTargetId = null;

// --- GESTION DE LA NAVIGATION ---
function showSection(sectionId) {
    document.querySelectorAll('.page-section').forEach(sec => sec.style.display = 'none');
    const targetSection = document.getElementById(sectionId);
    if (targetSection) targetSection.style.display = 'block';

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
}

// --- MISE À JOUR EN-TÊTE ET BARRE DE NAVIGATION ---
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

    const vipBadge = currentUser.isVip ? '<span style="color:#eab308; margin-left:4px;"><i class="fa-solid fa-crown"></i> VIP</span>' : '';

    navMenu.innerHTML = `
        <div class="user-profile-badge" style="display:flex; align-items:center; gap:0.4rem; padding:0.3rem 0.7rem; background:var(--border); border-radius:20px; font-weight:600; font-size:0.85rem;">
            <i class="fa-solid fa-circle-user" style="color:#dc2626; font-size:1.1rem;"></i>
            <span>${currentUser.nom}</span> ${vipBadge}
        </div>
        <button class="nav-btn" onclick="loadAllMembers()">
            <i class="fa-solid fa-users"></i> Membres
        </button>
        <button class="nav-btn" onclick="filterMatchesOnly()">
            <i class="fa-solid fa-fire" style="color:#dc2626;"></i> Mes Matchs
        </button>
        <button class="nav-btn" onclick="showSection('public-chat-section')">
            <i class="fa-solid fa-comments"></i> Salon Public
        </button>
        <button class="nav-btn coins-btn" onclick="showSection('recharge-section')">
            <i class="fa-solid fa-crown" style="color:#eab308;"></i> VIP / Coins (${currentUser.coins || 0})
        </button>
        <button class="nav-btn" onclick="showSection('ecoutes-section')">
            <i class="fa-solid fa-user-nurse"></i> Écoute SOS
        </button>
        <button class="nav-btn" onclick="logout()" title="Déconnexion">
            <i class="fa-solid fa-right-from-bracket"></i>
        </button>
    `;
    
    const coinsDisplay = document.getElementById('current-coins-display');
    if (coinsDisplay) coinsDisplay.innerText = currentUser.coins || 0;
}

// --- AUTHENTIFICATION & INSCRIPTION ---
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
            alert(data.error || 'Identifiants incorrects');
        }
    } catch (err) {
        console.error('Erreur connexion:', err);
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
            alert('Inscription réussie ! 50 Nonvicoins de bienvenue vous ont été crédités.');
            currentUser = data.user;
            updateNavbar();
            showSection('members-section');
            loadMembers();
        } else {
            alert(data.error || 'Échec de l\'inscription');
        }
    } catch (err) {
        console.error('Erreur inscription:', err);
    }
});

function logout() {
    currentUser = null;
    updateNavbar();
    showSection('auth-section');
}

// --- CHARGEMENT DES MEMBRES & FILTRAGE ---
async function loadMembers() {
    try {
        const res = await fetch('/api/members');
        const members = await res.json();
        renderMembers(members);
    } catch (err) {
        console.error('Erreur chargement membres:', err);
    }
}

function loadAllMembers() {
    showSection('members-section');
    document.querySelectorAll('.member-card').forEach(card => card.style.display = 'flex');
}

function renderMembers(members) {
    const container = document.getElementById('members-container');
    container.innerHTML = members.map(m => {
        const isMatch = m.isMatch ? '<span class="match-badge" style="background:#dc2626; color:#fff; font-size:0.7rem; padding:2px 8px; border-radius:10px; margin-left:5px;">IT\'S A MATCH 🔥</span>' : '';
        
        return `
            <div class="member-card" 
                 data-name="${(m.nom || '').toLowerCase()}"
                 data-country="${(m.pays || '').toLowerCase()}"
                 data-city="${(m.ville || '').toLowerCase()}"
                 data-sex="${m.sexe || ''}"
                 data-interest="${(m.interets || '').toLowerCase()}">
                
                <span class="status-badge ${m.online ? 'online' : ''}">${m.online ? '• En ligne' : 'Hors ligne'}</span>
                <img src="${m.photo || '/uploads/default.png'}" alt="${m.nom}">
                
                <div class="member-info" style="padding: 0.75rem;">
                    <h4>${m.nom}, ${m.age} ans ${isMatch}</h4>
                    <p style="color: var(--text-muted); font-size: 0.85rem;"><i class="fa-solid fa-location-dot"></i> ${m.ville}, ${m.pays || 'Bénin'}</p>
                    ${m.interets ? `<p style="font-size:0.75rem; color:#dc2626; margin-top:4px;"><i class="fa-solid fa-heart"></i> ${m.interets}</p>` : ''}
                </div>

                <div class="member-actions" style="display:flex; justify-content:space-between; gap:0.5rem; padding:0.5rem 0.75rem 0.75rem;">
                    <button class="btn btn-secondary btn-sm" onclick="sendHeart('${m.id}', '${m.nom}')" title="Coup de Cœur (5 Nonvicoins)" style="flex: 1;">
                        ❤️ Coup de Cœur
                    </button>
                    <button class="btn btn-primary btn-sm" onclick="openPrivateChat('${m.id}', '${m.nom}')" style="flex: 1;">
                        <i class="fa-solid fa-comments"></i> Discuter (2 coins)
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function filterUsers() {
    const name = document.getElementById('search-name').value.toLowerCase();
    const country = document.getElementById('search-country').value.toLowerCase();
    const city = document.getElementById('search-city').value.toLowerCase();
    const sex = document.getElementById('search-sex').value;
    const interest = document.getElementById('search-interest').value.toLowerCase();

    document.querySelectorAll('.member-card').forEach(card => {
        const matchName = card.dataset.name.includes(name);
        const matchCountry = card.dataset.country.includes(country);
        const matchCity = card.dataset.city.includes(city);
        const matchSex = !sex || card.dataset.sex === sex;
        const matchInterest = card.dataset.interest.includes(interest);

        if (matchName && matchCountry && matchCity && matchSex && matchInterest) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

function filterMatchesOnly() {
    showSection('members-section');
    document.querySelectorAll('.member-card').forEach(card => {
        if (card.querySelector('.match-badge')) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

// --- COUP DE CŒUR ---
async function sendHeart(targetId, targetName) {
    if (!currentUser || (currentUser.coins < 5 && !currentUser.isVip)) {
        alert('Solde insuffisant ! Un Coup de Cœur coûte 5 Nonvicoins.');
        showSection('recharge-section');
        return;
    }

    try {
        const res = await fetch('/api/heart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ senderId: currentUser.id, targetId })
        });
        if (res.ok) {
            if (!currentUser.isVip) currentUser.coins -= 5;
            updateNavbar();
            alert(`Coup de Cœur ❤️ envoyé à ${targetName} !`);
        }
    } catch (err) {
        console.error('Erreur coup de coeur:', err);
    }
}

// --- TCHAT PRIVÉ EN TEMPS RÉEL & INDICATEUR D'ÉCRITURE ---
function openPrivateChat(targetId, targetName) {
    if (!currentUser.isVip && currentUser.coins < 2) {
        alert('Solde insuffisant pour démarrer une discussion (2 Nonvicoins requis).');
        showSection('recharge-section');
        return;
    }

    activeChatTargetId = targetId;
    document.getElementById('chat-target-name').innerText = `Discussion avec ${targetName}`;
    document.getElementById('private-messages-viewport').innerHTML = '';
    showSection('private-chat-section');
}

const chatInput = document.getElementById('private-message-input');
if (chatInput) {
    chatInput.addEventListener('input', () => {
        if (activeChatTargetId && currentUser) {
            socket.emit('typing', { to: activeChatTargetId, senderName: currentUser.nom, senderId: currentUser.id });
        }
    });
}

socket.on('user_typing', (data) => {
    const indicator = document.getElementById('typing-indicator');
    if (indicator && data.senderId === activeChatTargetId) {
        indicator.innerText = `${data.senderName} est en train d'écrire...`;
        clearTimeout(window.typingTimeout);
        window.typingTimeout = setTimeout(() => { indicator.innerText = ''; }, 3000);
    }
});

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
        <span style="display:inline-block; padding: 0.5rem 1rem; border-radius: 12px; max-width:70%; background: ${isMe ? '#dc2626' : '#ffffff'}; color: ${isMe ? '#fff' : 'var(--text-main)'}; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
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
        user: currentUser ? currentUser.nom : 'Anonyme',
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

// --- ÉCOUTE SOS / SSR ---
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
            alert('Votre demande d\'assistance confidentielle a été transmise avec succès.');
            document.getElementById('ecoute-message').value = '';
        }
    } catch (err) {
        console.error('Erreur demande écoute:', err);
    }
});

// --- PAIEMENT KKIAPAY ET VIP ---
function triggerKkiaPay(amount) {
    openKkiapayWidget({
        amount: amount,
        position: "center",
        callback: "/api/kkiapay-callback"
    });
}

async function buyVIP() {
    if (!currentUser || currentUser.coins < 500) {
        alert('Solde insuffisant ! Le statut VIP requiert 500 Nonvicoins.');
        return;
    }

    try {
        const res = await fetch('/api/buy-vip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUser.id })
        });
        if (res.ok) {
            currentUser.isVip = true;
            currentUser.coins -= 500;
            updateNavbar();
            alert('Félicitations ! Vous êtes désormais un Membre VIP.');
        }
    } catch (err) {
        console.error('Erreur achat VIP:', err);
    }
}
