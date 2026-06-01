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
let selectedFilesArray = []; // Mảng chứa danh sách các file gốc được chọn
let finalZipBlob = null;      // File Zip hoàn chỉnh sau khi đóng gói nhị phân
let roomId = null;
let isSender = false;
let peerConnection = null;
let qrInstance = null; 
let html5QrcodeScanner = null; 

// Cấu hình truyền đa luồng (SCTP Multi-Channel)
const numChannels = 3; 
let dataChannels = [];
let openChannelsCount = 0;

// Bộ đệm xử lý ghép dữ liệu nhị phân nhận về
let receiveBuffers = {}; 
let receivedChunksCount = 0;
let totalExpectedChunks = 0;
let receiveSize = 0;
let expectedFileSize = 0;
let expectedFileName = "";
let transferStartTime = 0;
let unsubscribeAnswer = null;

const chunkSize = 16 * 1024; // Khối chunk dữ liệu tối ưu 16KB

const rtcConfig = {
    iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302", "stun:stun3.l.google.com:19302", "stun:stun4.l.google.com:19302"] }
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
// AUTOMATIC QR CODE GENERATION WITH CDN
// =====================================================
function generateRoomQR(code) {
    const currentUrl = window.location.href.split('?')[0];
    const connectUrl = `${currentUrl}?room=${code}`;
    
    const qrContainer = document.getElementById("qrcode");
    qrContainer.innerHTML = ""; 
    
    qrInstance = new QRCode(qrContainer, {
        text: connectUrl,
        width: 140,
        height: 140,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    qrArea.style.display = "block";
    addLog("Đã khởi tạo đồ hoạ mã QR chia sẻ nhanh thành công");
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
    addLog(`Hệ thống tự động nạp mã phòng nhận diện được: ${code}`);
    setTimeout(() => { joinRoomBtn.click(); }, 800);
}

// =====================================================
// CAMERA QR SCANNER ENGINE (LIVE CAM)
// =====================================================
openScanBtn.addEventListener("click", () => {
    scannerModal.classList.add("active");
    addLog("Đang xin quyền truy cập Camera để quét mã QR...");
    
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5Qrcode("scannerReader");
    }

    const config = { fps: 15, qrbox: { width: 220, height: 220 } };

    html5QrcodeScanner.start(
        { facingMode: "environment" },
        config,
        (qrCodeMessage) => {
            addLog("Đã quét thành công dữ liệu QR!");
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
                    showToast(`Quét thành công phòng: ${targetCode}`);
                    processAutoJoin(targetCode);
                } else {
                    showToast("Mã QR không đúng định dạng phòng truyền file");
                    addLog("Dữ liệu QR không khớp cấu trúc 6 ký tự hệ thống.");
                }
            } catch (err) {
                console.error("Lỗi bóc tách QR:", err);
                showToast("Lỗi giải mã QR");
            }
        },
        (errorMessage) => {}
    ).catch((err) => {
        console.error("Không mở được camera:", err);
        addLog("Thất bại! Vui lòng cấp quyền Camera cho trình duyệt.");
        showToast("Không mở được Camera");
        scannerModal.classList.remove("active");
    });
});

closeScanBtn.addEventListener("click", () => {
    stopQrScanner();
});

function stopQrScanner() {
    scannerModal.classList.remove("active");
    if (html5QrcodeScanner && html5QrcodeScanner.isScanning) {
        html5QrcodeScanner.stop().then(() => {
            addLog("Đã tắt luồng Camera thiết bị an toàn");
        }).catch(err => console.error(err));
    }
}

// =====================================================
// FILE SELECTION (MULTI-FILE SUPPORT)
// =====================================================
fileInput.addEventListener("change", () => {
    if(!fileInput.files.length) return;
    
    selectedFilesArray = Array.from(fileInput.files);
    
    if(selectedFilesArray.length === 1) {
        fileName.textContent = selectedFilesArray[0].name + " (" + formatSize(selectedFilesArray[0].size) + ")";
        addLog(`Đã chọn 1 file: ${selectedFilesArray[0].name}`);
    } else {
        let totalBytes = selectedFilesArray.reduce((sum, f) => sum + f.size, 0);
        fileName.innerHTML = `<span style="color:#22c55e; font-weight:700;">Danh sách chọn (${selectedFilesArray.length} file)</span><br>` + 
                             `<span style="font-size:11px; color:#94a3b8;">Tổng dung lượng: ${formatSize(totalBytes)}</span>`;
        addLog(`Đã chọn nhóm gồm ${selectedFilesArray.length} file.`);
    }
});

// =====================================================
// SENDER: CREATE ROOM & AUTO COMPRESS ZIP
// =====================================================
createRoomBtn.addEventListener("click", async () => {
    if(selectedFilesArray.length === 0){
        showToast("Vui lòng chọn file trước");
        return;
    }

    isSender = true;
    
    // Tiến hành đóng gói nén luồng nhị phân trực tiếp bằng bộ nhớ client
    setStatus("Đang đóng gói dữ liệu...", "#facc15");
    try {
        const zip = new JSZip();
        
        // Đưa toàn bộ danh sách tệp tin vào bộ nhớ nén
        selectedFilesArray.forEach(file => {
            zip.file(file.name, file);
        });
        
        // Xuất ra dạng Blob nhị phân tối ưu nén nhanh (DEFLATE)
        finalZipBlob = await zip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 5 } // Cân bằng giữa tốc độ nén RAM và độ thu gọn dung lượng
        });
        
        addLog(`Đóng gói Zip thành công! Dung lượng luồng đích: ${formatSize(finalZipBlob.size)}`);
    } catch (err) {
        console.error("Lỗi đóng gói zip:", err);
        showToast("Lỗi nén tệp tin");
        setStatus("Lỗi đóng gói", "#ef4444");
        return;
    }

    roomId = generateRoomCode();
    roomCode.textContent = roomId;
    
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

    addLog(`Đã thiết lập xong ${numChannels} luồng truyền dẫn dữ liệu SCTP`);
    listenForAnswer();
}

function setupSenderChannelEvents(channel) {
    channel.onopen = () => {
        openChannelsCount++;
        addLog(`Luồng [${channel.label}] đã đồng bộ hoàn tất`);
        if (openChannelsCount === numChannels && isSender) {
            setStatus("Đã kết nối", "#22c55e");
            transferMode.textContent = `${numChannels} Luồng Gửi`;
            setTimeout(() => { sendFileMultiChannel(); }, 800);
        }
    };
    channel.onclose = () => { addLog(`Luồng [${channel.label}] đóng`); };
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
// SENDER: MULTI-CHANNEL DATA TRANSMISSION (ZIP BLOB)
// =====================================================
async function sendFileMultiChannel() {
    if (!finalZipBlob) return;

    transferStartTime = Date.now();
    addLog(`Đang đẩy dữ liệu đóng gói qua đa luồng song song...`);

    // Tên file hiển thị đại diện, nếu gửi nhiều file sẽ tự đặt tên có mốc thời gian rõ ràng
    let outName = selectedFilesArray.length === 1 ? selectedFilesArray[0].name : `Gói_tệp_tin_${roomId}.zip`;

    dataChannels[0].send(JSON.stringify({
        type: "metadata",
        name: outName,
        size: finalZipBlob.size,
        totalChunks: Math.ceil(finalZipBlob.size / chunkSize),
        isMultiFile: selectedFilesArray.length > 1
    }));

    let offset = 0;
    let chunkIndex = 0;

    while (offset < finalZipBlob.size) {
        const currentChannel = dataChannels[chunkIndex % numChannels];

        if (currentChannel.bufferedAmount > 1024 * 1024) {
            await new Promise(r => setTimeout(r, 30));
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

    addLog("Đã chuyển phát thành công toàn bộ phân mảnh file");
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

// =====================================================
// RECEIVER: DATA & METADATA RECEIVE HANDLING
// =====================================================
let isIncomingPackMultiFile = false; // Cờ theo dõi gói nhận về có phải dạng nhiều file nén không

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

function handleIncomingMultiChannelData(event) {
    if (typeof event.data === "string") {
        const msg = JSON.parse(event.data);

        if (msg.type === "metadata") {
            expectedFileName = msg.name;
            expectedFileSize = msg.size;
            totalExpectedChunks = msg.totalChunks;
            isIncomingPackMultiFile = !!msg.isMultiFile;
            receiveBuffers = {};
            receivedChunksCount = 0;
            receiveSize = 0;
            addLog(`Bắt đầu tiếp nhận: ${msg.name}`);
            return;
        }

        if (msg.type === "complete") {
            if (receivedChunksCount === totalExpectedChunks && totalExpectedChunks > 0) {
                finishDownloadMultiChannel();
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
        finishDownloadMultiChannel();
    }
}

// =====================================================
// RECEIVER: FINISH DOWNLOAD & AUTO EXTRACT ZIP
// =====================================================
async function finishDownloadMultiChannel() {
    if (totalExpectedChunks === 0) return; 
    totalExpectedChunks = 0; 

    addLog("Đang kết nối tổ hợp cấu trúc file nhị phân...");
    const sortedBuffers = [];
    const totalKeys = Object.keys(receiveBuffers).length;
    
    for (let i = 0; i < totalKeys; i++) {
        sortedBuffers.push(receiveBuffers[i]);
    }

    const finalBlob = new Blob(sortedBuffers);

    // Nếu chỉ gửi 1 file duy nhất và không chọn chế độ đa file, tiến hành giải nén lấy lại file gốc
    if (isIncomingPackMultiFile) {
        addLog("Phát hiện gói dữ liệu nén nhiều file. Tiến hành giải nén tự động...");
        setStatus("Đang giải nén...", "#facc15");
        try {
            const zip = await JSZip.loadAsync(finalBlob);
            
            // Lặp qua từng file nằm trong tệp nén để tải xuống cục bộ
            for (const filename of Object.keys(zip.files)) {
                const fileData = await zip.files[filename].async("blob");
                const fileUrl = URL.createObjectURL(fileData);
                
                const a = document.createElement("a");
                a.href = fileUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(fileUrl);
                addLog(`Đã bung file thành công: ${filename}`);
            }
            showToast("Đã nhận và tự động bung nhóm file hoàn tất!");
        } catch (err) {
            console.error("Lỗi giải nén tệp tin:", err);
            addLog("Không thể tự giải nén gói. Tiến hành tải trực tiếp gói Zip dự phòng...");
            downloadDirectBlob(finalBlob, expectedFileName);
        }
    } else {
        // Trường hợp người gửi chỉ chọn 1 file đơn lẻ, bung zip lấy lại file ban đầu nguyên vẹn định dạng
        try {
            const zip = await JSZip.loadAsync(finalBlob);
            const firstFilename = Object.keys(zip.files)[0];
            if(firstFilename) {
                const fileData = await zip.files[firstFilename].async("blob");
                downloadDirectBlob(fileData, firstFilename);
            } else {
                downloadDirectBlob(finalBlob, expectedFileName);
            }
        } catch (e) {
            downloadDirectBlob(finalBlob, expectedFileName);
        }
    }

    progressBar.style.width = "100%";
    progressPercent.textContent = "100%";
    setStatus("Nhận thành công", "#22c55e");

    setTimeout(async () => {
        await cleanupRoom();
        resetTransfer();
    }, 5000);
}

function downloadDirectBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Đã tải tệp hoàn tất");
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
        addLog(`Trạng thái: ${state.toUpperCase()}`);
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
            addLog("Đã dọn dẹp bộ nhớ phòng trên Firebase");
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
    isIncomingPackMultiFile = false;
    
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