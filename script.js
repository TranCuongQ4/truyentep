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

// Cấu hình truyền tải đa luồng SCTP tăng tốc độ băng thông tối đa
const numChannels = 3; 
let dataChannels = [];
let openChannelsCount = 0;

// Bộ đệm gom mảnh dữ liệu nhị phân nhận về từ xa cho từng file lẻ
let receiveBuffers = {}; 
let receivedChunksCount = 0;
let totalExpectedChunks = 0;
let receiveSize = 0;
let expectedFileSize = 0;
let expectedFileName = "";
let transferStartTime = 0;
let unsubscribeAnswer = null;
let unsubscribeOffer = null;

// Quản lý trạng thái truyền tải khi mất kết nối mạng đột ngột
let isTransferring = false;
let isPaused = false;
let currentSendingFileIdx = 0;
let currentSendingOffset = 0;
let currentSendingChunkIndex = 0;

const chunkSize = 16 * 1024; // Kích thước khối chunk dữ liệu tiêu chuẩn WebRTC 16KB

const rtcConfig = {
    iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302", "stun:stun3.l.google.com:19302", "stun:stun4.l.google.com:19302"] }
    ],
    iceCandidatePoolSize: 10
};

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
// SENDER: CREATE ROOM (NO ZIP COMPRESSION)
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
    peerConnection = new RTCPeerConnection(rtcConfig);
    dataChannels = [];
    openChannelsCount = 0;

    // Khởi tạo các kênh dữ liệu luồng
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
        } catch (e) { console.error(e); }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await update(ref(db, `rooms/${roomId}`), {
        offer: { type: offer.type, sdp: offer.sdp }
    });

    addLog(`Đã thiết lập đồng bộ hóa cấu hình đa luồng SCTP song parallel`);
    listenForAnswer();
}

function setupSenderChannelEvents(channel) {
    channel.onopen = () => {
        openChannelsCount++;
        addLog(`Luồng dữ liệu sổ [${channel.label}] đồng bộ mở`);
        
        if (openChannelsCount === numChannels && isSender) {
            transferMode.textContent = `${numChannels} Kênh Gửi`;
            
            if (isPaused) {
                // Phục hồi kết nối sau khi rớt mạng thành công
                isPaused = false;
                setStatus("Đã kết nối lại! Đang tiếp tục truyền tải...", "#3b82f6");
                sendCurrentFileSegments(); 
            } else if (!isTransferring) {
                // Bắt đầu tiến trình gửi lần đầu tiên
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
}

function listenForAnswer(){
    const roomRef = ref(db, `rooms/${roomId}`);
    if (unsubscribeAnswer) unsubscribeAnswer();
    
    unsubscribeAnswer = onValue(roomRef, async(snapshot)=>{
        const data = snapshot.val();
        if(!data || !data.answer) return;
        
        // Chấp nhận cấu hình Remote Description mới kể cả khi đang kết nối lại (ICE Restart)
        if(peerConnection.signalingState === "stable" && !isPaused) return;

        try {
            startConnectionTimeout();
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            addLog("Đã đồng bộ thành công kênh phản hồi (Answer WebRTC)");
        } catch (err) { console.error(err); }
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

// Hàm quản lý vòng lặp gửi tuần tự toàn bộ danh sách file gốc
async function sendAllFilesSequentially() {
    transferStartTime = Date.now();
    addLog(`Bắt đầu truyền tải tuần tự từng file nguyên mẫu trong danh sách...`);

    for (; currentSendingFileIdx < selectedFilesArray.length; currentSendingFileIdx++) {
        if (isPaused) return; // Ngắt tiến trình vòng lặp nếu phát hiện mất mạng

        currentSendingOffset = 0;
        currentSendingChunkIndex = 0;
        
        const file = selectedFilesArray[currentSendingFileIdx];
        addLog(`[${currentSendingFileIdx + 1}/${selectedFilesArray.length}] Đang gửi file: ${file.name} (${formatSize(file.size)})`);
        
        // Gửi tín hiệu báo bắt đầu một file mới (Metadata)
        dataChannels[0].send(JSON.stringify({
            type: "metadata",
            name: file.name,
            size: file.size,
            totalChunks: Math.ceil(file.size / chunkSize)
        }));

        await sendCurrentFileSegments();
        if (isPaused) return; 

        // Đợi một khoảng ngắn trước khi gửi tín hiệu hoàn thành file này để chắc chắn data đã đi hết
        await new Promise(r => setTimeout(r, 100));

        // Báo kết thúc thành công 1 file đơn lẻ
        dataChannels.forEach(chan => {
            if (chan.readyState === "open") {
                chan.send(JSON.stringify({ type: "file_complete" }));
            }
        });
        
        addLog(`Đã gửi xong file: ${file.name}`);
    }

    isTransferring = false;
    setStatus("Gửi thành công", "#22c55e");
    showToast("Đã gửi toàn bộ file thành công!");

    setTimeout(async () => {
        await cleanupRoom();
        resetTransfer();
    }, 4000);
}

// Hàm chịu trách nhiệm trực tiếp đẩy từng mảnh chunk dữ liệu của file hiện tại
async function sendCurrentFileSegments() {
    const file = selectedFilesArray[currentSendingFileIdx];
    if (!file) return;

    while (currentSendingOffset < file.size) {
        if (isPaused) return; // Dừng ngay vòng lặp đẩy chunk nếu mạng lỗi

        const currentChannel = dataChannels[currentSendingChunkIndex % numChannels];

        if (!currentChannel || currentChannel.readyState !== "open") {
            await new Promise(r => setTimeout(r, 50));
            continue;
        }

        // Chống tràn bộ đệm WebRTC
        if (currentChannel.bufferedAmount > 1024 * 1024) {
            await new Promise(r => setTimeout(r, 20));
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
            console.error("Lỗi khi đẩy gói dữ liệu thô:", e);
            return;
        }
    }
}

// Hàm kích hoạt ICE Restart phía máy Gửi khi phát hiện mất kết nối mạng
async function initiateIceRestart() {
    if (!isSender || !peerConnection || isPaused) return;
    
    isPaused = true;
    openChannelsCount = 0;
    setStatus("Đường truyền gián đoạn! Đang tìm cách kết nối lại...", "#facc15");
    
    try {
        // Tạo Offer mới tích hợp cờ quét và cập nhật lại đường truyền ICE Restart
        const offer = await peerConnection.createOffer({ iceRestart: true });
        await peerConnection.setLocalDescription(offer);
        
        await update(ref(db, `rooms/${roomId}`), {
            offer: { type: offer.type, sdp: offer.sdp }
        });
        addLog("Đã phát đi tín hiệu ICE Restart lên tổng đài Firebase.");
    } catch (err) {
        console.error("Lỗi khởi tạo cấu hình tái lập mạng:", err);
    }
}

// =====================================================
// RECEIVER: JOIN ROOM & CONNECTION SETUP
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

    peerConnection = new RTCPeerConnection(rtcConfig);
    bindReceiverEvents();

    await peerConnection.setRemoteDescription(new RTCSessionDescription(roomData.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    await update(ref(db, `rooms/${roomId}`), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: "connected"
    });

    listenOfferCandidates();
    listenForIceRestartOffer(); // Lắng nghe tín hiệu Restart từ máy gửi
}

function bindReceiverEvents() {
    dataChannels = [];
    peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        channel.binaryType = "arraybuffer";
        dataChannels.push(channel);
        
        channel.onopen = () => {
            transferMode.textContent = `Kênh Nhận Stream`;
            setStatus("Đang nhận file...", "#3b82f6");
            if(isPaused) {
                isPaused = false;
                addLog("Đã thiết lập lại luồng nhận dữ liệu kế thừa thành công!");
            }
        };

        channel.onmessage = handleIncomingMultiChannelData;
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

// Phía máy nhận lắng nghe xem máy gửi có thực hiện Reset mạng (ICE Restart) hay không
function listenForIceRestartOffer() {
    const roomRef = ref(db, `rooms/${roomId}`);
    if (unsubscribeOffer) unsubscribeOffer();

    unsubscribeOffer = onValue(roomRef, async (snapshot) => {
        const data = snapshot.val();
        if (!data || !data.offer) return;

        // Nếu chuỗi SDP có sự thay đổi (chứa mã kết nối mạng mới từ máy gửi)
        if (peerConnection.remoteDescription && data.offer.sdp !== peerConnection.remoteDescription.sdp) {
            addLog("Phát hiện máy gửi đang thiết lập lại luồng mạng (ICE Restart)...");
            isPaused = true;
            setStatus("Đang kết nối lại...", "#facc15");

            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);

                await update(ref(db, `rooms/${roomId}`), {
                    answer: { type: answer.type, sdp: answer.sdp }
                });
                addLog("Đã trả về cấu hình xác nhận mạng mới thành công.");
            } catch (err) {
                console.error("Lỗi đồng bộ cấu hình ICE Restart phía nhận:", err);
            }
        }
    });
}

// =====================================================
// RECEIVER: STREAM RECEIVE & AUTO DOWNLOAD ORIGINALS
// =====================================================
function handleIncomingMultiChannelData(event) {
    if (typeof event.data === "string") {
        const msg = JSON.parse(event.data);

        if (msg.type === "metadata") {
            // Chỉ khởi tạo lại bộ đệm nếu nhận được file hoàn toàn mới
            if (expectedFileName !== msg.name) {
                expectedFileName = msg.name;
                expectedFileSize = msg.size;
                totalExpectedChunks = msg.totalChunks;
                receiveBuffers = {};
                receivedChunksCount = 0;
                receiveSize = 0;
                addLog(`Đang nhận file mới: ${expectedFileName} (${formatSize(expectedFileSize)})...`);
            } else {
                addLog(`Khớp thông tin Metadata cũ. Đang tiếp tục tải mảnh kế thừa...`);
            }
            return;
        }

        if (msg.type === "file_complete") {
            saveReceivedFileDirectly();
            return;
        }
        return;
    }

    const buffer = event.data;
    const view = new DataView(buffer);
    const chunkIndex = view.getUint32(0); 
    const rawData = buffer.slice(4); 

    // Bộ đệm Map Key giúp chống ghi đè trùng lặp hoặc sai lệch thứ tự chunk khi mạng chập chờn
    if (!receiveBuffers[chunkIndex]) {
        receiveBuffers[chunkIndex] = rawData;
        receivedChunksCount++;
        receiveSize += rawData.byteLength;
        updateReceiveProgress();
    }
}

function saveReceivedFileDirectly() {
    if (receivedChunksCount === 0) return;
    
    addLog(`Đang ghi file nguyên mẫu xuống ổ đĩa: ${expectedFileName}`);
    
    const sortedBuffers = [];
    const totalKeys = Object.keys(receiveBuffers).length;
    
    for (let i = 0; i < totalKeys; i++) {
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
    
    addLog(`Đã tải xuống thành công file gốc: ${expectedFileName}`);
    showToast(`Đã nhận xong: ${expectedFileName}`);
    
    receiveBuffers = {};
    receivedChunksCount = 0;
    totalExpectedChunks = 0;
    receiveSize = 0;
    expectedFileName = ""; // Xóa tên cũ để sẵn sàng đón nhận tệp tin tiếp theo hoàn toàn sạch sẽ
}

// =====================================================
// PROGRESS CALCULATION HELPERS
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
    peerConnection.onconnectionstatechange = ()=>{
        const state = peerConnection.connectionState;
        addLog(`Trạng thái kênh: ${state.toUpperCase()}`);
        
        if(state === "connected") {
            clearConnectionTimeout();
        } else if (state === "disconnected" || state === "failed") {
            if (isSender) {
                initiateIceRestart(); // Nếu là người gửi, kích hoạt quy trình nối lại mạng
            } else {
                isPaused = true;
                setStatus("Mất tín hiệu máy gửi! Đang đợi phục hồi mạng...", "#facc15");
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
    }, 90000); // Tăng thời gian chờ lên 90 giây để hai bên có đủ thời gian bắt sóng lại
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
    
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    transferSize.textContent = "0 MB";
    transferSpeed.textContent = "0 MB/s";
    remainingTime.textContent = "--";
    transferMode.textContent = "Idle";
    qrArea.style.display = "none";
    fileName.textContent = "Chưa có file nào được chọn";
    
    if(unsubscribeAnswer) { unsubscribeAnswer(); unsubscribeAnswer = null; }
    if(unsubscribeOffer) { unsubscribeOffer(); unsubscribeOffer = null; }
}

window.addEventListener("beforeunload", async()=>{ try{ await cleanupRoom(); }catch(e){} });

checkURLParameters();
setStatus("Sẵn sàng", "#22c55e");
resetTransfer();