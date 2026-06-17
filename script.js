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

const openScanBtn = document.getElementById("openScanBtn");
const closeScanBtn = document.getElementById("closeScanBtn");
const scannerModal = document.getElementById("scannerModal");

// =====================================================
// GLOBAL VARIABLES
// =====================================================
let selectedFilesArray = []; 
let roomId = null;
let isSender = false;
let peerConnection = null;
let html5QrcodeScanner = null;
let isAnswering = false;

// Cấu hình đa luồng
const numChannels = 4; 
let dataChannels = [];
let openChannelsCount = 0;

// Bộ đệm nhận dữ liệu
let receiveBuffers = {}; 
let receivedChunksCount = 0;
let totalExpectedChunks = 0;
let receiveSize = 0;
let expectedFileSize = 0;
let expectedFileName = "";
let transferStartTime = 0;
let unsubscribeAnswer = null;
let unsubscribeOffer = null;
let unsubscribeSenderCandidates = null;
let unsubscribeReceiverCandidates = null;

// Quản lý trạng thái truyền tải
let isTransferring = false;
let isPaused = false;
let currentSendingFileIdx = 0;
let currentSendingOffset = 0;
let currentSendingChunkIndex = 0;

// Biến điều hướng đồng bộ
let fileAckResolver = null; 
let allReceivedResolver = null;

const chunkSize = 64 * 1024; 

// =====================================================
// CẤU HÌNH TURN CỐ ĐỊNH - METERED.CA (ĐÃ TEST HOẠT ĐỘNG)
// =====================================================
function getTurnixIceConfig() {
    addLog("🔄 Dùng cấu hình TURN cố định (Metered.ca)");
    
    const config = {
        iceServers: [
            // STUN servers
            {
                urls: [
                    "stun:stun.l.google.com:19302",
                    "stun:stun1.l.google.com:19302",
                    "stun:stun2.l.google.com:19302",
                    "stun:stun3.l.google.com:19302",
                    "stun:stun4.l.google.com:19302"
                ]
            },
            // TURN server - Metered.ca (đã test có relay)
            {
                urls: [
                    "turn:openrelay.metered.ca:80",
                    "turn:openrelay.metered.ca:443",
                    "turn:openrelay.metered.ca:443?transport=tcp"
                ],
                username: "openrelayproject",
                credential: "openrelayprojectsecret"
            }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all'
    };
    
    addLog("✅ Đã cấu hình TURN với Metered.ca");
    return config;
}

// =====================================================
// TỰ ĐỘNG KHỞI TẠO BẢNG THÔNG BÁO XANH NGỌC
// =====================================================
const styleEl = document.createElement("style");
styleEl.textContent = `
    .custom-success-modal {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center; z-index: 99999;
        opacity: 0; pointer-events: none; transition: all 0.3s ease;
    }
    .custom-success-modal.active { opacity: 1; pointer-events: auto; }
    .custom-success-content {
        background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
        border: 2px solid #06b6d4; border-radius: 16px; padding: 28px;
        width: 90%; max-width: 400px; text-align: center;
        box-shadow: 0 20px 25px -5px rgba(6, 182, 212, 0.15), 0 10px 10px -5px rgba(6, 182, 212, 0.1);
        transform: scale(0.9); transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .custom-success-modal.active .custom-success-content { transform: scale(1); }
    .custom-success-title {
        color: #22d3ee; font-size: 20px; font-weight: 700; margin-bottom: 20px;
        letter-spacing: 0.5px; text-shadow: 0 0 10px rgba(6, 182, 212, 0.3);
    }
    .custom-success-btn {
        background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
        color: #ffffff; font-weight: 600; font-size: 15px;
        padding: 10px 32px; border: none; border-radius: 8px; cursor: pointer;
        box-shadow: 0 4px 12px rgba(6, 182, 212, 0.3); transition: all 0.2s ease;
    }
    .custom-success-btn:hover {
        transform: translateY(-1px); box-shadow: 0 6px 16px rgba(6, 182, 212, 0.45); filter: brightness(1.1);
    }
    .custom-success-btn:active { transform: translateY(1px); }
`;
document.head.appendChild(styleEl);

const modalWrapper = document.createElement("div");
modalWrapper.className = "custom-success-modal";
modalWrapper.innerHTML = `
    <div class="custom-success-content">
        <div class="custom-success-title" id="customSuccessTitle">🎁 Đã Nhận Đủ Dữ Liệu 🎁</div>
        <button class="custom-success-btn" id="customSuccessBtn">OK</button>
    </div>
`;
document.body.appendChild(modalWrapper);

const customSuccessTitle = document.getElementById("customSuccessTitle");
const customSuccessBtn = document.getElementById("customSuccessBtn");

function showSuccessModal(message, callback) {
    customSuccessTitle.textContent = message;
    modalWrapper.classList.add("active");
    
    const newBtn = customSuccessBtn.cloneNode(true);
    customSuccessBtn.parentNode.replaceChild(newBtn, customSuccessBtn);
    
    newBtn.addEventListener("click", () => {
        modalWrapper.classList.remove("active");
        if (callback) callback();
    });
}

// =====================================================
// UTILS LOGS & TOAST
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
// QR CODE GENERATOR & SCANNER CAMERA
// =====================================================
function generateRoomQR(code) {
    const currentUrl = window.location.href.split('?')[0];
    const connectUrl = `${currentUrl}?room=${code}`;
    
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = ""; 
    
    new QRCode(qrContainer, {
        text: connectUrl,
        width: 140,
        height: 140,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    qrArea.style.display = "block";
    addLog("Mã QR kết nối nhanh đã được tạo");
}

function checkURLParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');
    if (roomFromUrl && roomFromUrl.length === 6) {
        processAutoJoin(roomFromUrl);
    }
}

function processAutoJoin(code) {
    roomInput.value = code.toUpperCase();
    addLog(`Phát hiện liên kết quét tự động vào phòng: ${code}`);
    setTimeout(() => { joinRoomBtn.click(); }, 800);
}

openScanBtn.addEventListener("click", () => {
    scannerModal.classList.add("active");
    addLog("Đang khởi tạo hệ thống Camera quét mã...");
    
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("scannerReader");
    }

    const config = { fps: 15, qrbox: { width: 220, height: 220 } };

    html5QrcodeScanner.start(
        { facingMode: "environment" },
        config,
        (qrCodeMessage) => {
            addLog("Đã bắt được tín hiệu QR Code!");
            stopQrScanner();
            
            try {
                let targetCode = "";
                if (qrCodeMessage.includes("?room=")) {
                    const urlObj = new URL(qrCodeMessage);
                    targetCode = urlObj.searchParams.get("room");
                } else {
                    targetCode = qrCodeMessage.trim();
                }

                if (targetCode && targetCode.length === 6) {
                    showToast(`Kết nối thành công phòng: ${targetCode}`);
                    processAutoJoin(targetCode);
                } else {
                    showToast("Mã QR không khớp cấu trúc ứng dụng");
                }
            } catch (err) {
                showToast("Lỗi phân giải QR");
            }
        },
        (errorMessage) => {}
    ).catch((err) => {
        addLog("Lỗi! Không truy cập được Camera thiết bị.");
        showToast("Lỗi mở Camera");
        scannerModal.classList.remove("active");
    });
});

closeScanBtn.addEventListener("click", () => { stopQrScanner(); });

function stopQrScanner() {
    scannerModal.classList.remove("active");
    if (html5QrcodeScanner && html5QrcodeScanner.isScanning) {
        html5QrcodeScanner.stop().then(() => {
            addLog("Đã giải phóng Camera an toàn");
        }).catch(err => console.error(err));
    }
}

// =====================================================
// FILE HANDLING & SELECTION (MAX 50 FILES)
// =====================================================
fileInput.addEventListener("change", () => {
    if(!fileInput.files.length) return;
    
    if (fileInput.files.length > 50) {
        showToast("Chỉ được phép chọn tối đa 50 file một lúc!");
        fileInput.value = "";
        selectedFilesArray = [];
        fileName.textContent = "Chưa có file nào được chọn";
        return;
    }

    selectedFilesArray = Array.from(fileInput.files);
    
    if(selectedFilesArray.length === 1) {
        fileName.textContent = selectedFilesArray[0].name + " (" + formatSize(selectedFilesArray[0].size) + ")";
        addLog(`Đã chọn 1 file: ${selectedFilesArray[0].name}`);
    } else {
        let totalBytes = selectedFilesArray.reduce((sum, f) => sum + f.size, 0);
        fileName.innerHTML = `<span style="color:#22c55e; font-weight:700;">Danh sách: ${selectedFilesArray.length} tệp tin được chọn</span><br>` + 
                             `<span style="font-size:11px; color:#94a3b8;">Tổng dung lượng gốc: ${formatSize(totalBytes)}</span>`;
        addLog(`Đã tải nhóm gồm ${selectedFilesArray.length} file vào hàng đợi gửi gốc.`);
    }
});

// =====================================================
// SENDER: CREATE ROOM
// =====================================================
createRoomBtn.addEventListener("click", async () => {
    if(selectedFilesArray.length === 0){
        showToast("Vui lòng chọn file cần gửi trước");
        return;
    }

    isSender = true;
    setStatus("Đang khởi tạo phòng...", "#facc15");

    roomId = generateRoomCode();
    roomCode.textContent = roomId;
    generateRoomQR(roomId);

    const roomRef = ref(db, `rooms/${roomId}`);
    await set(roomRef, { createdAt: Date.now(), status: "waiting" });
    setStatus("Chờ máy nhận kết nối...");

    await createSenderPeer();
    watchConnectionState();
});

// =====================================================
// WEBRTC SENDER INITIALIZATION
// =====================================================
async function createSenderPeer(){
    const config = getTurnixIceConfig();
    peerConnection = new RTCPeerConnection(config);
    dataChannels = [];
    openChannelsCount = 0;

    const channelOptions = {
        ordered: true
    };

    for (let i = 0; i < numChannels; i++) {
        const channel = peerConnection.createDataChannel(`fileTransfer_${i}`, channelOptions);
        channel.binaryType = "arraybuffer";
        setupSenderChannelEvents(channel);
        dataChannels.push(channel);
    }

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        addLog(`🧊 ICE State: ${state}`);
        if (state === 'failed') {
            addLog('❌ ICE failed - Kiểm tra TURN server!');
        }
        if (state === 'connected' || state === 'completed') {
            addLog('✅ ICE kết nối thành công!');
        }
    };

    peerConnection.onicecandidate = async (event) => {
        if(!event.candidate) return;
        try {
            const candidateRef = push(ref(db, `rooms/${roomId}/offerCandidates`));
            await set(candidateRef, event.candidate.toJSON());
        } catch (e) { console.error(e); }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await update(ref(db, `rooms/${roomId}`), {
        offer: { type: offer.type, sdp: offer.sdp }
    });

    addLog(`Đã thiết lập đồng bộ hóa cấu hình đa luồng SCTP [HIGH STABLE MODE]`);
    listenForAnswer();
}

function setupSenderChannelEvents(channel) {
    channel.onopen = () => {
        openChannelsCount++;
        addLog(`Luồng [${channel.label}] đồng bộ mở`);
        
        if (openChannelsCount === numChannels && isSender) {
            if (unsubscribeAnswer) { unsubscribeAnswer(); unsubscribeAnswer = null; }
            if (unsubscribeReceiverCandidates) { unsubscribeReceiverCandidates(); unsubscribeReceiverCandidates = null; }
            
            transferMode.textContent = `${numChannels} Kênh Gửi`;
            
            if (isPaused) {
                isPaused = false;
                setStatus("Đã kết nối lại! Đang tiếp tục truyền tải...", "#3b82f6");
                sendCurrentFileSegments(); 
            } else if (!isTransferring) {
                isTransferring = true;
                currentSendingFileIdx = 0;
                currentSendingOffset = 0;
                currentSendingChunkIndex = 0;
                setStatus("Đang truyền dữ liệu...", "#3b82f6");
                setTimeout(() => { sendAllFilesSequentially(); }, 600);
            }
        }
    };
    channel.onclose = () => { addLog(`Luồng [${channel.label}] đóng`); };
    channel.onerror = (err) => { console.error(err); };
    
    channel.onmessage = (event) => {
        if (typeof event.data === "string") {
            const msg = JSON.parse(event.data);
            if (msg.type === "file_ack") {
                if (fileAckResolver) {
                    fileAckResolver(); 
                    fileAckResolver = null;
                }
            } else if (msg.type === "all_files_received") {
                if (allReceivedResolver) {
                    allReceivedResolver();
                    allReceivedResolver = null;
                }
            }
        }
    };
}

function listenForAnswer(){
    if (unsubscribeAnswer) { unsubscribeAnswer(); unsubscribeAnswer = null; }
    if (unsubscribeReceiverCandidates) { unsubscribeReceiverCandidates(); unsubscribeReceiverCandidates = null; }
    
    const roomRef = ref(db, `rooms/${roomId}`);
    unsubscribeAnswer = onValue(roomRef, async(snapshot)=>{
        const data = snapshot.val();
        if(!data || !data.answer) return;
        if (!peerConnection) return;
        if (isAnswering) return;
        
        const signalingState = peerConnection.signalingState;
        if (signalingState !== "have-local-offer") return;

        isAnswering = true;
        try {
            startConnectionTimeout();
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            addLog("✅ Đã đồng bộ Answer WebRTC");
        } catch (err) { 
            console.error("Lỗi setRemoteDescription:", err);
        } finally {
            isAnswering = false;
        }
    });

    unsubscribeReceiverCandidates = onValue(ref(db, `rooms/${roomId}/answerCandidates`), async(snapshot)=>{
        if (!peerConnection || !peerConnection.remoteDescription) return;
        
        snapshot.forEach(async(child)=>{
            try {
                const candidate = child.val();
                if (candidate) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch(err){ 
                if (err.name !== 'OperationError') {
                    console.error("Lỗi add ICE candidate:", err);
                }
            }
        });
    });
}

// =====================================================
// SEND FILES SEQUENTIALLY
// =====================================================
async function sendAllFilesSequentially() {
    transferStartTime = Date.now();
    addLog(`Bắt đầu truyền tải tuần tự...`);

    const allReceivedPromise = new Promise((resolve) => {
        allReceivedResolver = resolve;
    });

    for (; currentSendingFileIdx < selectedFilesArray.length; currentSendingFileIdx++) {
        if (isPaused) {
            await new Promise(r => {
                const interval = setInterval(() => {
                    if (!isPaused) { clearInterval(interval); r(); }
                }, 500);
            });
        }

        currentSendingOffset = 0;
        currentSendingChunkIndex = 0;
        
        const file = selectedFilesArray[currentSendingFileIdx];
        addLog(`[${currentSendingFileIdx + 1}/${selectedFilesArray.length}] Truyền file: ${file.name} (${formatSize(file.size)})`);
        
        const fileAckPromise = new Promise((resolve) => {
            fileAckResolver = resolve;
        });

        dataChannels[0].send(JSON.stringify({
            type: "metadata",
            name: file.name,
            size: file.size,
            totalChunks: Math.ceil(file.size / chunkSize),
            fileIndex: currentSendingFileIdx,
            isLastFile: (currentSendingFileIdx === selectedFilesArray.length - 1)
        }));

        await sendCurrentFileSegments();
        
        if (isPaused) {
            await new Promise(r => {
                const interval = setInterval(() => {
                    if (!isPaused) { clearInterval(interval); r(); }
                }, 500);
            });
        }

        await new Promise(r => setTimeout(r, 40));

        dataChannels.forEach(chan => {
            if (chan.readyState === "open") {
                chan.send(JSON.stringify({ type: "file_complete" }));
            }
        });
        
        addLog(`Đợi máy nhận xác nhận file: ${file.name}...`);
        
        await fileAckPromise;
        addLog(`=> Đã xác nhận file: ${file.name}`);
    }

    addLog("Đã truyền xong toàn bộ file!");
    
    await allReceivedPromise;

    isTransferring = false;
    setStatus("Gửi thành công", "#22c55e");
    
    await cleanupRoom();

    showSuccessModal("🎁 Đã Hoàn Tất Gửi File 🎁", () => {
        resetTransfer();
    });
}

async function sendCurrentFileSegments() {
    const file = selectedFilesArray[currentSendingFileIdx];
    if (!file) return;

    while (currentSendingOffset < file.size) {
        if (isPaused) return; 

        const currentChannel = dataChannels[currentSendingChunkIndex % numChannels];

        if (!currentChannel || currentChannel.readyState !== "open") {
            await new Promise(r => setTimeout(r, 5));
            continue;
        }

        if (currentChannel.bufferedAmount > 2 * 1024 * 1024) {
            await new Promise(r => setTimeout(r, 5)); 
            continue; 
        }

        const slice = file.slice(currentSendingOffset, currentSendingOffset + chunkSize);
        const buffer = await slice.arrayBuffer();

        const packet = new Uint8Array(4 + buffer.byteLength);
        const view = new DataView(packet.buffer);
        view.setUint32(0, currentSendingChunkIndex); 
        packet.set(new Uint8Array(buffer), 4);

        try {
            currentChannel.send(packet);
            currentSendingOffset += buffer.byteLength;
            currentSendingChunkIndex++;
            updateSendProgress(currentSendingOffset, file.size, file.name, currentSendingFileIdx + 1, selectedFilesArray.length);
        } catch (e) {
            console.error("Lỗi đẩy gói dữ liệu:", e);
            return;
        }
    }
}

async function initiateIceRestart() {
    if (!isSender || !peerConnection || isPaused) return;
    
    isPaused = true;
    openChannelsCount = 0;
    setStatus("Đường truyền gián đoạn! Đang kết nối lại...", "#facc15");
    
    try {
        const offer = await peerConnection.createOffer({ iceRestart: true });
        await peerConnection.setLocalDescription(offer);
        
        await update(ref(db, `rooms/${roomId}`), {
            offer: { type: offer.type, sdp: offer.sdp }
        });
        addLog("Đã phát tín hiệu ICE Restart");
    } catch (err) {
        console.error("Lỗi ICE Restart:", err);
    }
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
    setStatus("Tìm phòng truyền...", "#facc15");

    const roomRef = ref(db, `rooms/${roomId}`);
    const snap = await get(roomRef);

    if(!snap.exists()){
        showToast("Không tìm thấy mã phòng");
        setStatus("Sai mã phòng", "#ef4444");
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
        showToast("Phòng chưa sẵn sàng kết nối");
        return;
    }

    if (unsubscribeAnswer) { unsubscribeAnswer(); unsubscribeAnswer = null; }

    const config = getTurnixIceConfig();
    peerConnection = new RTCPeerConnection(config);
    bindReceiverEvents();

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection.iceConnectionState;
        addLog(`🧊 ICE State: ${state}`);
        if (state === 'failed') {
            addLog('❌ ICE failed - Kiểm tra TURN server!');
        }
        if (state === 'connected' || state === 'completed') {
            addLog('✅ ICE kết nối thành công!');
        }
    };

    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(roomData.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        await update(ref(db, `rooms/${roomId}`), {
            answer: { type: answer.type, sdp: answer.sdp },
            status: "connected"
        });
        addLog("✅ Đã gửi answer thành công");
    } catch (err) {
        console.error("Lỗi joinAsReceiver:", err);
        showToast("Lỗi kết nối, thử lại!");
        return;
    }

    listenOfferCandidates();
    listenForIceRestartOffer(); 
}

let currentFileIndex = 0;
let isLastFileSignal = false;

function bindReceiverEvents() {
    dataChannels = [];
    peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        channel.binaryType = "arraybuffer";
        dataChannels.push(channel);
        
        channel.onopen = () => {
            if (unsubscribeOffer) { unsubscribeOffer(); unsubscribeOffer = null; }
            if (unsubscribeSenderCandidates) { unsubscribeSenderCandidates(); unsubscribeSenderCandidates = null; }
            
            transferMode.textContent = `Kênh Nhận`;
            setStatus("Đang nhận file...", "#3b82f6");
            if(isPaused) {
                isPaused = false;
                addLog("Đã thiết lập lại luồng nhận!");
            }
        };

        channel.onmessage = (e) => {
            handleIncomingMultiChannelData(e, channel);
        };
    };

    peerConnection.onicecandidate = async(event)=>{
        if(!event.candidate) return;
        try {
            const candidateRef = push(ref(db, `rooms/${roomId}/answerCandidates`));
            await set(candidateRef, event.candidate.toJSON());
        } catch (e) { console.error(e); }
    };
}

function listenOfferCandidates(){
    if (unsubscribeSenderCandidates) { unsubscribeSenderCandidates(); unsubscribeSenderCandidates = null; }
    
    unsubscribeSenderCandidates = onValue(ref(db, `rooms/${roomId}/offerCandidates`), (snapshot)=>{
        if (!peerConnection || !peerConnection.remoteDescription) return;
        
        snapshot.forEach(async(child)=>{
            try {
                const candidate = child.val();
                if (candidate) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                }
            } catch(err){ 
                if (err.name !== 'OperationError') {
                    console.error("Lỗi add ICE candidate:", err);
                }
            }
        });
    });
}

function listenForIceRestartOffer() {
    if (unsubscribeOffer) { unsubscribeOffer(); unsubscribeOffer = null; }

    const roomRef = ref(db, `rooms/${roomId}`);
    unsubscribeOffer = onValue(roomRef, async (snapshot) => {
        const data = snapshot.val();
        if (!data || !data.offer) return;
        if (!peerConnection) return;
        
        const currentOfferSdp = peerConnection.localDescription?.sdp;
        if (currentOfferSdp && data.offer.sdp === currentOfferSdp) return;

        const signalingState = peerConnection.signalingState;
        if (signalingState !== "have-local-offer" && signalingState !== "stable") return;

        addLog("Phát hiện ICE Restart...");
        isPaused = true;
        setStatus("Đang kết nối lại...", "#facc15");

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            await update(ref(db, `rooms/${roomId}`), {
                answer: { type: answer.type, sdp: answer.sdp }
            });
            addLog("✅ Đã trả về cấu hình mới");
        } catch (err) {
            console.error("Lỗi ICE Restart:", err);
        }
    });
}

// =====================================================
// RECEIVER: HANDLE INCOMING DATA
// =====================================================
function handleIncomingMultiChannelData(event, activeChannel) {
    if (typeof event.data === "string") {
        const msg = JSON.parse(event.data);

        if (msg.type === "metadata") {
            if (expectedFileName !== msg.name) {
                expectedFileName = msg.name;
                expectedFileSize = msg.size;
                totalExpectedChunks = msg.totalChunks;
                currentFileIndex = msg.fileIndex;
                isLastFileSignal = msg.isLastFile;
                
                receiveBuffers = {};
                receivedChunksCount = 0;
                receiveSize = 0;
                transferStartTime = Date.now(); 
                addLog(`Đang nhận file [${currentFileIndex + 1}]: ${expectedFileName} (${formatSize(expectedFileSize)})...`);
            }
            return;
        }

        if (msg.type === "file_complete") {
            saveReceivedFileDirectly(activeChannel);
            return;
        }
        return;
    }

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
}

function saveReceivedFileDirectly(activeChannel) {
    if (receivedChunksCount === 0 || receivedChunksCount < totalExpectedChunks) return;
    
    addLog(`Đang ghi dữ liệu xuống thiết bị: ${expectedFileName}`);
    
    const sortedBuffers = [];
    for (let i = 0; i < totalExpectedChunks; i++) {
        if (receiveBuffers[i]) {
            sortedBuffers.push(receiveBuffers[i]);
        }
    }

    const receivedBlob = new Blob(sortedBuffers);
    const fileObjectURL = URL.createObjectURL(receivedBlob);
    
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = fileObjectURL;
    downloadAnchor.download = expectedFileName;
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    
    document.body.removeChild(downloadAnchor);
    URL.revokeObjectURL(fileObjectURL);
    
    addLog(`Đã lưu thành công: ${expectedFileName}`);
    showToast(`Đã lưu xong: ${expectedFileName}`);
    
    receiveBuffers = {};
    receivedChunksCount = 0;
    totalExpectedChunks = 0;
    receiveSize = 0;
    expectedFileName = ""; 

    if (activeChannel && activeChannel.readyState === "open") {
        activeChannel.send(JSON.stringify({ type: "file_ack", index: currentFileIndex }));
        
        if (isLastFileSignal) {
            addLog("Đã nhận đủ toàn bộ file! Phát tín hiệu kết thúc...");
            setTimeout(() => {
                if (activeChannel.readyState === "open") {
                    activeChannel.send(JSON.stringify({ type: "all_files_received" }));
                }
                
                showSuccessModal("🎁 Đã Nhận Đủ Dữ Liệu 🎁", () => {
                    resetTransfer();
                });
            }, 300);
        }
    }
}

// =====================================================
// PROGRESS HELPERS
// =====================================================
function updateSendProgress(sent, total, currentName, fileIdx, totalFiles){
    const percent = Math.floor(sent / total * 100);
    progressBar.style.width = percent + "%";
    progressPercent.textContent = percent + "%";
    transferSize.textContent = `${formatSize(sent)} / ${formatSize(total)} (File ${fileIdx}/${totalFiles})`;
    fileName.textContent = `[Gửi ${fileIdx}/${totalFiles}] ${currentName}`;

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
    fileName.textContent = `[Nhận] ${expectedFileName}`;

    const elapsed = (Date.now() - transferStartTime) / 1000;
    const speed = receiveSize / Math.max(elapsed, 0.1);
    transferSpeed.textContent = formatSize(speed) + "/s";
    
    const remain = (expectedFileSize - receiveSize) / Math.max(speed, 1);
    remainingTime.textContent = formatTime(remain);
}

// =====================================================
// GENERAL HELPERS
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
    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection.connectionState;
        addLog(`Trạng thái kênh: ${state.toUpperCase()}`);
        
        if(state === "connected") {
            clearConnectionTimeout();
        } else if (state === "disconnected" || state === "failed") {
            if (isSender) {
                initiateIceRestart(); 
            } else {
                isPaused = true;
                setStatus("Mất tín hiệu máy gửi! Đang đợi phục hồi...", "#facc15");
            }
        }
    };
}

let connectionTimeout = null;
function startConnectionTimeout(){
    clearConnectionTimeout();
    connectionTimeout = setTimeout(()=>{
        if(!peerConnection || peerConnection.connectionState !== "connected"){
            setStatus("Hết thời gian chờ", "#ef4444");
            showToast("Hết hạn thời gian chờ kết nối");
        }
    }, 90000); 
}

function clearConnectionTimeout(){
    if(connectionTimeout){ clearTimeout(connectionTimeout); connectionTimeout = null; }
}

async function cleanupRoom(){
    try{
        if(roomId){
            await remove(ref(db, `rooms/${roomId}`));
            addLog("Đã giải phóng tài nguyên phòng trên Firebase");
        }
    }catch(err){ console.error(err); }
}

function resetTransfer(){
    // Cleanup listeners đúng cách
    if (unsubscribeAnswer) { 
        unsubscribeAnswer(); 
        unsubscribeAnswer = null; 
    }
    if (unsubscribeOffer) { 
        unsubscribeOffer(); 
        unsubscribeOffer = null; 
    }
    if (unsubscribeSenderCandidates) { 
        unsubscribeSenderCandidates(); 
        unsubscribeSenderCandidates = null; 
    }
    if (unsubscribeReceiverCandidates) { 
        unsubscribeReceiverCandidates(); 
        unsubscribeReceiverCandidates = null; 
    }
    
    // Đóng peer connection nếu còn
    if (peerConnection) {
        try {
            peerConnection.close();
        } catch(e) {}
        peerConnection = null;
    }
    
    dataChannels = [];
    openChannelsCount = 0;
    receiveBuffers = {};
    receivedChunksCount = 0;
    totalExpectedChunks = 0;
    receiveSize = 0;
    expectedFileSize = 0;
    expectedFileName = "";
    selectedFilesArray = [];
    
    isTransferring = false;
    isPaused = false;
    currentSendingFileIdx = 0;
    currentSendingOffset = 0;
    currentSendingChunkIndex = 0;
    fileAckResolver = null;
    allReceivedResolver = null;
    
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    transferSize.textContent = "0 MB";
    transferSpeed.textContent = "0 MB/s";
    remainingTime.textContent = "--";
    transferMode.textContent = "Idle";
    qrArea.style.display = "none";
    fileName.textContent = "Chưa có file nào được chọn";
}

window.addEventListener("beforeunload", async()=>{ try{ await cleanupRoom(); }catch(e){} });

checkURLParameters();
setStatus("Sẵn sàng", "#22c55e");
resetTransfer();