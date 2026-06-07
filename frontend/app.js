/**
 * VoiceChat — frontend client
 *
 * Responsibilities:
 *  1. Chat  : connect to /chat/{room}/{user}  WS → send/receive text messages
 *  2. Signal: connect to /signal/{room}/{user} WS → exchange WebRTC SDP + ICE
 *  3. Audio : build a full-mesh RTCPeerConnection to every peer in the room
 */

const BACKEND = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8000`;

// ─── State ────────────────────────────────────────────────────────────────────
let myId   = '';
let roomId = '';
let chatWs = null;
let sigWs  = null;

/** @type {Map<string, RTCPeerConnection>} */
const peerConnections = new Map();

let localStream    = null;   // microphone MediaStream
let isMuted        = true;   // start muted; user must unmute
let audioCtx       = null;
let analyserNode   = null;
let volumeRaf      = null;

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $lobby       = document.getElementById('lobby');
const $room        = document.getElementById('room');
const $roomLabel   = document.getElementById('room-label');
const $statusDot   = document.getElementById('status-dot');
const $statusText  = document.getElementById('status-text');
const $membersList = document.getElementById('members-list');
const $memberCount = document.getElementById('member-count');
const $messages    = document.getElementById('messages');
const $chatInput   = document.getElementById('chat-input');
const $volumeFill  = document.getElementById('volume-fill');
const $btnMute     = document.getElementById('btn-mute');
const $btnJoin     = document.getElementById('btn-join');
const $btnLeave    = document.getElementById('btn-leave');
const $btnSend     = document.getElementById('btn-send');
const $micModal    = document.getElementById('mic-modal');
const $micAllow    = document.getElementById('mic-allow');
const $micDeny     = document.getElementById('mic-deny');
const $audioOutputs= document.getElementById('audio-outputs');

// ─── Lobby ────────────────────────────────────────────────────────────────────
$btnJoin.addEventListener('click', startJoin);
document.getElementById('input-room').addEventListener('keydown', e => e.key === 'Enter' && startJoin());

function startJoin() {
  const nameRaw = document.getElementById('input-name').value.trim() || 'anon';
  const roomRaw = document.getElementById('input-room').value.trim() || 'general';
  myId   = `${nameRaw}-${Math.random().toString(36).slice(2, 6)}`;
  roomId = roomRaw.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  showMicModal();
}

function showMicModal() {
  $micModal.classList.add('visible');
}

$micAllow.addEventListener('click', async () => {
  $micModal.classList.remove('visible');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    setupVolumeAnalyser(localStream);
    // Start muted — tracks are enabled=false
    localStream.getAudioTracks().forEach(t => t.enabled = false);
    isMuted = true;
    updateMuteBtn();
  } catch (err) {
    console.warn('Mic denied:', err);
    localStream = null;
  }
  enterRoom();
});

$micDeny.addEventListener('click', () => {
  $micModal.classList.remove('visible');
  localStream = null;
  enterRoom();
});

// ─── Enter room ───────────────────────────────────────────────────────────────
function enterRoom() {
  $lobby.style.display = 'none';
  $room.style.display  = 'flex';
  $roomLabel.innerHTML = `<span>room /</span> ${roomId}`;
  document.title = `${roomId} — VoiceChat`;

  connectChat();
  connectSignaling();
}

// ─── Chat WebSocket ───────────────────────────────────────────────────────────
function connectChat() {
  chatWs = new WebSocket(
    `${BACKEND}/ws/${roomId}/${encodeURIComponent(myId)}`
  );

  chatWs.onopen = () => setStatus('connected');
  chatWs.onclose = () => {
    setStatus('disconnected');
    setTimeout(connectChat, 2000);
  };
  chatWs.onerror = () => chatWs.close();

  chatWs.onmessage = ({ data }) => {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'room_state':
        syncMembers(msg.members);
        break;
      case 'user_joined':
        onMemberJoined(msg.user_id);
        break;
      case 'user_left':
        onMemberLeft(msg.user_id);
        break;
      case 'text_message':
        renderMessage(msg);
        break;
    }
  };
}
// ─── Signaling WebSocket ──────────────────────────────────────────────────────
function connectSignaling() {
  sigWs = new WebSocket(
    `${BACKEND}/ws/signal/${roomId}/${encodeURIComponent(myId)}`
  );

  sigWs.onopen = () => {
    sigWs.send(JSON.stringify({ type: 'ready' }));
  };

  sigWs.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);

    switch (msg.type) {
      case 'peers':
        await handlePeerList(msg.peers);
        break;
      case 'new_peer':
        await callPeer(msg.user_id);
        break;
      case 'offer':
        await handleOffer(msg);
        break;
      case 'answer':
        await handleAnswer(msg);
        break;
      case 'ice':
        await handleIce(msg);
        break;
      case 'peer_left':
        handlePeerLeft(msg.user_id);
        break;
    }
  };

  sigWs.onclose = () => setTimeout(connectSignaling, 2000);
}


function sendSignal(payload) {
  if (sigWs && sigWs.readyState === WebSocket.OPEN) {
    sigWs.send(JSON.stringify(payload));
  }
}

// ─── WebRTC helpers ───────────────────────────────────────────────────────────
function createPeerConnection(peerId) {
  if (peerConnections.has(peerId)) return peerConnections.get(peerId);

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peerConnections.set(peerId, pc);

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  // Relay ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      sendSignal({ type: 'ice', target: peerId, candidate: candidate.toJSON() });
    }
  };

  // Play remote audio
  pc.ontrack = ({ streams }) => {
    if (streams && streams[0]) {
      playRemoteStream(peerId, streams[0]);
    }
  };

  pc.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      cleanupPeer(peerId);
    }
  };

  return pc;
}

async function handlePeerList(peers) {
  // We are the newcomer — existing peers will send us offers
  // Nothing to do here; "new_peer" on the other side triggers callPeer
}

async function callPeer(peerId) {
  const pc = createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({ type: 'offer', target: peerId, sdp: pc.localDescription });
}

async function handleOffer({ from, sdp }) {
  const pc = createPeerConnection(from);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal({ type: 'answer', target: from, sdp: pc.localDescription });
}

async function handleAnswer({ from, sdp }) {
  const pc = peerConnections.get(from);
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleIce({ from, candidate }) {
  const pc = peerConnections.get(from);
  if (pc) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
  }
}

function handlePeerLeft(peerId) {
  cleanupPeer(peerId);
  removeAudioElement(peerId);
}

function cleanupPeer(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) { pc.close(); peerConnections.delete(peerId); }
}

// ─── Audio playback ───────────────────────────────────────────────────────────
function playRemoteStream(peerId, stream) {
  let audio = document.getElementById(`audio-${peerId}`);
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = `audio-${peerId}`;
    audio.autoplay = true;
    audio.playsInline = true;
    $audioOutputs.appendChild(audio);
  }
  audio.srcObject = stream;
  updatePeerIndicator(peerId, true);
}

function removeAudioElement(peerId) {
  const el = document.getElementById(`audio-${peerId}`);
  if (el) el.remove();
}

// ─── Volume analyser ──────────────────────────────────────────────────────────
function setupVolumeAnalyser(stream) {
  audioCtx   = new AudioContext();
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 256;
  const source = audioCtx.createMediaStreamSource(stream);
  source.connect(analyserNode);

  const buf = new Uint8Array(analyserNode.frequencyBinCount);
  function tick() {
    analyserNode.getByteFrequencyData(buf);
    const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
    $volumeFill.style.width = `${Math.min(100, avg * 2.5)}%`;
    volumeRaf = requestAnimationFrame(tick);
  }
  tick();
}

// ─── Mute ─────────────────────────────────────────────────────────────────────
$btnMute.addEventListener('click', toggleMute);

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  updateMuteBtn();
}

function updateMuteBtn() {
  if (isMuted) {
    $btnMute.textContent = '🎙 Unmute';
    $btnMute.className = 'btn btn-ghost';
  } else {
    $btnMute.textContent = '🔴 Mute';
    $btnMute.className = 'btn btn-muted active';
  }
}

// ─── Members ─────────────────────────────────────────────────────────────────
let members = new Set();

function syncMembers(list) {
  members = new Set(list);
  renderMembers();
}

function onMemberJoined(uid) {
  if (uid === myId) return;
  members.add(uid);
  renderMembers();
  appendSystem(`${displayName(uid)} joined`);
}

function onMemberLeft(uid) {
  members.delete(uid);
  renderMembers();
  appendSystem(`${displayName(uid)} left`);
  cleanupPeer(uid);
  removeAudioElement(uid);
}

function renderMembers() {
  $memberCount.textContent = members.size;
  $membersList.innerHTML = '';
  for (const uid of members) {
    const el = document.createElement('div');
    el.className = 'member-item';
    el.id = `member-${uid}`;
    const initials = displayName(uid).slice(0, 2).toUpperCase();
    const isYou = uid === myId;
    el.innerHTML = `
      <div class="member-avatar">${initials}</div>
      <span class="member-name">${displayName(uid)}${isYou ? ' <span class="member-you">you</span>' : ''}</span>
      <div class="peer-audio-indicator" id="indicator-${uid}"></div>
    `;
    $membersList.appendChild(el);
  }
}

function updatePeerIndicator(peerId, active) {
  const el = document.getElementById(`indicator-${peerId}`);
  if (el) el.classList.toggle('active', active);
}

function displayName(uid) {
  return uid.replace(/-[a-z0-9]{4}$/, '');
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
$btnSend.addEventListener('click', sendMessage);
$chatInput.addEventListener('keydown', e => e.key === 'Enter' && !e.shiftKey && sendMessage());

function sendMessage() {
  const text = $chatInput.value.trim();
  if (!text || !chatWs) return;
  chatWs.send(JSON.stringify({ type: 'text_message', text }));
  $chatInput.value = '';
}

function renderMessage({ user_id, text }) {
  const own = user_id === myId;
  const el  = document.createElement('div');
  el.className = `msg${own ? ' own' : ''}`;
  el.innerHTML = `
    <div class="msg-bubble">${escHtml(text)}</div>
    <div class="msg-meta">${own ? 'you' : displayName(user_id)} · ${timestamp()}</div>
  `;
  $messages.appendChild(el);
  $messages.scrollTop = $messages.scrollHeight;
}

function appendSystem(text) {
  const el = document.createElement('div');
  el.className = 'msg system';
  el.innerHTML = `<div class="msg-bubble">${escHtml(text)}</div>`;
  $messages.appendChild(el);
  $messages.scrollTop = $messages.scrollHeight;
}

// ─── Leave ────────────────────────────────────────────────────────────────────
$btnLeave.addEventListener('click', leaveRoom);

function leaveRoom() {
  peerConnections.forEach(pc => pc.close());
  peerConnections.clear();

  if (chatWs)  { chatWs.onclose  = null; chatWs.close();  chatWs  = null; }
  if (sigWs)   { sigWs.onclose   = null; sigWs.close();   sigWs   = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  if (volumeRaf) cancelAnimationFrame(volumeRaf);
  if (audioCtx)  audioCtx.close();

  $audioOutputs.innerHTML = '';
  $messages.innerHTML     = '';
  $membersList.innerHTML  = '';
  $chatInput.value        = '';
  members.clear();

  setStatus('disconnected');
  $room.style.display  = 'none';
  $lobby.style.display = 'flex';
  document.title = 'VoiceChat';
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function setStatus(state) {
  $statusDot.className  = `status-dot${state === 'connected' ? ' connected' : ''}`;
  $statusText.textContent = state;
}

function timestamp() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}