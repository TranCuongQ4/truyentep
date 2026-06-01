// =====================================================
// FIREBASE IMPORT
// =====================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
    getDatabase,
    ref,
    set,
    get,
    update,
    push,
    onValue,
    remove
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";

// =====================================================
// FIREBASE CONFIG
// =====================================================
const firebaseConfig = {
    apiKey: "AIzaSyCwgBsmd9GFtIp3LD_aBV_VYZCheb2CvgI",
    authDomain: "cuongdata.firebaseapp.com",
    databaseURL: "https://cuongdata-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "cuongdata",
    storageBucket: "cuongdata.firebasestorage.app",
    messagingSenderId: "10726452052",
    appId: "1:10726452052:web:fc724b6775f492cdf136c1",
    measurementId: "G-PJJMR87MTJ"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// =====================================================
// DOM ELEMENTS
// =====================================================
const fileInput = document.getElementById("fileInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const roomInput = document.getElementById("roomInput");
const roomCode = document.getElementById("roomCode");
const fileName = document.getElementById("fileName");
const connectionStatus = document.getElementById("connectionStatus");
const progressBar = document.getElementById("progressBar");
const progressPercent = document.getElementById("progressPercent");
const transferSize = document.getElementById("transferSize");
const transferSpeed = document.getElementById("transferSpeed");
const remainingTime = document.getElementById("remainingTime");
const transferMode = document.getElementById("transferMode");
const logBox = document.getElementById("logBox");
const toast = document.getElementById("toast");
const qrArea = document.getElementById("qrArea");
const qrImage = document.getElementById("qrImage");

// =====================================================
// GLOBAL VARIABLES
// =====================================================
let selectedFile = null;
let roomId = null;
let isSender = false;
let peerConnection = null;

// Cấu hình truyền đa luồng (SCTP Multi-Channel)
const numChannels = 3; 
let dataChannels = [];
let openChannelsCount = 0;

// Bộ đệm xử lý ghép tệp tin đa luồng nhận về
let receiveBuffers = {}; 
let receivedChunksCount = 0;
let totalExpectedChunks = 0;
let receiveSize = 0;
let expectedFileSize = 0;
let expectedFileName = "";
let transferStartTime = 0;
let unsubscribeAnswer = null;

const chunkSize = 16 * 1024; // Khối 16KB tối ưu dữ liệu mạng

const rtcConfig = {
    iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
        { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
        { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" }
    ],
    iceCandidatePoolSize: 10
};

// =====================================================
// LOGGING & TOAST HELPERS
// =====================================================
function addLog(text){
    const time = new Date().toLocaleTimeString();
    logBox.innerHTML += `<div>[${time}] ${text}</div>`;
    logBox.scrollTop = logBox.scrollHeight;
    console.log(text);
}

function showToast(text){
    toast.textContent = text;
    toast.classList.add("show");
    setTimeout(() => { toast.classList.remove("show"); }, 3000);
}

function setStatus(text, color="#22c55e"){
    connectionStatus.textContent = text;
    connectionStatus.style.color = color;
    addLog(text);
}

function generateRoomCode(){
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for(let i=0; i<6; i++){
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

// =====================================================
// AUTOMATIC QR CODE CONNECTION LOGIC
// =====================================================
function generateRoomQR(code) {
    const currentUrl = window.location.href.split('?')[0];
    const connectUrl = `${currentUrl}?room=${code}`;
    
    // Sử dụng API Google Charts an toàn để dựng ảnh mã QR
    qrImage.src = `https://chart.googleapis.com/chart?cht=qr&chs=180x180&chl=${encodeURIComponent(connectUrl)}&choe=UTF-8`;
    qrArea.style.display = "block";
    addLog("Đã tạo liên kết quét mã QR chia sẻ nhanh");
}

function checkURLParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl && roomFromUrl.length === 6) {
        roomInput.value = roomFromUrl.toUpperCase();
        addLog(`Đã tự động bắt được mã phòng từ QR: ${roomFromUrl}`);
        setTimeout(() => { joinRoomBtn.click(); }, 800);
    }
}

// =====================================================
// FILE SELECTION
// =====================================================
fileInput.addEventListener("change", () => {
    if(!fileInput.files.length) return;
    selectedFile = fileInput.files[0];
    fileName.textContent = selectedFile.name + " (" + formatSize(selectedFile.size) + ")";
    addLog(`Đã chọn file: ${selectedFile.name}`);
});

// =====================================================
// SENDER: CREATE ROOM
// =====================================================
createRoomBtn.addEventListener("click", async () => {
    if(!selectedFile || selectedFile.size === 0){
        showToast("Vui lòng chọn file trước");
        return;
    }

    isSender = true;
    roomId = generateRoomCode();
    roomCode.textContent = roomId;
    
    // Khởi tạo mã QR để thiết bị khác quét nhanh
    generateRoomQR(roomId);

    setStatus("Đang tạo phòng...");
    const roomRef = ref(db, `rooms/${roomId}`);
    await set(roomRef, { createdAt: Date.now(), status: "waiting" });
    setStatus("Đang chờ người nhận...");

    await createSenderPeer();
    watchConnectionState();
});

// =====================================================
// WEBRTC SENDER INITIALIZATION
// =====================================================
async function createSenderPeer(){
    peerConnection = new RTCPeerConnection(rtcConfig);
    dataChannels = [];
    openChannelsCount = 0;

    // Thiết lập hệ thống đa luồng truyền song song
    for (let i = 0; i < numChannels; i++) {
        const channel = peerConnection.createDataChannel(`fileTransfer_${i}`, { ordered: true });
        channel.binaryType = "arraybuffer";
        setupSenderChannelEvents(channel);
        dataChannels.push(channel);
    }

    peerConnection.onicecandidate = async (event) => {
        if(!event.candidate) return;
        try {
            const candidateRef = push(ref(db, `rooms/${roomId}/offerCandidates`));
            await set(candidateRef, event.candidate.toJSON());
        } catch (e) { console.error("Lỗi gửi ICE:", e); }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await update(ref(db, `rooms/${roomId}`), {
        offer: { type: offer.type, sdp: offer.sdp }
    });

    addLog(`Đã cấu hình ${numChannels} đường truyền dữ liệu SCTP`);
    listenForAnswer();
}

function setupSenderChannelEvents(channel) {
    channel.onopen = () => {
        openChannelsCount++;
        addLog(`Luồng truyền dữ liệu [${channel.label}] kích hoạt thành công`);
        if (openChannelsCount === numChannels && isSender) {
            setStatus("Đã kết nối", "#22c55e");
            transferMode.textContent = `${numChannels} Luồng Gửi`;
            setTimeout(() => { sendFileMultiChannel(); }, 800);
        }
    };
    channel.onclose = () => { addLog(`Luồng [${channel.label}] đã đóng`); };
    channel.onerror = (err) => { console.error(`Lỗi luồng [${channel.label}]:`, err); };
}

function listenForAnswer(){
    const roomRef = ref(db, `rooms/${roomId}`);
    unsubscribeAnswer = onValue(roomRef, async(snapshot)=>{
        const data = snapshot.val();
        if(!data || !data.answer) return;
        if(peerConnection.currentRemoteDescription || peerConnection.signalingState === "stable") return;

        try {
            if(unsubscribeAnswer) { unsubscribeAnswer(); unsubscribeAnswer = null; }
            startConnectionTimeout();
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (err) { console.error("Lỗi đồng bộ remote:", err); }
    });

    onValue(ref(db, `rooms/${roomId}/answerCandidates`), async(snapshot)=>{
        snapshot.forEach(async(child)=>{
            const candidate = child.val();
            try{
                if (peerConnection.remoteDescription) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            }catch(err){ console.error(err); }
        });
    });
}

// =====================================================
// SENDER: MULTI-CHANNEL DATA TRANSMISSION
// =====================================================
async function sendFileMultiChannel() {
    if (!selectedFile) return;

    transferStartTime = Date.now();
    addLog(`Đang tiến hành phát dữ liệu đa luồng song song...`);

    // Gửi thông tin Metadata cấu trúc file qua luồng số 0
    dataChannels[0].send(JSON.stringify({
        type: "metadata",
        name: selectedFile.name,
        size: selectedFile.size,
        totalChunks: Math.ceil(selectedFile.size / chunkSize)
    }));

    let offset = 0;
    let chunkIndex = 0;

    while (offset < selectedFile.size) {
        const currentChannel = dataChannels[chunkIndex % numChannels];

        // Nếu bộ đệm tràn, tạm dừng luồng chờ giải phóng bộ nhớ thiết bị
        if (currentChannel.bufferedAmount > 2 * 1024 * 1024) {
            await new Promise(r => setTimeout(r, 40));
            continue; 
        }

        const slice = selectedFile.slice(offset, offset + chunkSize);
        const buffer = await slice.arrayBuffer();

        // Đóng gói mảnh dữ liệu kèm chỉ mục Header để phía nhận ráp chuẩn xác
        const packet = new Uint8Array(4 + buffer.byteLength);
        const view = new DataView(packet.buffer);
        view.setUint32(0, chunkIndex); 
        packet.set(new Uint8Array(buffer), 4);

        currentChannel.send(packet);

        offset += buffer.byteLength;
        chunkIndex++;

        updateSendProgress(offset, selectedFile.size);
    }

    // Gửi tín hiệu báo hoàn tất trên tất cả các kênh
    dataChannels.forEach(chan => {
        if (chan.readyState === "open") {
            chan.send(JSON.stringify({ type: "complete" }));
        }
    });

    addLog("Đã truyền xong tất cả phân đoạn file");
    setStatus("Gửi thành công", "#22c55e");

    setTimeout(async () => {
        await cleanupRoom();
        resetTransfer();
    }, 5000);
}

// =====================================================
// RECEIVER: JOIN ROOM
// =====================================================
joinRoomBtn.addEventListener("click", async()=>{
    const code = roomInput.value.trim().toUpperCase();
    if(!code){
        showToast("Vui lòng nhập mã phòng");
        return;
    }

    roomId = code;
    setStatus("Đang tìm phòng...", "#facc15");

    const roomRef = ref(db, `rooms/${roomId}`);
    const snap = await get(roomRef);

    if(!snap.exists()){
        showToast("Không tìm thấy mã phòng này");
        setStatus("Không tìm thấy", "#ef4444");
        return;
    }

    isSender = false;
    await joinAsReceiver();
    watchConnectionState();
    startConnectionTimeout();
});

async function joinAsReceiver(){
    const roomData = (await get(ref(db, `rooms/${roomId}`))).val();
    if(!roomData || !roomData.offer){
        showToast("Phòng chưa sẵn sàng");
        return;
    }

    peerConnection = new RTCPeerConnection(rtcConfig);

    // Lắng nghe luồng truyền dữ liệu từ người gửi thiết lập sang
    peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        channel.binaryType = "arraybuffer";
        dataChannels.push(channel);
        
        channel.onopen = () => {
            transferMode.textContent = `Đa Luồng Nhận`;
            setStatus("Đã kết nối", "#22c55e");
        };

        channel.onmessage = handleIncomingMultiChannelData;
    };

    peerConnection.onicecandidate = async(event)=>{
        if(!event.candidate) return;
        try {
            const candidateRef = push(ref(db, `rooms/${roomId}/answerCandidates`));
            await set(candidateRef, event.candidate.toJSON());
        } catch (e) { console.error("Lỗi gửi ICE:", e); }
    };

    await peerConnection.setRemoteDescription(new RTCSessionDescription(roomData.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await update(ref(db, `rooms/${roomId}`), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: "connected"
    });

    listenOfferCandidates();
}

function listenOfferCandidates(){
    onValue(ref(db, `rooms/${roomId}/offerCandidates`), (snapshot)=>{
        snapshot.forEach(async(child)=>{
            const candidate = child.val();
            try{
                if (peerConnection.remoteDescription) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            }catch(err){ console.error(err); }
        });
    });
}

// =====================================================
// RECEIVER: MULTI-CHANNEL DATA HANDLING
// =====================================================
function handleIncomingMultiChannelData(event) {
    if (typeof event.data === "string") {
        const msg = JSON.parse(event.data);

        if (msg.type === "metadata") {
            expectedFileName = msg.name;
            expectedFileSize = msg.size;
            totalExpectedChunks = msg.totalChunks;
            receiveBuffers = {};
            receivedChunksCount = 0;
            receiveSize = 0;
            addLog(`Đang tiếp nhận tệp đa luồng: ${msg.name}`);
            return;
        }

        if (msg.type === "complete") {
            // Đảm bảo nhận đủ số lượng khối mới kích hoạt xử lý ghép tệp
            if (receivedChunksCount === totalExpectedChunks && totalExpectedChunks > 0) {
                finishDownloadMultiChannel();
            }
            return;
        }
        return;
    }

    // Xử lý cắt ghép khối nhị phân dựa theo định danh Header 4-byte
    const buffer = event.data;
    const view = new DataView(buffer);
    const chunkIndex = view.getUint32(0); 
    const rawData = buffer.slice(4); 

    if (!receiveBuffers[chunkIndex]) {
        receiveBuffers[chunkIndex] = rawData;
        receivedChunksCount++;
        receiveSize += rawData.byteLength;
        updateReceiveProgress();
    }

    if (receivedChunksCount === totalExpectedChunks && totalExpectedChunks > 0) {
        finishDownloadMultiChannel();
    }
}

function finishDownloadMultiChannel() {
    // Ngăn chặn kích hoạt trùng lặp khi nhận tín hiệu complete từ các kênh khác nhau
    if (totalExpectedChunks === 0) return; 
    totalExpectedChunks = 0; 

    addLog("Đang liên kết toàn vẹn cấu trúc file...");
    const sortedBuffers = [];
    const totalKeys = Object.keys(receiveBuffers).length;
    
    for (let i = 0; i < totalKeys; i++) {
        sortedBuffers.push(receiveBuffers[i]);
    }

    const blob = new Blob(sortedBuffers);
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = expectedFileName;
    a.click();
    URL.revokeObjectURL(url);

    progressBar.style.width = "100%";
    progressPercent.textContent = "100%";
    setStatus("Nhận thành công", "#22c55e");
    showToast("Đã tải file hoàn tất");

    setTimeout(async () => {
        await cleanupRoom();
        resetTransfer();
    }, 5000);
}

// =====================================================
// PROGRESS CALCULATION HELPERS
// =====================================================
function updateSendProgress(sent, total){
    const percent = Math.floor(sent / total * 100);
    progressBar.style.width = percent + "%";
    progressPercent.textContent = percent + "%";
    transferSize.textContent = formatSize(sent) + " / " + formatSize(total);

    const elapsed = (Date.now() - transferStartTime) / 1000;
    const speed = sent / Math.max(elapsed, 0.1);
    transferSpeed.textContent = formatSize(speed) + "/s";

    const remain = (total - sent) / Math.max(speed, 1);
    remainingTime.textContent = formatTime(remain);
}

function updateReceiveProgress(){
    if(!expectedFileSize) return;
    const percent = Math.floor(receiveSize / expectedFileSize * 100);
    progressBar.style.width = Math.min(percent, 100) + "%";
    progressPercent.textContent = Math.min(percent, 100) + "%";
    transferSize.textContent = formatSize(receiveSize) + " / " + formatSize(expectedFileSize);
}

// =====================================================
// HELPERS
// =====================================================
function formatSize(bytes){
    if(bytes < 1024) return bytes+" B";
    if(bytes < 1024*1024) return (bytes/1024).toFixed(1) +" KB";
    if(bytes < 1024*1024*1024) return (bytes/1024/1024).toFixed(1) +" MB";
    return (bytes/1024/1024/1024).toFixed(1) +" GB";
}

function formatTime(sec){
    sec = Math.floor(sec);
    const m = Math.floor(sec/60);
    const s = sec % 60;
    return m+"m "+s+"s";
}

function watchConnectionState(){
    if (!peerConnection) return;
    peerConnection.onconnectionstatechange = ()=>{
        const state = peerConnection.connectionState;
        addLog(`Kết nối: ${state.toUpperCase()}`);
        if(state === "connected") {
            clearConnectionTimeout();
            setStatus("Đã kết nối", "#22c55e");
        } else if (state === "failed" || state === "disconnected") {
            setStatus("Lỗi kết nối", "#ef4444");
        }
    };
}

// =====================================================
// TIMEOUT & CLEANUP MANAGEMENT
// =====================================================
let connectionTimeout = null;
function startConnectionTimeout(){
    clearConnectionTimeout();
    connectionTimeout = setTimeout(()=>{
        if(!peerConnection || peerConnection.connectionState !== "connected"){
            setStatus("Hết thời gian kết nối", "#ef4444");
            showToast("Hết hạn thời gian kết nối");
        }
    }, 60000); 
}

function clearConnectionTimeout(){
    if(connectionTimeout){ clearTimeout(connectionTimeout); connectionTimeout = null; }
}

async function cleanupRoom(){
    try{
        if(roomId){
            await remove(ref(db, `rooms/${roomId}`));
            addLog("Đã dọn dẹp bộ nhớ phòng");
        }
    }catch(err){ console.error(err); }
}

function resetTransfer(){
    dataChannels = [];
    openChannelsCount = 0;
    receiveBuffers = {};
    receivedChunksCount = 0;
    totalExpectedChunks = 0;
    receiveSize = 0;
    expectedFileSize = 0;
    expectedFileName = "";
    
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    transferSize.textContent = "0 MB";
    transferSpeed.textContent = "0 MB/s";
    remainingTime.textContent = "--";
    transferMode.textContent = "Idle";
    qrArea.style.display = "none";
    
    if(unsubscribeAnswer) { unsubscribeAnswer(); unsubscribeAnswer = null; }
}

window.addEventListener("beforeunload", async()=>{ try{ await cleanupRoom(); }catch(e){} });

// Khởi chạy ứng dụng và bắt tham số từ liên kết QR nếu có
checkURLParameters();
setStatus("Sẵn sàng", "#22c55e");
resetTransfer();