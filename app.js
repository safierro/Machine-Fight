import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot, updateDoc, deleteDoc, collection, addDoc, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const myFirebaseConfig = {
    apiKey: "AIzaSyCROSjuKFCXot5arfyhniAr7dVNzGiSlcc",
    authDomain: "machine-fight.firebaseapp.com",
    projectId: "machine-fight",
    storageBucket: "machine-fight.firebasestorage.app",
    messagingSenderId: "51178521196",
    appId: "1:51178521196:web:fb40f24b0a9c1efbacce49",
    measurementId: "G-ETMWQ9K11M"
};

const app = initializeApp(myFirebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let myId = null;
let myName = "Player";
let currentRoomId = null;
let isHost = false;
let gameActive = false;
let players = {};
let hostGameLoop = null;

let serverPhase = 'IDLE'; 
let serverTargetLetter = ''; 
let serverSafeTiles = [];
let serverDangerLetters = {}; 
let serverHoles = []; 
let serverRound = 1;

let myPlayer = { 
    name: "Player", 
    x: 0, z: 0, 
    vx: 0, vz: 0, 
    color: 0xffffff, 
    isAlive: true, 
    score: 0, kills: 0, 
    lastPushTime: 0,
    facingAngle: 0 
};

const moveSpeed = 0.025; 
const keys = { w: false, a: false, s: false, d: false };
const gridSize = 9;
const tileSize = 2; 
const lettersList = ['X', 'Y', 'Z'];

const pushEffects = [];
let myCooldownTime = 0;
const pushCooldown = 2000; 

const coneGeo = new THREE.ConeGeometry(2, 3, 16); 
coneGeo.rotateX(Math.PI / 2); 
coneGeo.translate(0, 0, 1.5); 

const screens = {
    loading: document.getElementById('loadingScreen'),
    mainMenu: document.getElementById('mainMenuScreen'),
    createRoom: document.getElementById('createRoomScreen'),
    joinRoom: document.getElementById('joinRoomScreen'),
    lobby: document.getElementById('lobbyScreen'),
    gameOver: document.getElementById('gameOverScreen')
};

function showScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    if(screens[screenName]) screens[screenName].classList.remove('hidden');
}

// ================= NÚT BẬT TẮT CHAT =================
const btnToggleChat = document.getElementById('btnToggleChat');
const inGameChatContainer = document.getElementById('inGameChatContainer');
if (btnToggleChat && inGameChatContainer) {
    btnToggleChat.addEventListener('click', () => {
        inGameChatContainer.classList.toggle('hidden');
    });
}

// ================= IOS ROTATE BYPASS & FULLSCREEN =================
const btnAutoRotate = document.getElementById('btnAutoRotate');
if (btnAutoRotate) {
    btnAutoRotate.addEventListener('click', async () => {
        try {
            let elem = document.documentElement;
            if (elem.requestFullscreen) await elem.requestFullscreen();
            else if (elem.webkitRequestFullscreen) await elem.webkitRequestFullscreen();
            
            if (screen.orientation && screen.orientation.lock) {
                await screen.orientation.lock("landscape").catch(()=>{});
            }
        } catch (error) {
            // Nuốt lỗi cảnh báo tự động trên iOS, bắt người dùng phải quay ngang vật lý
        }
    });
}

// --- KHỞI TẠO ĐỒ HỌA THREE.JS ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
scene.fog = new THREE.Fog(0x0a0a0a, 15, 60);

const aspect = window.innerWidth / window.innerHeight;
const d = 15;
const camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
camera.position.set(20, 30, 20);
camera.lookAt(scene.position);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); scene.add(ambientLight);
const spotLight = new THREE.SpotLight(0xfffaee, 1.5);
spotLight.position.set(0, 30, 0); spotLight.castShadow = true; scene.add(spotLight);

function createNameSprite(name, colorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
    ctx.font = 'bold 50px Oswald, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = "black"; ctx.shadowBlur = 8; ctx.lineWidth = 5;
    ctx.strokeText(name, 256, 64);
    ctx.fillText(name, 256, 64);
    
    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(4, 1, 1);
    return sprite;
}

function createRobotModel(colorHex, playerName) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6, metalness: 0.3 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 0.8 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.5), bodyMat);
    torso.position.y = 0.5; torso.castShadow = true; group.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), bodyMat);
    head.position.y = 1.05; head.castShadow = true; group.add(head);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.1), eyeMat);
    visor.position.set(0, 1.1, 0.21); group.add(visor);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 16), darkMat);
    base.position.y = 0.1; base.castShadow = true; group.add(base);

    const nameSprite = createNameSprite(playerName, colorHex);
    nameSprite.position.y = 2.0; 
    group.add(nameSprite);

    group.userData = { bodyMat, nameSprite };
    return group;
}

function createTileMaterial(letter, bgColorHex, textColorHex) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bgColorHex; ctx.fillRect(0, 0, 256, 256);
    if (letter) {
        ctx.fillStyle = textColorHex; ctx.font = 'bold 150px Oswald, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, 128, 128);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.1 });
}

const matBlank = createTileMaterial('', '#444444', '#fff');
const matsNormal = { 'X': createTileMaterial('X', '#333333', '#ffffff'), 'Y': createTileMaterial('Y', '#333333', '#ffffff'), 'Z': createTileMaterial('Z', '#333333', '#ffffff') };

const tiles = [];
const floorGroup = new THREE.Group();
const tileGeo = new THREE.BoxGeometry(tileSize * 0.9, 0.5, tileSize * 0.9);

for (let x = 0; x < gridSize; x++) {
    for (let z = 0; z < gridSize; z++) {
        const mesh = new THREE.Mesh(tileGeo, matBlank);
        mesh.position.set((x - Math.floor(gridSize/2)) * tileSize, -0.25, (z - Math.floor(gridSize/2)) * tileSize);
        mesh.receiveShadow = true; 
        mesh.userData = { targetY: -0.25, isDanger: false, index: tiles.length }; 
        floorGroup.add(mesh); tiles.push(mesh);
    }
}
scene.add(floorGroup);
const playerMeshes = {};

signInAnonymously(auth).then((userCred) => {
    myId = userCred.user.uid;
    showScreen('mainMenu');
}).catch(err => alert("Lỗi kết nối máy chủ Firebase: Vui lòng F5 làm mới lại trang. \nChi tiết: " + err.message));

document.getElementById('navCreateRoom').onclick = () => {
    myName = document.getElementById('myPlayerName').value.trim() || "Người Chơi";
    document.getElementById('crRoomName').value = `Phòng của ${myName}`;
    showScreen('createRoom');
};
document.getElementById('navJoinRoom').onclick = () => { 
    myName = document.getElementById('myPlayerName').value.trim() || "Người Chơi";
    showScreen('joinRoom'); listenToRoomList(); 
};

document.getElementById('colorPicker').addEventListener('change', async (e) => {
    if (!currentRoomId || !myId) return;
    const hexVal = parseInt(e.target.value.replace('#', '0x'), 16);
    myPlayer.color = hexVal;
    await updateDoc(doc(db, "rooms", currentRoomId), { [`players.${myId}.color`]: hexVal }).catch(()=>{});
});

document.getElementById('crPrivacy').onchange = (e) => { document.getElementById('crPasswordGroup').classList.toggle('hidden', e.target.value === 'public'); };
document.getElementById('btnBackFromCreate').onclick = () => showScreen('mainMenu');
document.getElementById('btnBackFromJoin').onclick = () => { if(unsubscribeRoomList) unsubscribeRoomList(); showScreen('mainMenu'); };

document.getElementById('btnCreateRoomSubmit').onclick = async function() {
    const btn = this;
    if (btn.disabled) return; 
    
    const name = document.getElementById('crRoomName').value.trim() || "Phòng Ẩn Danh";
    let maxP = parseInt(document.getElementById('crMaxPlayers').value);
    if (isNaN(maxP) || maxP < 2 || maxP > 8) maxP = 8;
    const isPrivate = document.getElementById('crPrivacy').value === 'private';
    const pass = document.getElementById('crPassword').value.trim();

    if (isPrivate && pass === "") return alert("Vui lòng nhập mật khẩu cho phòng riêng tư!");
    
    btn.disabled = true;
    btn.innerText = "ĐANG TẠO...";

    const newRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const startColor = parseInt(document.getElementById('colorPicker').value.replace('#', '0x'), 16);
    myPlayer.color = startColor;
    
    try {
        await setDoc(doc(db, "rooms", newRoomId), {
            roomName: name, maxPlayers: maxP, isPrivate: isPrivate, password: pass, status: 'LOBBY', hostId: myId,
            gameState: { phase: 'IDLE', targetLetter: '', safeTiles: [], dangerLetters: {}, holes: [], round: 1 },
            players: { [myId]: { name: myName, x: 0, z: 0, color: startColor, isAlive: true, isHost: true, score: 0, kills: 0, pushedAt: 0 } }
        });
        enterLobby(newRoomId, name, true, maxP);
    } catch (error) { 
        alert("Lỗi khi tạo phòng: Do bạn chưa cấp quyền Firebase Database (Security Rules) hoặc lỗi mạng.\n\nChi tiết: " + error.message); 
    } finally {
        btn.disabled = false;
        btn.innerText = "TẠO VÀ VÀO PHÒNG";
    }
};

let unsubscribeRoomList = null;
function listenToRoomList() {
    const roomListUI = document.getElementById('roomListUI');
    roomListUI.innerHTML = '<div style="text-align:center; color:#888;">Đang quét máy chủ...</div>';

    unsubscribeRoomList = onSnapshot(collection(db, "rooms"), (snapshot) => {
        roomListUI.innerHTML = '';
        if (snapshot.empty) return roomListUI.innerHTML = '<div style="text-align:center; color:#888;">Chưa có phòng nào đang mở.</div>';

        snapshot.forEach(docSnap => {
            const data = docSnap.data(); const rId = docSnap.id;
            const pCount = data.players ? Object.keys(data.players).length : 0;
            
            if (pCount === 0 || !data.maxPlayers) {
                deleteDoc(doc(db, "rooms", rId)).catch(()=>{});
                return;
            }

            const maxPlayers = data.maxPlayers || 8;
            const isPlaying = data.status !== 'LOBBY';
            const statusText = isPlaying ? `<span style="color:#ff3333;">Đang chơi</span>` : `<span style="color:#00ff00;">Phòng chờ</span>`;
            const lockIcon = data.isPrivate ? '🔒 ' : '🔓 ';

            const row = document.createElement('div');
            row.className = `room-row ${isPlaying ? 'playing' : ''}`;
            row.innerHTML = `
                <div class="room-info">
                    <div class="room-name">${lockIcon}${data.roomName} (ID: ${rId})</div>
                    <div class="room-details"><span>Người chơi: ${pCount}/${maxPlayers}</span><span>Trạng thái: ${statusText}</span></div>
                </div>
                <button class="btn btn-join" ${isPlaying || pCount >= maxPlayers ? 'disabled style="background:#555;"' : ''}>VÀO PHÒNG</button>
            `;
            if (!isPlaying && pCount < maxPlayers) {
                const joinBtn = row.querySelector('.btn-join');
                joinBtn.onclick = () => attemptJoinRoom(rId, data, joinBtn);
            }
            roomListUI.appendChild(row);
        });
    });
}

async function attemptJoinRoom(rId, roomData, btnElement) {
    if (roomData.isPrivate) {
        const inputPass = prompt("Phòng này là phòng riêng tư. Nhập mật khẩu:");
        if (inputPass === null) return;
        if (inputPass !== roomData.password) return alert("Mật khẩu không chính xác!");
    }
    
    btnElement.disabled = true;
    btnElement.innerText = "ĐANG VÀO...";

    const startColor = parseInt(document.getElementById('colorPicker').value.replace('#', '0x'), 16);
    myPlayer.color = startColor;
    
    try {
        await updateDoc(doc(db, "rooms", rId), { [`players.${myId}`]: { name: myName, x: 0, z: 0, color: startColor, isAlive: true, isHost: false, score: 0, kills: 0, pushedAt: 0 } });
        if(unsubscribeRoomList) unsubscribeRoomList();
        enterLobby(rId, roomData.roomName, false, roomData.maxPlayers);
    } catch (error) { 
        alert("Không thể vào phòng! Phòng có thể đã đầy hoặc đã bị xóa."); 
        btnElement.disabled = false;
        btnElement.innerText = "VÀO PHÒNG";
    }
}

// --- ĐỒNG BỘ PHÒNG THỜI GIAN THỰC ---
let unsubscribeRoom = null; let unsubscribeChat = null;

function enterLobby(rId, rName, amIHost, maxP) {
    currentRoomId = rId; isHost = amIHost;
    myPlayer.score = 0; myPlayer.isAlive = true;
    document.getElementById('lobbyTitle').innerText = rName;
    document.getElementById('lobbyRoomDisplay').innerText = `ID PHÒNG: ${rId}`;
    showScreen('lobby');
    document.getElementById('btnStartGame').style.display = isHost ? 'block' : 'none';
    listenToCurrentRoom(); listenToChat();
    sendSystemMessage(`Người chơi [${myName}] đã tham gia.`);
}

function listenToCurrentRoom() {
    unsubscribeRoom = onSnapshot(doc(db, "rooms", currentRoomId), (docSnap) => {
        if (!docSnap.exists()) return forceLeaveRoom("Phòng đã bị xóa hoặc kết thúc!");
        const data = docSnap.data();
        players = data.players || {};

        if (data.hostId && !players[data.hostId]) {
            const remainingIds = Object.keys(players);
            if (remainingIds.length > 0 && remainingIds[0] === myId) {
                if (!isHost) {
                    isHost = true;
                    updateDoc(doc(db, "rooms", currentRoomId), { hostId: myId, [`players.${myId}.isHost`]: true });
                    if (data.status === 'PLAYING' && !hostGameLoop) startHostLoop(); 
                }
            }
        } else if (data.hostId === myId) {
            isHost = true;
        } else {
            isHost = false;
        }
        
        document.getElementById('btnStartGame').style.display = isHost ? 'block' : 'none';
        document.getElementById('btnReturnLobby').style.display = isHost ? 'block' : 'none';
        document.getElementById('waitingHostText').style.display = isHost ? 'none' : 'block';
        
        document.getElementById('lobbyPlayerCountTitle').innerText = `NGƯỜI CHƠI (${Object.keys(players).length}/${data.maxPlayers})`;
        updateLobbyUI(); sync3DPlayers();

        if (data.status === 'PLAYING' && !gameActive) startGameClient(data.roomName);
        else if (data.status === 'LOBBY' && gameActive) stopGameClient();
        else if (data.status === 'LOBBY' && !screens.lobby.classList.contains('hidden') === false) stopGameClient();
        else if (data.status === 'GAMEOVER' && gameActive) showGameOver();

        if (gameActive && data.players[myId]) {
            const serverMe = data.players[myId];
            if (serverMe.push && serverMe.push.time !== myPlayer.lastPushTime) {
                myPlayer.lastPushTime = serverMe.push.time;
                myPlayer.vx = serverMe.push.nx || 0;
                myPlayer.vz = serverMe.push.nz || 0;
            }
        }

        if (data.status === 'PLAYING' && data.gameState) {
            const state = data.gameState; let oldPhase = serverPhase;
            serverPhase = state.phase; 
            serverTargetLetter = state.targetLetter || ''; 
            serverSafeTiles = state.safeTiles || []; 
            serverDangerLetters = state.dangerLetters || {}; 
            serverHoles = state.holes || []; 
            serverRound = state.round || 1;

            if (oldPhase === 'DROP' && serverPhase === 'IDLE' && myPlayer.isAlive) {
                myPlayer.score += 10; uploadMyPosition(); 
            }
        }
    });
}

// --- CƠ CHẾ SÓNG XUNG KÍCH ---
function triggerPush() {
    if (!gameActive || !myPlayer.isAlive) return;
    const now = Date.now();
    if (now - myCooldownTime < pushCooldown) return;
    
    myCooldownTime = now;
    
    const statusUI = document.getElementById('pushStatus');
    statusUI.innerText = "SÓNG ĐẨY: ĐANG HỒI...";
    statusUI.style.color = "#888";
    
    const mobileBtn = document.getElementById('pushBtnMobile');
    if(mobileBtn) {
        mobileBtn.style.background = "rgba(255, 0, 0, 0.3)";
        mobileBtn.style.borderColor = "#ff0000";
        mobileBtn.innerText = "HỒI...";
    }

    setTimeout(() => { 
        if (gameActive) { 
            statusUI.innerText = "SÓNG ĐẨY: SẴN SÀNG"; 
            statusUI.style.color = "#00ff00"; 
            if(mobileBtn) {
                mobileBtn.style.background = "rgba(0, 255, 0, 0.3)";
                mobileBtn.style.borderColor = "#00ff00";
                mobileBtn.innerText = "ĐẨY";
            }
        } 
    }, pushCooldown);

    const coneMat = new THREE.MeshBasicMaterial({ color: myPlayer.color, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(myPlayer.x, 0.5, myPlayer.z);
    cone.rotation.y = myPlayer.facingAngle;

    scene.add(cone);
    pushEffects.push({ mesh: cone, scale: 1, opacity: 0.6, type: 'cone' });

    for (let uid in players) {
        if (uid === myId || !players[uid].isAlive) continue;
        
        const p = players[uid];
        if (typeof p.x !== 'number' || typeof p.z !== 'number') continue;

        const dx = p.x - myPlayer.x;
        const dz = p.z - myPlayer.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        
        if (dist > 0 && dist < 3.0) { 
            const angleToTarget = Math.atan2(dx, dz);
            let angleDiff = angleToTarget - myPlayer.facingAngle;
            while (angleDiff <= -Math.PI) angleDiff += Math.PI * 2;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            
            if (Math.abs(angleDiff) <= Math.PI / 4) { 
                let pushPower = Math.max(0.5, 1.2 - dist * 0.3); 
                const nx = (dx / dist) * pushPower;
                const nz = (dz / dist) * pushPower;
                
                updateDoc(doc(db, "rooms", currentRoomId), {
                    [`players.${uid}.push`]: { nx: nx, nz: nz, time: now }
                }).catch(()=>{});
            }
        }
    }
}

window.addEventListener('mousedown', (e) => {
    if(e.target.closest('#mobileControls') || e.target.closest('.top-bar') || e.target.closest('#inGameChatContainer')) return;
    triggerPush();
});

const pushBtnMobile = document.getElementById('pushBtnMobile');
if(pushBtnMobile) {
    pushBtnMobile.addEventListener('touchstart', (e) => {
        e.preventDefault(); 
        triggerPush();
    }, {passive: false});
}

// HỆ THỐNG VIRTUAL JOYSTICK CHO MOBILE
const joystickZone = document.getElementById('joystickZone');
const joystickKnob = document.getElementById('joystickKnob');

let isDragging = false;
let joyStartX, joyStartY;

function resetKeys() { keys.w = keys.a = keys.s = keys.d = false; }

if (joystickZone && joystickKnob) {
    joystickZone.addEventListener('touchstart', (e) => {
        isDragging = true;
        const touch = e.touches[0];
        const rect = joystickZone.getBoundingClientRect();
        joyStartX = rect.left + rect.width / 2;
        joyStartY = rect.top + rect.height / 2;
        updateJoystick(touch.clientX, touch.clientY);
    }, {passive: false});

    joystickZone.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault(); 
        const touch = e.touches[0];
        updateJoystick(touch.clientX, touch.clientY);
    }, {passive: false});

    joystickZone.addEventListener('touchend', () => {
        isDragging = false;
        joystickKnob.style.transform = `translate(0px, 0px)`;
        resetKeys();
    });

    function updateJoystick(clientX, clientY) {
        const dx = clientX - joyStartX;
        const dy = clientY - joyStartY;
        const distance = Math.min(Math.sqrt(dx*dx + dy*dy), 40); 
        const angle = Math.atan2(dy, dx);
        
        joystickKnob.style.transform = `translate(${Math.cos(angle)*distance}px, ${Math.sin(angle)*distance}px)`;

        resetKeys();
        if (distance > 10) { 
            if (Math.abs(dx) > Math.abs(dy)) {
                if (dx > 0) keys.d = true; else keys.a = true;
            } else {
                if (dy > 0) keys.s = true; else keys.w = true;
            }
            if (Math.abs(dx) > 15 && Math.abs(dy) > 15) {
                if(dx>0) keys.d=true; else keys.a=true;
                if(dy>0) keys.s=true; else keys.w=true;
            }
        }
    }
}

// HỆ THỐNG CHAT 
function listenToChat() {
    const q = query(collection(db, "rooms", currentRoomId, "chat"), orderBy("time", "desc"), limit(20));
    unsubscribeChat = onSnapshot(q, (snap) => {
        let msgs = []; snap.forEach(doc => msgs.push(doc.data())); msgs.reverse();
        let htmlStr = msgs.map(m => m.sys ? `<div class="chat-msg chat-sys">${m.text}</div>` : `<div class="chat-msg"><b>${m.sender}:</b> ${m.text}</div>`).join('');
        document.getElementById('lobbyChatMessages').innerHTML = htmlStr;
        document.getElementById('inGameChatMessages').innerHTML = htmlStr;
        document.getElementById('lobbyChatMessages').scrollTop = document.getElementById('lobbyChatMessages').scrollHeight;
        document.getElementById('inGameChatMessages').scrollTop = document.getElementById('inGameChatMessages').scrollHeight;
    });
}
async function sendMessage(text, isSys = false) {
    if (!text.trim() || !currentRoomId) return;
    await addDoc(collection(db, "rooms", currentRoomId, "chat"), { text: text, sender: isSys ? "Hệ thống" : myName, time: Date.now(), sys: isSys });
}
const sendSystemMessage = (t) => sendMessage(t, true);
document.getElementById('btnSendLobbyChat').onclick = () => { sendMessage(document.getElementById('lobbyChatInput').value); document.getElementById('lobbyChatInput').value = ''; };
document.getElementById('lobbyChatInput').onkeypress = (e) => { if(e.key === 'Enter') document.getElementById('btnSendLobbyChat').click(); };

const inGameChatInput = document.getElementById('inGameChatInput');
window.addEventListener('keydown', (e) => {
    if (document.activeElement === inGameChatInput) {
        if (e.key === 'Enter') { sendMessage(inGameChatInput.value); inGameChatInput.value = ''; inGameChatInput.blur(); }
        return;
    }
    if (e.key === 'Enter' && gameActive) { inGameChatInput.focus(); return; }
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => { if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false; });

// --- MÁY CHỦ (HOST LOGIC) ---
document.getElementById('btnStartGame').onclick = async () => {
    let updates = { status: 'PLAYING', "gameState.phase": "IDLE", "gameState.round": 1, "gameState.holes": [] };
    for (let p in players) {
        updates[`players.${p}.isAlive`] = true;
        updates[`players.${p}.score`] = 0; 
    }
    await updateDoc(doc(db, "rooms", currentRoomId), updates);
    startHostLoop(); 
};

function startHostLoop() {
    if (hostGameLoop) clearInterval(hostGameLoop);
    let phaseTime = 0;
    
    hostGameLoop = setInterval(async () => {
        if (!gameActive || !isHost) return clearInterval(hostGameLoop);

        let aliveCount = Object.values(players).filter(p => p && p.isAlive).length;
        let totalPlayers = Object.keys(players).length;

        if (totalPlayers > 0 && (aliveCount === 0 || (aliveCount === 1 && totalPlayers > 1))) {
            clearInterval(hostGameLoop);
            await updateDoc(doc(db, "rooms", currentRoomId), { status: 'GAMEOVER' }).catch(()=>{});
            return; 
        }

        phaseTime++;

        if (serverPhase === 'IDLE' && phaseTime >= 3) {
            serverPhase = 'ROLLING'; phaseTime = 0;
            await updateDoc(doc(db, "rooms", currentRoomId), { "gameState.phase": serverPhase, "gameState.targetLetter": '' }); 
        } 
        else if (serverPhase === 'ROLLING' && phaseTime >= 4) {
            serverPhase = 'LOCKED'; phaseTime = 0;
            let target = lettersList[Math.floor(Math.random()*lettersList.length)];
            
            let activeTiles = Array.from({length: 81}, (_, i) => i).filter(i => !serverHoles.includes(i));
            let safeRatio = Math.max(0.1, 0.4 - (serverRound - 1) * 0.05);
            let safeCount = Math.floor(activeTiles.length * safeRatio);
            safeCount = Math.max(2, safeCount); 
            
            let safeArr = [];
            for(let i=0; i<safeCount; i++) {
                if(activeTiles.length === 0) break;
                let rIdx = Math.floor(Math.random() * activeTiles.length);
                safeArr.push(activeTiles[rIdx]); 
                activeTiles.splice(rIdx, 1);
            }
            
            let dLetters = {};
            activeTiles.forEach(idx => { 
                let wLetters = lettersList.filter(l => l !== target);
                dLetters[idx] = wLetters[Math.floor(Math.random()*wLetters.length)];
            });

            await updateDoc(doc(db, "rooms", currentRoomId), { 
                "gameState.phase": serverPhase, "gameState.targetLetter": target,
                "gameState.safeTiles": safeArr, "gameState.dangerLetters": dLetters
            });
        }
        else if (serverPhase === 'LOCKED' && phaseTime >= 2) {
            serverPhase = 'DROP'; phaseTime = 0;
            await updateDoc(doc(db, "rooms", currentRoomId), { "gameState.phase": serverPhase });
        }
        else if (serverPhase === 'DROP' && phaseTime >= 3) {
            serverRound++;
            
            let holeCountToAdd = 10;
            let eligibleTilesToBreak = Array.from({length: 81}, (_, i) => i).filter(i => !serverSafeTiles.includes(i) && !serverHoles.includes(i));
            
            let newHoles = [];
            for(let i=0; i < holeCountToAdd; i++) {
                if (eligibleTilesToBreak.length === 0) break;
                let rIdx = Math.floor(Math.random() * eligibleTilesToBreak.length);
                newHoles.push(eligibleTilesToBreak[rIdx]);
                eligibleTilesToBreak.splice(rIdx, 1);
            }

            let updatedHoles = [...serverHoles, ...newHoles];
            if (updatedHoles.length > 72) updatedHoles = updatedHoles.slice(0, 72);

            serverPhase = 'IDLE'; phaseTime = 0;
            await updateDoc(doc(db, "rooms", currentRoomId), { 
                "gameState.phase": serverPhase, "gameState.round": serverRound, "gameState.holes": updatedHoles
            });
        }
    }, 1000);
}

function startGameClient(roomName) {
    showScreen('');
    document.getElementById('gameUI').style.display = 'block';
    document.getElementById('gameRoomNameText').innerText = `Phòng: ${roomName}`;
    document.getElementById('pushStatus').innerText = "SÓNG ĐẨY: SẴN SÀNG";
    document.getElementById('pushStatus').style.color = "#00ff00";

    gameActive = true; 
    document.getElementById('statusText').style.display = 'none';

    // Đặt khung chat về ẩn khi vào game trên mobile, bấm nút Chat để hiện
    const chatContainer = document.getElementById('inGameChatContainer');
    if (chatContainer) chatContainer.classList.add('hidden');

    myPlayer.x = (Math.floor(Math.random() * gridSize) - Math.floor(gridSize/2)) * tileSize;
    myPlayer.z = (Math.floor(Math.random() * gridSize) - Math.floor(gridSize/2)) * tileSize;
    myPlayer.vx = 0; myPlayer.vz = 0; 
    myPlayer.isAlive = true;
    
    camera.position.set(20, 30, 20); 
    camera.lookAt(scene.position);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
}

function stopGameClient() {
    gameActive = false; document.getElementById('gameUI').style.display = 'none';
    if (hostGameLoop) clearInterval(hostGameLoop);
    showScreen('lobby'); 
}

async function forceLeaveRoom(reason = "") {
    if(reason) alert(reason);
    gameActive = false; document.getElementById('gameUI').style.display = 'none';
    if (hostGameLoop) clearInterval(hostGameLoop);
    showScreen('mainMenu');
    
    if (unsubscribeRoom) unsubscribeRoom();
    if (unsubscribeChat) unsubscribeChat();

    if (currentRoomId) {
        sendSystemMessage(`Người chơi [${myName}] đã thoát.`);
        const pCount = Object.keys(players).length;
        if (pCount <= 1) {
            await deleteDoc(doc(db, "rooms", currentRoomId)).catch(e=>console.log(e));
        } else {
            await updateDoc(doc(db, "rooms", currentRoomId), { [`players.${myId}`]: deleteDoc() }).catch(e=>console.log(e));
        }
    }
    
    currentRoomId = null; isHost = false; myPlayer.vx = 0; myPlayer.vz = 0; serverPhase = 'IDLE';
}

window.addEventListener('beforeunload', () => {
    if (currentRoomId) {
        if (Object.keys(players).length <= 1) deleteDoc(doc(db, "rooms", currentRoomId));
        else updateDoc(doc(db, "rooms", currentRoomId), { [`players.${myId}`]: deleteDoc() });
    }
});

document.getElementById('btnExitLobby').onclick = () => forceLeaveRoom();
document.getElementById('btnLeave').onclick = () => forceLeaveRoom();
document.getElementById('btnReturnLobby').onclick = async () => { if (isHost) await updateDoc(doc(db, "rooms", currentRoomId), { status: 'LOBBY' }); };

function showGameOver() {
    gameActive = false; document.getElementById('gameUI').style.display = 'none';
    showScreen('gameOver');

    let arr = Object.keys(players).map(k => ({ id: k, ...players[k] }));
    arr.sort((a,b) => b.score - a.score); 
    
    let sbHTML = `<div class="score-row score-header"><span>Người Chơi</span><span>K / D</span><span>Điểm Tổng</span></div>`;
    arr.forEach((p, idx) => {
        let statusInfo = p.isAlive ? '(Sống)' : '(Đã ướt)';
        let deathCount = p.isAlive ? 0 : 1;
        let displayName = p.name || p.id.substring(0,4);
        sbHTML += `<div class="score-row" style="color: #${p.color.toString(16).padStart(6,'0')}">
            <span>#${idx+1} ${displayName} ${statusInfo}</span>
            <span>${p.kills} / ${deathCount}</span>
            <span>${p.score}</span>
        </div>`;
    });
    document.getElementById('scoreboard').innerHTML = sbHTML;
    document.getElementById('winnerAnnouncement').innerText = (arr[0] && arr[0].isAlive) ? `NGƯỜI CHIẾN THẮNG: ${arr[0].name || arr[0].id.substring(0,4)}` : "TẤT CẢ ĐỀU ĐÃ ƯỚT";
}

function updateLobbyUI() {
    const listUI = document.getElementById('playerListUI'); listUI.innerHTML = '';
    for (let uid in players) {
        const p = players[uid]; const hexColor = '#' + p.color.toString(16).padStart(6, '0');
        const hostTag = p.isHost ? ' 👑(Chủ)' : ''; const meTag = uid === myId ? ' (Bạn)' : '';
        const displayName = p.name || uid.substring(0,6);
        listUI.innerHTML += `<li class="player-item"><div class="player-color" style="background: ${hexColor}"></div><div>${displayName}${meTag}${hostTag}</div></li>`;
    }
}

function sync3DPlayers() {
    for (let id in playerMeshes) if (!players[id]) { scene.remove(playerMeshes[id]); delete playerMeshes[id]; }
    for (let id in players) {
        if (id === myId) continue;
        const pData = players[id];
        if (!pData || typeof pData.x !== 'number') continue; 

        const displayName = pData.name || id.substring(0,4);
        
        if (!playerMeshes[id]) {
            playerMeshes[id] = createRobotModel(pData.color, displayName); 
            scene.add(playerMeshes[id]);
        } else {
            if (playerMeshes[id].userData.bodyMat.color.getHex() !== pData.color) {
                playerMeshes[id].userData.bodyMat.color.setHex(pData.color);
            }
        }
        
        playerMeshes[id].position.x = THREE.MathUtils.lerp(playerMeshes[id].position.x, pData.x, 0.3);
        playerMeshes[id].position.z = THREE.MathUtils.lerp(playerMeshes[id].position.z, pData.z, 0.3);
        playerMeshes[id].position.y = pData.isAlive ? 0 : -2.5; 
    }
}

// --- CẬP NHẬT RENDER LOOP ---
let frameCount = 0;
function animate() {
    requestAnimationFrame(animate);
    frameCount++;

    pushEffects.forEach((eff, index) => {
        if(eff.type === 'cone') {
            eff.scale += 0.2;
            eff.mesh.translateZ(0.5); 
        } else {
            eff.scale += 0.15;
        }
        
        eff.opacity -= 0.03;
        eff.mesh.scale.set(eff.scale, eff.scale, eff.scale);
        eff.mesh.material.opacity = eff.opacity;
        if (eff.opacity <= 0) { scene.remove(eff.mesh); pushEffects.splice(index, 1); }
    });

    if (gameActive) {
        const tb = document.getElementById('targetBoard');
        
        if (serverPhase === 'IDLE') {
            tb.innerText = `VÒNG ${serverRound}`;
            tb.style.borderColor = '#444';
            tb.style.opacity = 1; 
        }
        else if (serverPhase === 'ROLLING') {
            if (frameCount % 60 === 0) {
                tb.innerText = lettersList[Math.floor(Math.random()*lettersList.length)];
            }
            tb.style.borderColor = '#00aaff';
            tb.style.opacity = 0.2 + 0.8 * Math.abs(Math.sin(frameCount * 0.05)); 
        }
        else if (serverPhase === 'LOCKED' || serverPhase === 'DROP') {
            tb.innerText = serverTargetLetter;
            tb.style.borderColor = '#00ff00';
            tb.style.opacity = 1; 
        }

        tiles.forEach((tile, index) => {
            if (serverHoles.includes(index)) {
                tile.userData.targetY = -2.5; 
                tile.material = matBlank;
            } 
            else {
                if (serverPhase === 'IDLE') {
                    tile.userData.targetY = -0.25; tile.material = matBlank; 
                } 
                else if (serverPhase === 'ROLLING') {
                    tile.userData.targetY = -0.25; 
                    if (frameCount % 40 === 0) tile.material = matsNormal[lettersList[Math.floor(Math.random()*lettersList.length)]];
                }
                else if (serverPhase === 'LOCKED') {
                    tile.userData.targetY = -0.25;
                    if (serverSafeTiles.includes(index)) {
                        tile.material = matsNormal[serverTargetLetter]; 
                    } else {
                        let dl = serverDangerLetters[index] || lettersList.filter(l => l !== serverTargetLetter)[0];
                        tile.material = matsNormal[dl]; 
                    }
                }
                else if (serverPhase === 'DROP') {
                    if (serverSafeTiles.includes(index)) {
                        tile.material = matsNormal[serverTargetLetter]; 
                    } else {
                        let dl = serverDangerLetters[index] || lettersList.filter(l => l !== serverTargetLetter)[0];
                        tile.material = matsNormal[dl]; 
                        tile.userData.targetY = -2.5; 
                    }
                }
            }
            tile.position.y = THREE.MathUtils.lerp(tile.position.y, tile.userData.targetY, 0.1);
        });

        if (myPlayer.isAlive) {
            if (document.activeElement !== inGameChatInput) {
                myPlayer.x += myPlayer.vx;
                myPlayer.z += myPlayer.vz;
                
                myPlayer.vx *= 0.85;
                myPlayer.vz *= 0.85;
                if (Math.abs(myPlayer.vx) < 0.01) myPlayer.vx = 0;
                if (Math.abs(myPlayer.vz) < 0.01) myPlayer.vz = 0;

                let dx_dir = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
                let dz_dir = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
                
                if (dx_dir !== 0 || dz_dir !== 0) {
                    let moveAngle = Math.atan2(dx_dir, dz_dir);
                    myPlayer.facingAngle = moveAngle;
                }

                if (keys.w) myPlayer.z -= moveSpeed;
                if (keys.s) myPlayer.z += moveSpeed;
                if (keys.a) myPlayer.x -= moveSpeed;
                if (keys.d) myPlayer.x += moveSpeed;

                const bound = (gridSize * tileSize) / 2 - 0.5;
                myPlayer.x = THREE.MathUtils.clamp(myPlayer.x, -bound, bound);
                myPlayer.z = THREE.MathUtils.clamp(myPlayer.z, -bound, bound);

                checkDeath(); 
            }
        }

        if (!playerMeshes[myId]) {
            playerMeshes[myId] = createRobotModel(myPlayer.color, myName);
            scene.add(playerMeshes[myId]);
        }
        
        playerMeshes[myId].rotation.y = THREE.MathUtils.lerp(playerMeshes[myId].rotation.y, myPlayer.facingAngle, 0.2);
        playerMeshes[myId].position.x = myPlayer.x;
        playerMeshes[myId].position.z = myPlayer.z;
        
        if (myPlayer.isAlive) {
            playerMeshes[myId].position.y = 0; 
            camera.position.x = THREE.MathUtils.lerp(camera.position.x, myPlayer.x + 20, 0.05);
            camera.position.z = THREE.MathUtils.lerp(camera.position.z, myPlayer.z + 20, 0.05);
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, 30, 0.05);
            camera.zoom = THREE.MathUtils.lerp(camera.zoom, 1, 0.05); 
            camera.lookAt(myPlayer.x, 0, myPlayer.z); 
        } else {
            playerMeshes[myId].position.y = -2.5; 
            camera.position.x = THREE.MathUtils.lerp(camera.position.x, 20, 0.02);
            camera.position.z = THREE.MathUtils.lerp(camera.position.z, 20, 0.02);
            camera.position.y = THREE.MathUtils.lerp(camera.position.y, 45, 0.02); 
            camera.zoom = THREE.MathUtils.lerp(camera.zoom, 0.5, 0.02); 
            camera.lookAt(0, 0, 0); 
        }
        camera.updateProjectionMatrix();
        
        uploadMyPosition();
    }
    renderer.render(scene, camera);
}

function checkDeath() {
    if (!myPlayer.isAlive) return; 
    
    let closestTile = null; let minDist = Infinity;
    tiles.forEach((tile) => {
        const dist = new THREE.Vector3(myPlayer.x, 0.5, myPlayer.z).distanceTo(new THREE.Vector3(tile.position.x, 0.5, tile.position.z));
        if (dist < minDist) { minDist = dist; closestTile = tile; }
    });
    
    if (closestTile && closestTile.userData.targetY === -2.5 && closestTile.position.y < -1.5) {
        myPlayer.isAlive = false; 
        const st = document.getElementById('statusText');
        st.innerText = "BẠN ĐÃ ƯỚT"; st.style.display = 'block'; 
        setTimeout(() => { st.style.display = 'none'; }, 1000);
        
        if(currentRoomId) {
             updateDoc(doc(db, "rooms", currentRoomId), {
                [`players.${myId}.isAlive`]: false
            }).catch(()=>{});
        }
    }
}

let lastUpdate = 0;
async function uploadMyPosition() {
    if (!myPlayer.isAlive) return; 

    let now = Date.now();
    if (now - lastUpdate > 40) { 
        lastUpdate = now;
        if (isNaN(myPlayer.x) || isNaN(myPlayer.z)) return;
        
        await updateDoc(doc(db, "rooms", currentRoomId), {
            [`players.${myId}.x`]: myPlayer.x, [`players.${myId}.z`]: myPlayer.z,
            [`players.${myId}.isAlive`]: myPlayer.isAlive, [`players.${myId}.score`]: myPlayer.score
        }).catch(()=>{});
    }
}

window.addEventListener('resize', () => {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -d * aspect; camera.right = d * aspect; camera.top = d; camera.bottom = -d;
    camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();