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
let selectedFilesArray = []; // Chứa danh sách mảng các file gốc người dùng chọn
let finalZipBlob = null;      // Chứa tệp tin nén nhị phân tổng hợp cuối cùng
let roomId = null;
let isSender = false;
let peerConnection = null;
let html5QrcodeScanner = null;

// Cấu hình truyền tải đa luồng SCTP tăng tốc độ băng thông tối đa
const numChannels = 3; 
let dataChannels = [];
let openChannelsCount = 0;

// Bộ đệm gom mảnh dữ liệu nhị phân nhận về từ xa
let receiveBuffers = {}; 
let receivedChunksCount = 0;
let totalExpectedChunks = 0;
let receiveSize = 0;
let expectedFileSize = 0;
let expectedFileName = "";
let transferStartTime = 0;
let unsubscribeAnswer = null;

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
// FILE HANDLING & SELECTION
// =====================================================
fileInput.addEventListener("change", () => {
    if(!fileInput.files.length) return;
    
    selectedFilesArray = Array.from(fileInput.files);
    
    if(selectedFilesArray.length === 1) {
        fileName.textContent = selectedFilesArray[0].name + " (" + formatSize(selectedFilesArray[0].size) + ")";
        addLog(`Đã chọn file đơn lẻ: ${selectedFilesArray[0].name}`);
    } else {
        let totalBytes = selectedFilesArray.reduce((sum, f) => sum + f.size, 0);
        fileName.innerHTML = `<span style="color:#22c55e; font-weight:700;">Danh sách: ${selectedFilesArray.length} tệp tin được chọn</span><br>` + 
                             `<span style="font-size:11px; color:#94a3b8;">Tổng trọng lượng tệp: ${formatSize(totalBytes)}</span>`;
        addLog(`Đã tải nhóm gồm ${selectedFilesArray.length} file lên bộ nhớ đệm.`);
    }
});

// =====================================================
// SENDER: CREATE ROOM & AUTO ZIP PACKAGING
// =====================================================
createRoomBtn.addEventListener("click", async () => {
    if(selectedFilesArray.length === 0){
        showToast("Vui lòng chọn file cần gửi trước");
        return;
    }

    isSender = true;
    
    try {
        // Kiểm tra nếu chỉ có 1 file duy nhất và file đó đã có sẵn định dạng nén mở rộng .zip
        if (selectedFilesArray.length === 1 && selectedFilesArray[0].name.toLowerCase().endsWith('.zip')) {
            setStatus("Đang chuẩn bị file zip gốc...", "#facc15");
            finalZipBlob = selectedFilesArray[0]; // Gán trực tiếp không qua JSZip nữa
            addLog(`Phát hiện tệp nén sẵn: ${finalZipBlob.name}. Bỏ qua tiến trình đóng gói phụ.`);
        } else {
            setStatus("Đang đóng gói dữ liệu...", "#facc15");
            const zip = new JSZip();
            
            // Đẩy toàn bộ danh sách tệp tin vào cây thư mục của gói nén dạng RAM Stream
            selectedFilesArray.forEach(file => {
                zip.file(file.name, file);
            });
            
            // Xuất định dạng luồng nhị phân Blob nén ở cấp độ tối ưu cân bằng RAM xử lý nhanh
            finalZipBlob = await zip.generateAsync({
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: { level: 4 }
            });
            
            addLog(`Đóng gói nhóm file hoàn tất! Dung lượng luồng nén: ${formatSize(finalZipBlob.size)}`);
        }
    } catch (err) {
        console.error(err);
        showToast("Lỗi xử lý tệp tin");
        setStatus("Lỗi đóng gói", "#ef4444");
        return;
    }

    roomId = generateRoomCode();
    roomCode.textContent = roomId;
    generateRoomQR(roomId);

    setStatus("Đang tạo phòng...");
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

    addLog(`Đã thiết lập đồng bộ hóa cấu hình đa luồng SCTP song song`);
    listenForAnswer();
}

function setupSenderChannelEvents(channel) {
    channel.onopen = () => {
        openChannelsCount++;
        addLog(`Luồng dữ liệu sổ [${channel.label}] đồng bộ mở`);
        if (openChannelsCount === numChannels && isSender) {
            setStatus("Đang truyền dữ liệu...", "#3b82f6");
            transferMode.textContent = `${numChannels} Kênh Gửi`;
            setTimeout(() => { sendFileMultiChannel(); }, 600);
        }
    };
    channel.onclose = () => { addLog(`Luồng [${channel.label}] đóng`); };
    channel.onerror = (err) => { console.error(err); };
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

async function sendFileMultiChannel() {
    if (!finalZipBlob) return;

    transferStartTime = Date.now();
    addLog(`Bắt đầu bẻ mảnh truyền gói tin nén đa kênh song song...`);

    // Thiết lập tên file động: Giữ tên gốc nếu đã là zip, ngược lại đặt tên package mặc định
    const outputName = (selectedFilesArray.length === 1 && selectedFilesArray[0].name.toLowerCase().endsWith('.zip')) 
                       ? selectedFilesArray[0].name 
                       : `package_${roomId}.zip`;

    // Gửi thông số metadata định hình trước luồng dữ liệu cho bên nhận xử lý ngầm
    dataChannels[0].send(JSON.stringify({
        type: "metadata",
        name: outputName,
        size: finalZipBlob.size,
        totalChunks: Math.ceil(finalZipBlob.size / chunkSize)
    }));

    let offset = 0;
    let chunkIndex = 0;

    while (offset < finalZipBlob.size) {
        const currentChannel = dataChannels[chunkIndex % numChannels];

        if (currentChannel.bufferedAmount > 1024 * 1024) {
            await new Promise(r => setTimeout(r, 25));
            continue; 
        }

        const slice = finalZipBlob.slice(offset, offset + chunkSize);
        const buffer = await slice.arrayBuffer();

        const packet = new Uint8Array(4 + buffer.byteLength);
        const view = new DataView(packet.buffer);
        view.setUint32(0, chunkIndex); 
        packet.set(new Uint8Array(buffer), 4);

        currentChannel.send(packet);

        offset += buffer.byteLength;
        chunkIndex++;

        updateSendProgress(offset, finalZipBlob.size);
    }

    dataChannels.forEach(chan => {
        if (chan.readyState === "open") {
            chan.send(JSON.stringify({ type: "complete" }));
        }
    });

    addLog("Đã đẩy toàn bộ khối phân mảnh dữ liệu thành công");
    setStatus("Gửi thành công", "#22c55e");

    setTimeout(async () => {
        await cleanupRoom();
        resetTransfer();
    }, 4000);
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

    peerConnection.ondatachannel = (event) => {
        const channel = event.channel;
        channel.binaryType = "arraybuffer";
        dataChannels.push(channel);
        
        channel.onopen = () => {
            transferMode.textContent = `Kênh Nhận Stream`;
            setStatus("Đang nhận file...", "#3b82f6");
            transferStartTime = Date.now();
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
// RECEIVER: STREAM RECEIVE & AUTO EXTRACT TO DOWNLOADS
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
            addLog(`Bắt đầu tiếp nhận luồng dữ liệu đóng gói...`);
            return;
        }

        if (msg.type === "complete") {
            if (receivedChunksCount === totalExpectedChunks && totalExpectedChunks > 0) {
                processExtractAndBungFiles();
            }
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

    if (receivedChunksCount === totalExpectedChunks && totalExpectedChunks > 0) {
        processExtractAndBungFiles();
    }
}

// Hàm cốt lõi xử lý bung file ngầm trực tiếp ra thư mục Download của người nhận
async function processExtractAndBungFiles() {
    if (totalExpectedChunks === 0) return; 
    totalExpectedChunks = 0; 

    setStatus("Đang giải nén ngầm...", "#facc15");
    addLog("Đang kết nối tổ hợp cấu trúc nhị phân và tự động bung file ra máy...");
    
    const sortedBuffers = [];
    const totalKeys = Object.keys(receiveBuffers).length;
    
    for (let i = 0; i < totalKeys; i++) {
        sortedBuffers.push(receiveBuffers[i]);
    }

    const finalZipBlobObj = new Blob(sortedBuffers);

    try {
        // Nạp khối gói nén vào RAM xử lý của JSZip
        const zip = await JSZip.loadAsync(finalZipBlobObj);
        const fileKeys = Object.keys(zip.files);
        
        addLog(`Tìm thấy tổng số ${fileKeys.length} tệp tin trong gói truyền tải.`);

        // Lặp qua từng file đơn lẻ trong gói nén, trích xuất ngược thành Blob gốc rồi kích hoạt lệnh tải tự động
        for (const filename of fileKeys) {
            const currentZipFile = zip.files[filename];
            
            // Bỏ qua nếu là cấu trúc thư mục rỗng ngầm
            if (currentZipFile.dir) continue;

            const fileDataBlob = await currentZipFile.async("blob");
            const fileObjectURL = URL.createObjectURL(fileDataBlob);
            
            // Tạo thẻ liên kết tải xuống ảo để đưa file thẳng vào mục Downloads của trình duyệt người dùng
            const downloadAnchor = document.createElement("a");
            downloadAnchor.href = fileObjectURL;
            downloadAnchor.download = filename;
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            
            // Thu hồi bộ nhớ RAM đệm ngay lập tức sau khi kích hoạt lệnh tải để tránh tràn bộ nhớ
            document.body.removeChild(downloadAnchor);
            URL.revokeObjectURL(fileObjectURL);
            
            addLog(`Đã bung và tải thành công tệp: ${filename}`);
        }
        
        showToast(`Đã nhận trọn vẹn ${fileKeys.length} file vào thư mục Download!`);
        setStatus("Nhận thành công", "#22c55e");
        
    } catch (err) {
        console.error("Lỗi trích xuất gói dữ liệu:", err);
        addLog("Có lỗi bung file! Tiến hành xuất file gói nén dự phòng...");
        
        // Cơ chế fallback dự phòng: Nếu thiết bị cấu hình quá yếu hoặc nhận thẳng file zip gốc (đã bypass nén ban đầu), tải trực tiếp về máy.
        const backupUrl = URL.createObjectURL(finalZipBlobObj);
        const backupAnchor = document.createElement("a");
        backupAnchor.href = backupUrl;
        backupAnchor.download = expectedFileName;
        backupAnchor.click();
        URL.revokeObjectURL(backupUrl);
        setStatus("Nhận dự phòng", "#22c55e");
    }

    progressBar.style.width = "100%";
    progressPercent.textContent = "100%";

    setTimeout(async () => {
        await cleanupRoom();
        resetTransfer();
    }, 4000);
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
        } else if (state === "failed" || state === "disconnected") {
            setStatus("Ngắt kết nối", "#ef4444");
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
    }, 60000); 
}

function clearConnectionTimeout(){
    if(connectionTimeout){ clearTimeout(connectionTimeout); connectionTimeout = null; }
}

async function cleanupRoom(){
    try{
        if(roomId){
            await remove(ref(db, `rooms/${roomId}`));
            addLog("Đã giải phóng tài nguyên phòng truyền trên Firebase");
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
    finalZipBlob = null;
    
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    transferSize.textContent = "0 MB";
    transferSpeed.textContent = "0 MB/s";
    remainingTime.textContent = "--";
    transferMode.textContent = "Idle";
    qrArea.style.display = "none";
    fileName.textContent = "Chưa có file nào được chọn";
    
    if(unsubscribeAnswer) { unsubscribeAnswer(); unsubscribeAnswer = null; }
}

window.addEventListener("beforeunload", async()=>{ try{ await cleanupRoom(); }catch(e){} });

checkURLParameters();
setStatus("Sẵn sàng", "#22c55e");
resetTransfer();